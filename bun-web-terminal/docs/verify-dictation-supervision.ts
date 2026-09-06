// Run from bun-web-terminal: bun docs/verify-dictation-supervision.ts
// Uses a built Swift service, an unused ephemeral port, and no microphone.
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

const external = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ state: "ready", version: 1, modelId: "fixture" }) });
process.env.DICTATION_URL = `http://127.0.0.1:${external.port}`;
service = new DictationService();
try {
  assert.equal((await service.status()).state, "ready");
  await service.dispose();
  assert.equal((await fetch(process.env.DICTATION_URL)).status, 200);
} finally { external.stop(true); }
console.log("PASS: collision isolation, shared startup, crash/restart identity, shutdown, external ownership");
