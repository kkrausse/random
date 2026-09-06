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
