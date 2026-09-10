import { describe, expect, test } from "bun:test";
import { SourceDocument, type SourceWorkspace } from "../src/editor-source";
import { attachChat, chatFor, editorLifecycle } from "../src/editor-adapter";
import type { Service, WorkspaceController } from "@kev-browser-agent-kit/workspace/react";
import { fixture as chatFixture } from "./fixture";

const deferred = <T = void>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const files = new Map([["/one", "original"], ["/two", "other"]]);
  const writes: string[] = [];
  let block: Promise<void> = Promise.resolve();
  const workspace = {
    fs: {
      readFile: async (path: string) => new TextEncoder().encode(files.get(path)),
      writeFile: async (path: string, text: string) => { await block; files.set(path, text); writes.push(text); },
    },
    flush: async () => {},
  } as unknown as SourceWorkspace;
  return { document: new SourceDocument(workspace), workspace, writes, files, block: (promise: Promise<void>) => { block = promise; } };
}
describe("source operation safety", () => {
  test("typing during a slow save stays dirty and writes in order", async () => {
    const f = fixture(); await f.document.open("/one");
    const gate = deferred(); f.block(gate.promise);
    f.document.edit("first"); const first = f.document.flush();
    f.document.edit("second");
    gate.resolve(); await first;
    expect(f.document.dirty).toBe(true);
    await f.document.flush();
    expect(f.writes).toEqual(["first", "second"]);
    expect(f.document.dirty).toBe(false);
  });
  test("late reads cannot overwrite typing or a newer selection", async () => {
    const f = fixture(); await f.document.open("/one");
    const gate = deferred<Uint8Array>();
    f.workspace.fs.readFile = () => gate.promise;
    const old = f.document.open("/two"); await tick();
    f.document.edit("typed while read pending");
    gate.resolve(new TextEncoder().encode("late"));
    expect(await old).toBe(false);
    expect(f.document.path).toBe("/one");
    expect(f.document.text).toBe("typed while read pending");
    await expect(f.document.open("/two")).rejects.toThrow("autosave");
  });
  test("flush failures retain dirty text and permit a retry", async () => {
    const f = fixture(); await f.document.open("/one"); f.document.edit("retained");
    f.workspace.flush = async () => { throw Error("disk unavailable"); };
    await expect(f.document.flush()).rejects.toThrow("disk unavailable");
    expect(f.document.dirty).toBe(true);
    expect(f.document.text).toBe("retained");
    f.workspace.flush = async () => {};
    await f.document.flush(); expect(f.document.dirty).toBe(false);
  });
});

describe("mounted editor lifecycle", () => {
  const owner = () => {
    const calls: string[] = [];
    const controller = {
      cancelAndClose: async () => { calls.push("close"); },
      run: async (_label: string, task: () => Promise<void>) => { await task(); },
      reportError: (error: unknown) => { calls.push(String(error)); },
    } as unknown as WorkspaceController;
    return { controller, calls, start: async () => { calls.push("start"); } };
  };
  test("StrictMode replay admits one start and closes only the admitted mount", async () => {
    const f = owner();
    editorLifecycle(f.controller, f.start)();
    const cleanup = editorLifecycle(f.controller, f.start);
    await tick(); expect(f.calls).toEqual(["close", "start"]);
    cleanup(); await tick(); expect(f.calls).toEqual(["close", "start", "close"]);
  });
  test("remount waits for the previous dirty document flush before restarting", async () => {
    const f = owner(), gate = deferred();
    const cleanup = editorLifecycle(f.controller, f.start, () => gate.promise);
    await tick(); cleanup();
    const cleanupNext = editorLifecycle(f.controller, f.start);
    await tick(); expect(f.calls).toEqual(["close", "start"]);
    gate.resolve(); await tick();
    expect(f.calls).toEqual(["close", "start", "close", "close", "start"]);
    cleanupNext(); await tick();
  });
  test("startup is cancelled while initial close is pending", async () => {
    const f = owner(), gate = deferred();
    f.controller.cancelAndClose = () => gate.promise;
    const cleanup = editorLifecycle(f.controller, f.start);
    await tick(); cleanup(); gate.resolve(); await tick();
    expect(f.calls).toEqual([]);
  });
});

test("chat attachment is shared per service, uses its transport, and abort disposes it", async () => {
  const f = chatFixture(), lifetime = new AbortController();
  let release = () => {}, disposed = false;
  const ready: string[] = [];
  const owner = {
    signal: lifetime.signal,
    registerAttachment: (_name: string, dispose: () => void) => {
      release = () => { if (!disposed) { disposed = true; dispose(); } };
      return release;
    },
    clientReady: (name: string) => { ready.push(name); },
    clientFailed: () => {},
  } as unknown as WorkspaceController;
  const service = { connection: f.endpoint } as unknown as Service;
  const [one, two] = await Promise.all([
    attachChat(owner, service, { serviceName: "agent", directory: "/project" }),
    attachChat(owner, service, { serviceName: "agent", directory: "/project" }),
  ]);
  expect(one).toBe(two); expect(chatFor(service)).toBe(one);
  expect(ready).toEqual(["agent", "agent"]);
  expect(f.calls.filter(call => call.url.pathname.endsWith("/session"))).toHaveLength(1);
  expect(f.calls.find(call => call.url.pathname.endsWith("/session"))!.url.searchParams.get("directory")).toBe("/project");
  const cancels = f.cancels;
  lifetime.abort(); release(); await tick();
  expect(chatFor(service)).toBeUndefined();
  expect(f.cancels).toBe(cancels + 1);
});
