import { expect, test } from "bun:test";
import { createClientErrorHandler } from "./client-errors";

const report = { path: "Lassen/photo.ARW", mode: "preview", stage: "Open RAW original",
  bytes: 611630, expectedBytes: 611630, error: '{"excPtr":2147768}', browser: "Test browser" };
const request = (data: unknown) => new Request("http://localhost/api/client-error", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});
test("client failure logs keep diagnostic fields and discard unrecognized fields", async () => {
  const logs: unknown[] = [];
  const handle = createClientErrorHandler((data) => logs.push(data));
  expect((await handle(request({ ...report, cookie: "must not be logged" }))).status).toBe(204);
  expect(logs).toEqual([report]);
  expect((await handle(request({ ...report, bytes: -1 }))).status).toBe(400);
  expect((await handle(request({ error: "incomplete" }))).status).toBe(400);
  expect((await handle(request({ ...report, error: "x".repeat(17000) }))).status).toBe(413);
  expect(logs).toHaveLength(1);
});
test("client failure logging is rate limited", async () => {
  const handle = createClientErrorHandler(() => {});
  for (let i = 0; i < 60; i++) expect((await handle(request(report))).status).toBe(204);
  expect((await handle(request(report))).status).toBe(429);
});
