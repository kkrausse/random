import assert from "node:assert/strict";
import { Worker, MessageChannel } from "node:worker_threads";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../.runtime/patched/packages/kernel-host/kernel.js";
import { createKernelFs } from "../.runtime/patched/packages/kernel-host/kernel-fs.js";

const directory = mkdtempSync(join(tmpdir(), "vivari-sqlite-"));
const results = [];
let host;
const deadline = setTimeout(() => { console.error("SQLite headless suite timed out"); process.exit(1); }, 90000);
async function boot() {
  const workers = new Set();
  const fsWorker = new Worker(new URL("./sqlite-headless-fs.mjs", import.meta.url), { workerData: { directory } });
  workers.add(fsWorker);
  let onMessage = () => {};
  await new Promise((resolve, reject) => {
    fsWorker.on("error", reject);
    fsWorker.on("message", msg => msg.type === "ready" ? resolve() : onMessage(msg));
  });
  const bridge = createKernelFs(fsWorker);
  onMessage = bridge.onMessage;
  let output = "";
  const kernel = new Kernel({ fs: bridge.fs, stdout: s => { output += s; }, stderr: s => { output += s; }, spawnWorker(info) {
    const w = new Worker(new URL("../.runtime/patched/scripts/process-worker.mjs", import.meta.url));
    workers.add(w);
    w.on("message", msg => info.on[msg.type]?.(msg));
    w.on("error", error => { console.error(error); process.exitCode = 1; kernel.stop(info.pid); });
    const { port1, port2 } = new MessageChannel();
    fsWorker.postMessage({ type: "fs-register", client: info.pid, sab: info.sab, port: port2 }, [port2]);
    w.postMessage({ type: "init", sab: info.sab, spec: info.spec, fsPort: port1 }, [port1]);
    return { postMessage: msg => w.postMessage(msg), terminate() {
      w.terminate(); workers.delete(w);
      fsWorker.postMessage({ type: "fs-unregister", client: info.pid });
    } };
  } });
  kernel.installCoreutils();
  for (const file of ["sqlite-api.cjs", "sqlite-owner.cjs"]) kernel.writeFile(`/runtime-probe/${file}`, readFileSync(new URL(`../probes/runtime/${file}`, import.meta.url)));
  const opts = { cwd: "/runtime-probe", env: { PATH: "/bin" }, capture: true };
  return {
    kernel, get output() { return output; }, opts,
    async run(file, mode, command = "node") {
      const r = await kernel.start(command, [file, mode], opts);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      results.push({ command, file, mode, output: r.stdout.trim() });
    },
    async stop() { for (const w of workers) await w.terminate(); workers.clear(); },
  };
}
try {
  host = await boot();
  for (const command of ["node", "bun"]) for (const mode of ["memory", "write", "recover"]) await host.run("sqlite-api.cjs", mode, command);
  const pid = host.kernel.launch("node", ["sqlite-owner.cjs", "hold"], { ...host.opts, capture: false });
  const until = Date.now() + 10000;
  while (!host.output.includes("SQLITE_OWNER_HELD") && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(host.output.includes("SQLITE_OWNER_HELD"), host.output);
  await host.run("sqlite-owner.cjs", "contend");
  let killed;
  host.kernel.onProcExit = (exited, result) => { if (exited === pid) killed = result.code; };
  host.kernel.stop(pid);
  assert.equal(killed, 143);
  await host.run("sqlite-owner.cjs", "recover");
  await host.stop();
  host = await boot();
  await host.run("sqlite-api.cjs", "recover");
  await host.run("sqlite-owner.cjs", "recover");
  console.log(JSON.stringify({ phase: "complete", restart: true, results }, null, 2));
} finally {
  await host?.stop(); rmSync(directory, { recursive: true, force: true }); clearTimeout(deadline);
}
