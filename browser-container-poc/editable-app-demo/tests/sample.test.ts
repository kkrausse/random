import { expect, test } from "bun:test";
import { openFixture } from "../src/fixture";
import { seedMissing } from "../src/sample-recipe";
import { WorkspaceController } from "../src/workspace-provider";

test("seed retries preserve user edits, fill only missing paths, and flush a restorable snapshot", async () => {
  let snapshot: string | null = null;
  const storage = { getItem: () => snapshot, setItem: (_key: string, value: string) => { snapshot = value; } };
  const workspace = openFixture(storage);
  await workspace.fs.writeFile("/src/App.tsx", "user's edited component");
  const files = { "/src/App.tsx": "sample replacement", "/nested/config.json": "__MODEL_PROXY__" };
  await seedMissing(workspace, files, "http://proxy.test");
  await workspace.fs.writeFile("/nested/config.json", "user's config");
  await seedMissing(workspace, files, "http://different-proxy.test");
  await workspace.close();
  const reopened = openFixture(storage);
  expect(new TextDecoder().decode(await reopened.fs.readFile("/src/App.tsx"))).toBe("user's edited component");
  expect(new TextDecoder().decode(await reopened.fs.readFile("/nested/config.json"))).toBe("user's config");
  await reopened.close();
});

test("controller excludes duplicate lifecycle actions and surfaces a failed stage for retry", async () => {
  const controller = new WorkspaceController();
  let release!: () => void, admissions = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = controller.run("Start", () => controller.steps([
    ["Open", async () => { admissions++; await gate; }],
    ["Launch", async () => { throw Error("missing asset"); }],
  ]));
  const duplicate = controller.run("Duplicate", async () => { admissions += 100; });
  expect(duplicate).toBe(first);
  release(); await first;
  expect(admissions).toBe(1);
  expect(controller.getSnapshot().progress.map(step => step.state)).toEqual(["done", "failed"]);
  expect(controller.getSnapshot().error).toContain("Launch: missing asset");
  await controller.run("Retry", () => controller.steps([["Launch", async () => {}]]));
  expect(controller.getSnapshot().error).toBe("");
  expect(controller.getSnapshot().busy).toBe(false);
  await controller.dispose();
});

test("provider disposal aborts an in-flight startup and releases registered attachments once", async () => {
  const controller = new WorkspaceController();
  let disposed = 0;
  const unregister = controller.registerAttachment("test", () => { disposed++; });
  const operation = controller.run("Start", async () => {
    await new Promise<void>((resolve, reject) => {
      if (controller.signal.aborted) { reject(controller.signal.reason); return; }
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
  });
  await controller.dispose(); await operation; unregister();
  expect(disposed).toBe(1);
  expect(controller.signal.aborted).toBe(true);
  expect(controller.getSnapshot().workspace).toBeUndefined();
  expect(controller.getSnapshot().runtime).toBeUndefined();
});
