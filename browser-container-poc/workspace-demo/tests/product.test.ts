import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createBackend } from "../backend";
import { browserAssets } from "../build";
import { authorizeEditorRequest } from "@vivari/workspace-api/server";
import { WorkspaceController } from "@vivari/workspace-api/react";
import { openFixture } from "../src/fixture";
import { resetSource, resetSourcePaths } from "../src/sample-recipe";

test("explicit reset preserves unknown source, configuration and session state across reopen", async () => {
  let snapshot: string | null = null;
  const storage = { getItem: () => snapshot, setItem: (_: string, value: string) => { snapshot = value; } };
  const workspace = openFixture(storage);
  const preserved = { "/src/user.ts": "user source", "/.opencode-state/session.json": "history", "/opencode.json": "user config", "/backend.db": "state" };
  for (const [path, value] of Object.entries(preserved)) { await workspace.fs.mkdir(path.slice(0, path.lastIndexOf("/")) || "/"); await workspace.fs.writeFile(path, value); }
  const source = Object.fromEntries(resetSourcePaths.map(path => [path, `known-good ${path}`]));
  await resetSource(workspace, source);
  await workspace.close();
  const reopened = openFixture(storage);
  for (const [path, value] of Object.entries({ ...source, ...preserved })) expect(new TextDecoder().decode(await reopened.fs.readFile(path))).toBe(value);
  await reopened.close();
});

test("actual demo denies direct editor assets and model routes without local admin policy", async () => {
  for (const admin of ["0", "1"]) {
    const child = Bun.spawn([process.execPath, "serve.ts"], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, PORT: "0", LOCAL_EDITOR_ADMIN: admin }, stdout: "pipe", stderr: "pipe" });
    try {
      const reader = child.stdout.getReader(); let output = "", url: string | undefined;
      const deadline = setTimeout(() => child.kill(), 20000);
      try {
        while (!url) { const next = await reader.read(); if (next.done) throw Error(`Server exited: ${output}`); output += new TextDecoder().decode(next.value); url = output.match(/proxy: (http:\/\/[^\s]+)/)?.[1]; }
      } finally { clearTimeout(deadline); reader.releaseLock(); }
      expect((await fetch(new URL("/editing-policy", url))).status).toBe(200);
      expect(await (await fetch(new URL("/editing-policy", url))).json()).toMatchObject({ allowed: admin === "1" });
      expect((await fetch(new URL("/app.js", url))).status).toBe(200);
      const assets = await browserAssets();
      const privateAsset = [...assets.files.keys()].find(path => !assets.publicPaths.has(path))!;
      for (const path of [privateAsset, "/runtime/distribution.json", "/prepared/manifest.json"]) expect((await fetch(new URL(path, url))).status).toBe(admin === "1" ? 200 : 403);
      // No model provider call is made: denial paths must short-circuit the proxy.
      if (admin === "0") expect((await fetch(new URL("/api/model/opencode/chat/completions", url), { method: "POST" })).status).toBe(403);
      expect((await fetch(new URL(privateAsset, url), { headers: { origin: "https://unauthorized.example" } })).status).toBe(403);
    } finally { child.kill("SIGTERM"); await child.exited; }
  }
}, 30000);

test("cancel serializes cleanup, excludes new actions, renews signal and retries failed close", async () => {
  const controller = new WorkspaceController();
  let cleanup = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  controller.close = async () => { cleanup++; await gate; if (cleanup === 1) throw Error("injected close failure"); };
  const startup = controller.run("boot", async () => { await new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), { once: true })); });
  await Promise.resolve();
  const close = controller.cancelAndClose();
  expect(controller.cancelAndClose()).toBe(close);
  expect(controller.run("competing action", async () => { throw Error("must not run"); })).toBe(close);
  release(); await startup; await expect(close).rejects.toThrow("injected close failure");
  expect(controller.signal.aborted).toBe(true);
  await controller.cancelAndClose();
  expect(cleanup).toBe(2); expect(controller.signal.aborted).toBe(false);
  await controller.run("reopen", async () => controller.signal.throwIfAborted());
  expect(controller.getSnapshot().error).toBe("");
  await controller.dispose();
});

