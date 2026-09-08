import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Endpoint } from "@vivari/workspace-api";
import { WorkspaceController, type Service } from "@vivari/workspace-api/react";
import { attachChat, chatFor } from "../src/chat-adapter";
import { connection } from "../src/sample-recipe";
import { browserAssets, styles, reactPeerPlugin } from "../build";
import { checkLocalPackages } from "../local-packages";

// Deterministic pinned-protocol fixture, NOT a guest OpenCode/browser receipt.
function fixture(marker = true) {
  let streams = 0, cancelled = 0, disposed = 0, posts = 0;
  const endpoint = {
    url: "https://fixture.invalid/preview/4096/?__vv_listener=qa&scope=retained",
    dispose() { disposed++; },
    async fetch(input: string, init: RequestInit = {}) {
      expect(typeof input).toBe("string");
      const url = new URL(input);
      expect(url.searchParams.get("__vv_listener")).toBe("qa");
      expect(url.searchParams.get("scope")).toBe("retained");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer explicit-test-fixture");
      const path = url.pathname.replace("/preview/4096/api/", "");
      if (init.method === "POST") posts++;
      if (path === "event") {
        streams++;
        return new Response(new ReadableStream({
          start(c) { if (marker) c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","data":{}}\n\n')); },
          cancel() { cancelled++; },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      if (path === "session" && init.method === "POST") {
        expect(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer))).toMatchObject({ location: { directory: "/workspace" } });
        return Response.json({ data: { id: "qa-session", title: "Explicit session" } });
      }
      if (path === "session") return Response.json({ data: [], cursor: {} });
      if (path === "model") return Response.json({ data: [{ id: "fixture", providerID: "fixture", name: "Fixture", enabled: true }] });
      if (path === "model/default") return Response.json({ data: null });
      if (path === "session/active") return Response.json({ data: {} });
      if (path.endsWith("/message")) return Response.json({ data: [], cursor: {} });
      return Response.json({ data: [] });
    },
  } as unknown as Endpoint;
  const service = { endpoint, connection: connection(endpoint, { authorization: "Bearer explicit-test-fixture" }) } as Service;
  return { service, counts: () => ({ streams, cancelled, disposed, posts }) };
}

test("public package integration scopes one authenticated controller to service, with explicit session and caller release", async () => {
  const owner = new WorkspaceController(), first = fixture(), next = fixture();
  try {
    await Promise.all([attachChat(owner, first.service), attachChat(owner, first.service)]);
    const chat = chatFor(first.service)!;
    expect(chat.getSnapshot().connection).toBe("connected");
    expect(chat.getSnapshot().sessionID).toBeUndefined();
    expect(first.counts()).toEqual({ streams: 1, cancelled: 0, disposed: 0, posts: 0 });
    // Rendering/subscription churn must not own transport or create a session.
    for (let i = 0; i < 3; i++) {
      const off = chat.subscribe(() => {});
      expect(chat.getSnapshot().sessionID).toBeUndefined();
      off();
    }
    expect(first.counts().streams).toBe(1);
    await chat.createSession("Explicit session");
    expect(first.counts().posts).toBe(1);
    await attachChat(owner, next.service);
    expect(chatFor(first.service)).toBeUndefined();
    expect(first.counts()).toEqual({ streams: 1, cancelled: 1, disposed: 0, posts: 1 });
    await owner.cancelAndClose();
    expect(chatFor(next.service)).toBeUndefined();
    expect(next.counts()).toEqual({ streams: 1, cancelled: 1, disposed: 0, posts: 0 });
  } finally { await owner.dispose(); }
});

test("cancel during chat handshake aborts promptly before serialized workspace cleanup", async () => {
  const owner = new WorkspaceController(), pending = fixture(false);
  const start = owner.run("attach fixture chat", () => attachChat(owner, pending.service));
  await Promise.resolve();
  await owner.cancelAndClose();
  await start;
  expect(pending.counts()).toEqual({ streams: 1, cancelled: 1, disposed: 0, posts: 0 });
  expect(chatFor(pending.service)).toBeUndefined();
  await owner.dispose();
}, 2000);

test("built public root/react/CSS resolve; chat remains outside normal static JS graph", async () => {
  await checkLocalPackages();
  const assets = await browserAssets();
  const publicCode = [...assets.publicPaths].map(path => assets.files.get(path)).join("\n");
  const allCode = [...assets.files.values()].join("\n");
  expect(publicCode).not.toContain("createChatController");
  expect(publicCode).not.toContain("oc-composer");
  expect(allCode).toContain("oc-composer");
  expect(allCode).not.toContain("mountOpenCodeClient");
  expect(await styles()).toContain(".oc-chat");
});

test("file dependency React peers share the demo renderer in a fresh bundled consumer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode", "chat-demo-consumer-"));
  try {
    const result = await Bun.build({ entrypoints: [new URL("./react-consumer.tsx", import.meta.url).pathname], target: "bun", plugins: [reactPeerPlugin], outdir: directory });
    expect(result.success).toBe(true);
    const child = Bun.spawn([process.execPath, join(directory, "react-consumer.js")], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    expect(stdout).toContain("New chat");
    expect(stdout).toContain("oc-chat");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
