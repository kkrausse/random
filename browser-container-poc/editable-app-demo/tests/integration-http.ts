import { diagnosticLog } from "../diagnostic-log";
import { browserAssets, root } from "../build";

// Deliberately QA-owned origin. Run only after PORT=4312 LOCAL_EDITOR_ADMIN=1 bun run demo.
const base = "http://127.0.0.1:4312";
const run = crypto.randomUUID();
const log = diagnosticLog(`${root}/.diagnostics`);
const checks: Record<string, unknown> = {};
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const get = (path: string, init?: RequestInit) => fetch(base + path, { ...init, signal: AbortSignal.timeout(20000) });
await log.write({ run, time: new Date().toISOString(), event: "qa.integration-http.start", port: 4312 });
try {
  const info = await (await get("/demo-info")).json();
  assert(info.name === "editable-app-demo" && info.root === root && info.localEditorAdmin === true, "Expected deliberate local admin fixture on 4312");
  checks.server = { url: base, localEditorAdmin: true };
  assert((await (await get("/editing-policy")).json()).allowed === true, "Editing policy");
  const html = await get("/");
  assert(html.status === 200 && html.headers.get("cross-origin-opener-policy") === "same-origin" && html.headers.get("cross-origin-embedder-policy") === "require-corp", "Host isolation delivery");
  const assets = await browserAssets();
  const privateAsset = [...assets.files.keys()].find(path => !assets.publicPaths.has(path))!;
  for (const path of ["/app.js", "/app.css", "/assets/main.js", privateAsset, "/runtime/distribution.json", "/prepared/manifest.json", "/setup-check"]) {
    const response = await get(path);
    assert(response.ok, `${path}: ${response.status}`);
    if (path === "/app.css") assert((await response.text()).includes(".oc-chat"), "Public chat styles");
    else if (path === "/setup-check") assert((await response.json()).ok === true, "Prepared inputs match");
    else await response.body?.cancel();
  }
  checks.assets = { normal: 200, editing: 200, runtime: 200, prepared: 200, setup: true, chatStyles: true };
  const bytes = new Uint8Array([0, 255, 128, 13, 10]);
  const echo = await get("/api/echo?qa=1", { method: "PATCH", headers: { cookie: "qa-cookie=explicit-fixture", "x-test": "kept", "content-type": "application/octet-stream" }, body: bytes });
  assert(echo.status === 207 && echo.headers.get("x-echo-method") === "PATCH" && echo.headers.get("x-echo-cookie") === "qa-cookie=explicit-fixture" && echo.headers.get("x-echo-header") === "kept", "Backend request metadata");
  assert(new Uint8Array(await echo.arrayBuffer()).every((byte, i) => byte === bytes[i]), "Binary body");
  const saved = await get("/api/counter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 23 }) });
  assert(saved.headers.get("set-cookie")?.includes("counter-session="), "Set-Cookie delivery");
  await saved.body?.cancel();
  assert((await (await get("/api/counter")).json()).count === 23, "Backend save/read");
  const stream = await get("/api/stream"), reader = stream.body!.getReader(), start = performance.now();
  const first = new TextDecoder().decode((await reader.read()).value), firstMs = Math.round(performance.now() - start);
  const second = new TextDecoder().decode((await reader.read()).value), secondMs = Math.round(performance.now() - start);
  assert(first === "first\n" && second === "second\n" && (await reader.read()).done && firstMs < 200 && secondMs >= 200, "Live stream chunk timing");
  checks.backend = { method: "PATCH", status: 207, binaryBody: true, cookieHeader: true, setCookie: true, customHeaders: true, counter: 23, stream: { firstMs, secondMs } };
  const receipt = { date: new Date().toISOString(), run, scope: "Host HTTP only; no browser cookie jar, guest runtime, Vite or OpenCode acceptance", checks, browser: { cli: "0.7.0", relay: "0.7.0", build: "2026-09-05T19:03:42.828Z", extension: "disconnected", targets: 0 }, providerCalls: 0 };
  await Bun.write(`${root}/tests/integration-qa/host-receipt.json`, JSON.stringify(receipt, null, 2) + "\n");
  await log.write({ run, time: new Date().toISOString(), event: "qa.integration-http.passed", checks });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  await log.write({ run, time: new Date().toISOString(), event: "qa.integration-http.failed", error });
  throw error;
}
