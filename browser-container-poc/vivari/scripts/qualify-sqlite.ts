// Local entrypoint deliberately includes the real browser gate. Pure headless
// success cannot prove OPFS, Web Locks, browser WASM delivery or worker teardown.
import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolveRuntimeSource } from './runtime-source.mjs';
const root = resolve(import.meta.dir, "..");
const session = process.argv[2];
const origin = process.argv[3] || "http://localhost:5192/";
if (!session) throw new Error("Usage: bun run qualify:sqlite <browser-control-session> (patched harness already served)");
async function run(command: string[], cwd = root, capture = false) {
  const proc = Bun.spawn(command, { cwd, stdout: capture ? "pipe" : "inherit", stderr: "inherit" });
  const text = capture ? await new Response(proc.stdout).text() : "";
  if (await proc.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}\n${text}`);
  return text;
}
async function browser(code: string) {
  const result = JSON.parse(await run(["browser-control", "execute", "--json", "--session", session, code], root, true));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
const reports: Record<string, unknown> = {};
const destination = resolve(root, `../doc/logs/vivari/${Date.now()}-sqlite-qualification.json`);
async function save() {
  mkdirSync(resolve(root, "../doc/logs/vivari"), { recursive: true });
  writeFileSync(destination, JSON.stringify(reports, null, 2) + "\n");
}
async function boot() {
  await browser(`await page.goto(${JSON.stringify(origin)}); return await snapshot()`);
  await browser('await page.getByRole("button", {name:"Boot and mount fixture",exact:true}).click(); return "Boot requested"');
  await browser('await page.waitForFunction(()=>!!window.probe?.vm); return "Booted"');
}
async function probe(script: string, global: string, label: string) {
  await browser(readFileSync(resolve(root, "scripts", script), "utf8"));
  const result = await browser(`await page.waitForFunction(()=>window[${JSON.stringify(global)}]?.phase !== "running"); return await page.evaluate(()=>window[${JSON.stringify(global)}])`);
  reports[label] = result; await save();
  if (result?.phase !== "complete") throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  console.log(`PASS ${label}`);
}
try {
  reports.page = await browser('return {url:page.url(),snapshot:await snapshot()}');
  await run(["bun", "scripts/build-runtime.ts", "patched"]);
  reports.build = JSON.parse(readFileSync(resolve(root, ".runtime/patched-build.json"), "utf8"));
  await run(["bun", "test", "scripts/sqlite-server.test.ts"]);
  // This repo's pinned host is Apple Silicon. Other hosts can run Node >=24
  // directly using the documented sqlite-headless.mjs command.
  await run(["bunx", "--package", "node-bin-darwin-arm64@24.18.0", "node", "scripts/sqlite-headless.mjs"]);
  await run(["bunx", "--package", "node-bin-darwin-arm64@24.18.0", "node", "scripts/verify-node.mjs"], resolveRuntimeSource());
  await boot();
  await browser('state.sqliteMode=undefined; return "Full API mode"');
  await probe("sqlite-api.js", "sqliteApiProbe", "api");
  await probe("sqlite-owner.js", "sqliteOwnerProbe", "ownership");
  await boot();
  await browser('state.sqliteMode="recover"; return "Recovery-only mode"');
  await probe("sqlite-api.js", "sqliteApiProbe", "reloadRecovery");
  await browser('state.sqliteMode=undefined; return "Mode restored"');
  await probe("sqlite-storage.js", "sqliteStorageProbe", "opfs");
  reports.phase = "complete";
} catch (error) { reports.phase = "failed"; reports.error = String(error); process.exitCode = 1; }
finally { await save(); console.log(`SQLite qualification ${reports.phase}: ${destination}`); }
