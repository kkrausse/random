// Run from bun-web-terminal: bun docs/verify-dictation-supervision.ts
// Uses this platform's built dictation service, an unused ephemeral port, and no microphone.
import assert from "node:assert/strict";
import { DictationService } from "../src/dictation-service";

const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ instanceId: "other-service", version: "1" }) });
const port = listener.port;
process.env.DICTATION_PORT = String(port);
delete process.env.DICTATION_URL;
let service = new DictationService();
try {
  await assert.rejects(service.ensure(), /collision|exited/);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json() as any).instanceId, "other-service");
} finally { await service.dispose(); listener.stop(true); }

service = new DictationService();
try {
  const urls = await Promise.all([service.ensure(), service.ensure(), service.ensure()]);
  assert.equal(new Set(urls).size, 1);
  const health = await (await fetch(`${urls[0]}/healthz`)).json() as any;
  assert.notEqual(health.instanceId, "other-service");
  const child = (service as any).child as Bun.Subprocess;
  assert(child.pid);
  child.kill("SIGKILL");
  await child.exited;
  await new Promise(resolve => setTimeout(resolve, 10));
  const restarted = await service.ensure();
  const newHealth = await (await fetch(`${restarted}/healthz`)).json() as any;
  assert.notEqual(newHealth.instanceId, health.instanceId);
  await service.dispose();
  await assert.rejects(fetch(`${restarted}/healthz`, { signal: AbortSignal.timeout(1000) }));
} finally { await service.dispose(); }

// Idle exit (Linux service): status 0 is not a failure, so the next request starts a fresh
// process at once, and a connection that races with the exit is retried against that process.
if (process.platform === "linux") {
  // Bun.spawn does not see process.env changes made at run time, so the short idle period is a flag.
  const brief = `${import.meta.dir}/../node_modules/.verify-brief-service.sh`;
  await Bun.write(brief, `#!/bin/sh\nexec "${import.meta.dir}/../../dictation-server-linux/run.sh" "$@" --idle-minutes 0.02\n`);
  await Bun.$`chmod +x ${brief}`;
  process.env.DICTATION_EXECUTABLE = brief;
  service = new DictationService();
  try {
    const url = await service.ensure();
    const first = (await (await fetch(`${url}/healthz`)).json() as any).instanceId;
    const child = (service as any).child as Bun.Subprocess;
    assert.equal(await child.exited, 0);
    const start = performance.now();
    assert.notEqual((await (await fetch(`${await service.ensure()}/healthz`)).json() as any).instanceId, first);
    assert(performance.now() - start < 450, "Respawn after a clean idle exit was delayed by backoff");
  } finally { await service.dispose(); delete process.env.DICTATION_EXECUTABLE; await Bun.$`rm -f ${brief}`; }

  // A stand-in service that stops listening 300 ms before it exits, to hold the race window open.
  const fake = `${import.meta.dir}/../node_modules/.verify-leaving-service.ts`;
  await Bun.write(fake, `const flag = i => process.argv[process.argv.indexOf(i) + 1];
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(flag("--port")),
  fetch(request, server) {
    if (new URL(request.url).pathname === "/healthz") return Response.json({ instanceId: flag("--instance-id"), version: "1" });
    return server.upgrade(request) ? undefined : new Response("no", { status: 404 });
  }, websocket: { message() {} } });
if (process.env.LEAVE_AFTER_MS) setTimeout(() => { server.stop(true); setTimeout(() => process.exit(0), 300); }, Number(process.env.LEAVE_AFTER_MS));
`);
  const launcher = `${import.meta.dir}/../node_modules/.verify-leaving-service.sh`;
  // Only the first launch leaves; the respawn stays.
  await Bun.write(launcher, `#!/bin/sh\nif mkdir "${fake}.once" 2>/dev/null; then export LEAVE_AFTER_MS=400; fi\nexec "${process.execPath}" "${fake}" "$@"\n`);
  await Bun.$`chmod +x ${launcher} && rm -rf ${fake}.once`;
  process.env.DICTATION_EXECUTABLE = launcher;
  service = new DictationService();
  try {
    await service.ensure();
    await new Promise(resolve => setTimeout(resolve, 450));
    const leaving = (service as any).child as Bun.Subprocess;
    assert.equal(leaving.exitCode, null, "Stand-in exited before the race window");
    const start = performance.now();
    const socket = await service.connect();
    assert.equal(socket.readyState, WebSocket.OPEN);
    assert.notEqual((service as any).child, leaving);
    assert(performance.now() - start < 1500, "Racing connection was delayed by backoff");
    socket.close();
  } finally { await service.dispose(); delete process.env.DICTATION_EXECUTABLE; await Bun.$`rm -rf ${fake} ${fake}.once ${launcher}`; }
}

const external = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ state: "ready", version: 1, modelId: "fixture" }) });
process.env.DICTATION_URL = `http://127.0.0.1:${external.port}`;
service = new DictationService();
try {
  assert.equal((await service.status()).state, "ready");
  await service.dispose();
  assert.equal((await fetch(process.env.DICTATION_URL)).status, 200);
} finally { external.stop(true); }
console.log("PASS: collision isolation, shared startup, crash/restart identity, shutdown, idle exit and its race (Linux), external ownership");
