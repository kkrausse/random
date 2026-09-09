import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnosticLog } from "../diagnostic-log";
import { safeData } from "../src/diagnostic-data";
import { diagnostics } from "../src/diagnostics";
import { WorkspaceController, recordControllerDiagnostic } from "../src/workspace-provider";
import { diagnosticReporter } from "../../workspace-api/src/diagnostics";

test("failed startup retains correlated cause/stack and last timed milestone on disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-diagnostics-"));
  try {
    const log = diagnosticLog(directory);
    const controller = new WorkspaceController({ onDiagnostic: recordControllerDiagnostic });
    await controller.run("QA injected startup", () => controller.steps([["Open", async () => {
      const reporter = diagnosticReporter(event => diagnostics.record("workspace.open", event));
      reporter.emit("worker.init.sent", { version: "qa-version" });
      throw reporter.failure(new Error("QA injected timeout", { cause: Error("QA stalled worker") }));
    }]]));
    const entries = diagnostics.text().split("\n").map(line => JSON.parse(line));
    for (const entry of entries) await log.write({ browser: entry });
    const text = await log.text();
    expect(text).toContain("worker.init.sent");
    expect(text).toContain("elapsedMs");
    expect(text).toContain("QA stalled worker");
    expect(text).toContain("stack");
    expect([...entries].reverse().find(entry => entry.event === "operation.failed").run).toBe(diagnostics.run);
    expect(controller.getSnapshot().error).toContain("last stage: worker.init.sent");
    await controller.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("diagnostic redaction and rotation retain valid bounded JSONL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-log-bounds-"));
  try {
    const log = diagnosticLog(directory, 1024);
    for (let i = 0; i < 40; i++) await log.write({ i, headers: { authorization: "leak-one" }, prompt: "leak-two", error: Error("Bearer leak-three token=leak-four https://a.test/x?key=leak-five"), padding: "x".repeat(100) });
    const text = await log.text();
    expect(text).not.toMatch(/leak-(one|two|three|four|five)/);
    expect(text).toContain("[redacted]");
    expect(text.trim().split("\n").every(line => !!JSON.parse(line))).toBe(true);
    expect((await stat(log.file)).size).toBeLessThan(2000);
    expect((await stat(`${log.file}.1`)).size).toBeLessThan(2000);
    expect(safeData({ source: "private source", contents: "private contents" })).toEqual({ source: "[redacted]", contents: "[redacted]" });
    // Unwritable destinations and throwing observers must not hide app failures.
    await diagnosticLog(log.file).write({ error: "ignored write failure" });
    expect(() => diagnosticReporter(() => { throw Error("observer failed"); }).emit("ready")).not.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
