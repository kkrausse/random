import { expect, test } from "bun:test";
import { openFixture } from "../src/fixture";

test("fixture preserves binary bytes, copy isolation, and explicit snapshot lifetime", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = openFixture(storage);
  const bytes = new Uint8Array([0, 255, 128, 42]);
  await first.fs.writeFile("/binary", bytes); bytes[1] = 0;
  const read = await first.fs.readFile("/binary"); read[2] = 0;
  expect([...await first.fs.readFile("/binary")]).toEqual([0, 255, 128, 42]);
  await first.flush();
  await first.fs.writeFile("/binary", "unsaved");
  await first.close();
  expect(first.fs.readFile("/binary")).rejects.toThrow("closed");
  const reopened = openFixture(storage);
  expect([...await reopened.fs.readFile("/binary")]).toEqual([0, 255, 128, 42]);
  expect(await reopened.fs.readdir("/")).toContain("src");
  await reopened.fs.rename("/binary", "/renamed");
  expect(reopened.fs.readFile("/binary")).rejects.toThrow("not found");
  await reopened.fs.remove("/renamed");
  expect(reopened.fs.stat("/renamed")).rejects.toThrow("not found");
});

test("snapshot failures and malformed snapshots are surfaced", async () => {
  const fixture = openFixture({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
  expect(fixture.flush()).rejects.toThrow("quota");
  expect(() => openFixture({ getItem: () => '[["/bad",[999]]]', setItem() {} })).toThrow("Invalid fixture file");
  expect(fixture.fs.writeFile("/../outside", "x")).rejects.toThrow("absolute workspace path");
});