test("server adapter fails closed and normal static graph excludes lazy editor assets", async () => {
  const request = new Request("http://localhost/editor.js");
  expect((await authorizeEditorRequest(request, () => false))?.status).toBe(403);
  expect((await authorizeEditorRequest(request, () => { throw Error("session lookup failed"); }))?.status).toBe(403);
  expect(await authorizeEditorRequest(request, () => true)).toBeUndefined();
  const assets = await browserAssets();
  expect(assets.publicPaths.has("/assets/main.js")).toBe(true);
  const publicCode = [...assets.publicPaths].map(path => assets.files.get(path)).join("\n");
  expect(publicCode).not.toContain("Guest source editor");
  expect(publicCode).not.toContain("Launch guest OpenCode");
  expect([...assets.files.keys()].some(path => !assets.publicPaths.has(path))).toBe(true);
});

test("authored preview SW passes original backend Request with bytes, headers, cookies, status and live stream", async () => {
  const backend = createBackend();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => await backend(request) ?? new Response("Host missing", { status: 404 }) });
  try {
    let fetchEvent!: (event: any) => void, nativeRequest: Request | undefined, guestRequest: any;
    const guestUrl = new URL("/preview/5173/", server.url);
    guestUrl.searchParams.set("__vv_listener", "listener-test");
    guestUrl.searchParams.set("__vv_host_paths", JSON.stringify(["/api"]));
    const client = { url: guestUrl.href, id: "frame", frameType: "nested" };
    const kernel = { url: server.url.href, id: "host", frameType: "top-level", postMessage(message: any, ports: MessagePort[]) { guestRequest = message.req; ports[0]!.postMessage({ status: 200, headers: { "content-type": "text/plain" }, body: "guest" }); ports[0]!.close(); } };
    const source = await Bun.file(new URL("../../vivari/.runtime/patched/packages/studio/public/sw.js", import.meta.url)).text();
    // The actual authored SW dispatches real Requests to a real Bun HTTP backend.
    runInNewContext(source, { URL, Response, Request, Headers, MessageChannel, setTimeout, clearTimeout, console,
      fetch: (request: Request) => { nativeRequest = request; return fetch(request); },
      self: { location: new URL("/runtime/sw.js", server.url), addEventListener: (kind: string, callback: any) => { if (kind === "fetch") fetchEvent = callback; }, clients: { get: async () => client, matchAll: async () => [kernel, client] } },
    });
    const dispatch = (request: Request) => {
      let response!: Promise<Response>;
      fetchEvent({ request, clientId: "frame", respondWith(value: Promise<Response>) { response = value; } });
      return response;
    };
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    const request = new Request(new URL("/api/echo?q=1", server.url), { method: "PATCH", credentials: "include", headers: { cookie: "test-session=kept", "x-test": "original", "content-type": "application/octet-stream" }, body: bytes });
    const response = await dispatch(request);
    expect(nativeRequest).toBe(request);
    expect(response.status).toBe(207);
    expect(response.headers.get("x-echo-method")).toBe("PATCH");
    expect(response.headers.get("x-echo-cookie")).toBe("test-session=kept");
    expect(response.headers.get("x-echo-header")).toBe("original");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const stream = await dispatch(new Request(new URL("/api/stream", server.url)));
    expect(stream.headers.get("x-backend")).toBe("host");
    const reader = stream.body!.getReader(), before = performance.now();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first\n");
    expect(performance.now() - before).toBeLessThan(200);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("second\n");
    expect((await reader.read()).done).toBe(true);
    const save = await dispatch(new Request(new URL("/api/counter", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: '{"count":17}' }));
    expect(save.headers.get("set-cookie")).toContain("counter-session=");
    expect(await (await fetch(new URL("/api/counter", server.url))).json()).toEqual({ count: 17 });
    expect(await (await dispatch(new Request(new URL("/apix", server.url)))).text()).toBe("guest");
    expect(guestRequest.listenerId).toBe("listener-test");
    expect(guestRequest.url).toBe("/apix");
    client.url = client.url.replace(/&__vv_host_paths=[^&]+/, "");
    expect(await (await dispatch(new Request(new URL("/api/echo", server.url)))).text()).toBe("guest");
    expect(guestRequest.port).toBe(5173);
  } finally { server.stop(true); }
});
