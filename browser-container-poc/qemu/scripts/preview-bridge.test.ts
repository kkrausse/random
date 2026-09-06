import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

test("preview worker routes guest paths, decompresses bytes, and injects the HMR adapter", async () => {
  const source = await Bun.file(new URL("../public/preview-sw.js", import.meta.url)).text();
  const handlers: Record<string, Function> = {};
  let forwarded: any;
  const body = Buffer.from(Bun.gzipSync(new TextEncoder().encode("<html><head></head><body>Guest</body></html>"))).toString("base64");
  const owner = {
    url: "http://localhost/",
    postMessage(message: any, ports: MessagePort[]) {
      forwarded = message;
      ports[0].postMessage({ status: 200, headers: [["content-type", "text/html"]], body });
      ports[0].close();
    },
  };
  runInNewContext(source, {
    self: { location: { origin: "http://localhost" }, clients: { matchAll: async () => [owner] },
      addEventListener: (name: string, handler: Function) => { handlers[name] = handler; } },
    URL, Response, Headers, MessageChannel, Uint8Array, Blob, TextEncoder, TextDecoder,
    DecompressionStream, atob, setTimeout, clearTimeout,
  });
  let response!: Promise<Response>;
  handlers.fetch({ request: new Request("http://localhost/__guest/?v=123"),
    respondWith: (value: Promise<Response>) => { response = value; } });
  const result = await response;
  expect(forwarded.request.path).toBe("/?v=123");
  expect(result.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  expect(await result.text()).toBe('<html><head><script src="/preview-websocket.js"></script></head><body>Guest</body></html>');
});

test("serial responses survive arbitrary chunk boundaries and preserve console output", async () => {
  const source = await Bun.file(new URL("../public/serial-bridge.js", import.meta.url)).text();
  let consoleOutput = "";
  const input: string[] = [];
  const host: Record<string, any> = {};
  const runtime = { parent: host, addEventListener() {} };
  const slave = {
    write(data: string | number[]) { consoleOutput += data; },
    ldisc: { writeFromLower(data: string) { input.push(data); } },
  };
  runInNewContext(source, { window: host, TextDecoder, Uint8Array, setTimeout, clearTimeout, location: { origin: "http://localhost" } });
  const bridge = host.installSerialBridge(slave, runtime);
  const first = bridge.request({ type: "http", path: "/first", method: "GET" });
  const second = bridge.request({ type: "http", path: "/second", method: "GET" });
  const requests = input.map((line) => JSON.parse(line));
  // Responses can finish out of order, split through delimiters and JSON strings.
  const wire = `shell output ✨\r\n\x1e${JSON.stringify({ id: requests[1].id, status: 404, body: "míssing" })}\n` +
    `\x1e${JSON.stringify({ id: requests[0].id, status: 200, body: "x".repeat(8192) })}\nnext prompt`;
  const bytes = new TextEncoder().encode(wire);
  for (let i = 0; i < bytes.length; i += 7) slave.write(Array.from(bytes.slice(i, i + 7)));
  expect(await first).toMatchObject({ status: 200, body: "x".repeat(8192) });
  expect(await second).toMatchObject({ status: 404, body: "míssing" });
  expect(consoleOutput).toBe("shell output ✨\r\nnext prompt");
  expect(bridge.stats).toMatchObject({ http: 2, errors: 0 });
});

test("preview caches only versioned immutable dependencies and resets between VMs", async () => {
  const source = await Bun.file(new URL("../public/preview-sw.js", import.meta.url)).text();
  const handlers: Record<string, Function> = {};
  let requests = 0;
  const owner = {
    id: "workspace", url: "http://localhost/",
    postMessage(message: any, ports: MessagePort[]) {
      requests++;
      ports[0].postMessage({ status: 200, headers: [
        ["content-type", "text/javascript"],
        ["cache-control", message.request.path.includes("mutable") ? "no-cache" : "max-age=31536000, immutable"],
      ], body: Buffer.from(Bun.gzipSync(new TextEncoder().encode(`module ${requests}`))).toString("base64") });
      ports[0].close();
    },
  };
  runInNewContext(source, {
    self: { location: { origin: "http://localhost" }, clients: { matchAll: async () => [owner] },
      addEventListener: (name: string, handler: Function) => { handlers[name] = handler; } },
    URL, Response, Headers, MessageChannel, Uint8Array, Blob, TextEncoder, TextDecoder,
    DecompressionStream, atob, setTimeout, clearTimeout,
  });
  const fetch = async (path: string) => {
    let response!: Promise<Response>;
    handlers.fetch({ request: new Request(`http://localhost${path}`),
      respondWith: (value: Promise<Response>) => { response = value; } });
    return (await response).text();
  };
  const dependency = "/node_modules/.vite/deps/react.js?v=abc";
  expect(await fetch(dependency)).toBe("module 1");
  expect(await fetch(dependency)).toBe("module 1");
  expect(requests).toBe(1);
  await fetch(dependency.replace("abc", "def"));
  expect(requests).toBe(2);
  for (const path of ["/src/main.tsx?v=abc", "/node_modules/.vite/deps/react.js", "/node_modules/.vite/deps/mutable.js?v=abc"]) {
    expect(await fetch(path)).not.toBe(await fetch(path));
  }
  const beforeReset = requests;
  handlers.message({ data: { source: "preview-cache", type: "reset" }, source: { url: "http://localhost/__guest/" }, ports: [] });
  await fetch(dependency);
  expect(requests).toBe(beforeReset);
  handlers.message({ data: { source: "preview-cache", type: "reset" }, source: owner, ports: [] });
  await fetch(dependency);
  expect(requests).toBe(beforeReset + 1);
});

test("interactive terminal frames share the serial channel with HTTP without leaking input or control bytes", async () => {
  const source = await Bun.file(new URL("../public/serial-bridge.js", import.meta.url)).text();
  const output: Buffer[] = [];
  const input: string[] = [];
  const host: Record<string, any> = {};
  const runtime = { parent: host, addEventListener() {} };
  const slave = {
    write(data: string | number[]) { output.push(Buffer.from(data)); },
    ldisc: { writeFromLower(data: string) { input.push(data); } },
    ioctl() { return [35, 120]; },
  };
  runInNewContext(source, { window: host, TextDecoder, Uint8Array, atob, setTimeout, clearTimeout, location: { origin: "http://localhost" } });
  const bridge = host.installSerialBridge(slave, runtime);
  slave.write(`\x1e${JSON.stringify({ type: "ready" })}\n`);
  expect(JSON.parse(input.shift()!)).toEqual({ type: "terminal-open", rows: 35, cols: 120 });
  slave.ldisc.writeFromLower("echo hello\r\x03");
  expect(JSON.parse(input.shift()!)).toEqual({ type: "terminal-input", data: "echo hello\r\x03" });
  bridge.resizeTerminal(90, 25);
  expect(JSON.parse(input.shift()!)).toEqual({ type: "terminal-resize", cols: 90, rows: 25 });
  const response = bridge.request({ type: "http", method: "GET", path: "/" });
  const request = JSON.parse(input.shift()!);
  const terminalBytes = Buffer.from("\x1b[32mhello ✨\x1e\r\n");
  // Even a record separator emitted by a shell program stays inside its payload.
  const wire = `\x1e${JSON.stringify({ type: "terminal-data", data: terminalBytes.toString("base64") })}\n` +
    `\x1e${JSON.stringify({ id: request.id, status: 200, body: "ok" })}\n`;
  const before = output.length;
  for (const byte of Buffer.from(wire)) slave.write([byte]);
  expect(Buffer.concat(output.slice(before))).toEqual(terminalBytes);
  expect(await response).toMatchObject({ status: 200, body: "ok" });
  slave.write(`\x1e${JSON.stringify({ type: "terminal-exit", code: 0 })}\n`);
  expect(Buffer.concat(output).toString()).toContain("preview remains connected");
  expect(bridge.stats.errors).toBe(0);
});
