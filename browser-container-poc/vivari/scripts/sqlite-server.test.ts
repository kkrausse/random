import { test, expect } from "bun:test";
import { createRequire } from "node:module";
import { runtimeSourceUrl, runtimeSourcePath } from './runtime-source.mjs';
const { createSqliteServer } = await import(runtimeSourceUrl('packages/kernel-host/sqlite-server.js').href);
import { sqliteContract, sqliteRequests } from "../probes/sqlite-contract.js";
const require = createRequire(import.meta.url);
const { VirtualFileSystem } = require(runtimeSourcePath('packages/vfs/pkg-node/vivari_vfs.js'));

test("committed exec prefix survives owner termination; failed flush poisons the connection", async () => {
  const vfs = new VirtualFileSystem();
  vfs.mkdir("/test", true);
  vfs.mkdir("/tmp", true);
  let failure = false;
  // Fault injection only. Browser tests qualify actual OPFS durability.
  const server = await createSqliteServer(vfs, {
    shouldPersist: () => true, onWrite() {},
    async flush() { if (failure) throw new Error("injected write failure"); },
  });
  let seq = 0;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  async function request(client: number, req: Record<string, unknown>) {
    const path = `/tmp/test-${++seq}`;
    vfs.write_file(path, enc.encode(JSON.stringify(req)));
    await server.request(client, path);
    const response = JSON.parse(dec.decode(vfs.read_file(path + ".out")));
    vfs.unlink(path); vfs.unlink(path + ".out");
    if (response.error) throw new Error(response.error);
    return response.result;
  }
  const first = await request(1, { method: "open", path: "/test/db" });
  await request(1, { method: "execute", id: first.id,
    sql: "CREATE TABLE x(value); INSERT INTO x VALUES('committed'); BEGIN; UPDATE x SET value='pending';" });
  await expect(request(2, { method: "open", path: "/test/db" })).rejects.toThrow("SQLITE_BUSY");
  server.release(1);
  const second = await request(2, { method: "open", path: "/test/db" });
  const result = await request(2, { method: "execute", id: second.id, sql: "SELECT value FROM x", statement: true });
  expect(result.rows).toEqual([[["v", "committed"]]]);
  failure = true;
  await expect(request(2, { method: "execute", id: second.id, sql: "UPDATE x SET value='failure'" })).rejects.toThrow("injected write failure");
  await expect(request(2, { method: "execute", id: second.id, sql: "SELECT value FROM x" })).rejects.toThrow("requires close");
  server.release(2);
  await expect(request(3, { method: "open", path: "/test/db" })).rejects.toThrow("kernel restart");
});

test("shared browser/local SQLite contract", async () => {
  const vfs = new VirtualFileSystem();
  vfs.mkdir("/test", true); vfs.mkdir("/tmp", true);
  const server = await createSqliteServer(vfs, { shouldPersist: () => true, onWrite() {}, async flush() {} });
  const checks = await sqliteContract(sqliteRequests(server, vfs), server.release);
  expect(checks.length).toBeGreaterThanOrEqual(12);
});
