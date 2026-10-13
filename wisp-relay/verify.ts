#!/usr/bin/env bun
// Checks a running relay the way a page uses it: Wisp v1, one stream per WebSocket.
//
//   bun verify.ts [ws(s)://relay/]      default wss://diesel2.guineafowl-truck.ts.net:4805/
//
// Opens a stream to a public host on 443, sends a TLS ClientHello and expects a TLS
// record back; then asks for destinations the relay has to refuse. Exits 1 if any
// answer is not the expected one.
import { connect as tlsConnect } from "node:tls";
import { createServer, type Socket } from "node:net";

const relay = process.argv[2] ?? "wss://diesel2.guineafowl-truck.ts.net:4805/";

const reasons: Record<number, string> = {
  0x01: "unknown", 0x02: "voluntary", 0x03: "network error", 0x41: "invalid", 0x42: "unreachable",
  0x43: "timeout", 0x44: "refused", 0x47: "transfer timeout", 0x48: "blocked", 0x49: "throttled",
};

function packet(type: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(5 + payload.length);
  bytes[0] = type;
  new DataView(bytes.buffer).setUint32(1, 1, true);
  bytes.set(payload, 5);
  return bytes;
}

/** A real ClientHello for `host`: what node's TLS writes first, caught on a loopback socket. */
function clientHello(host: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      socket.once("data", (data) => {
        resolve(new Uint8Array(data));
        socket.destroy();
        server.close();
      });
    }).listen(0, "127.0.0.1", () => {
      const client = tlsConnect({ host: "127.0.0.1", port: (server.address() as { port: number }).port, servername: host });
      client.on("error", () => {});
    });
    server.on("error", reject);
  });
}

interface Outcome {
  /** The first packet's type (3 CONTINUE: Wisp v1; 5 INFO: v2). */
  greeting?: number;
  received: Uint8Array;
  /** The CLOSE reason, if the relay closed the stream. */
  closed?: number;
  /** The HTTP upgrade was refused. */
  rejected?: boolean;
}

function stream(host: string, port: number, hello?: Uint8Array, headers?: Record<string, string>, type = 1): Promise<Outcome> {
  return new Promise((resolve) => {
    const outcome: Outcome = { received: new Uint8Array(0) };
    let opened = false;
    const ws = new WebSocket(relay, { headers } as never);
    ws.binaryType = "arraybuffer";
    const done = () => {
      clearTimeout(timer);
      ws.close();
      resolve(outcome);
    };
    const timer = setTimeout(done, 15_000);
    ws.onerror = () => {
      if (!opened) outcome.rejected = true;
      done();
    };
    ws.onclose = done;
    ws.onopen = () => (opened = true);
    ws.onmessage = (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (outcome.greeting === undefined) {
        outcome.greeting = bytes[0];
        const name = new TextEncoder().encode(host);
        const connect = new Uint8Array(3 + name.length);
        connect[0] = type;
        new DataView(connect.buffer).setUint16(1, port, true);
        connect.set(name, 3);
        ws.send(packet(1, connect));
        if (hello) ws.send(packet(2, hello));
        return;
      }
      if (bytes[0] === 2) {
        outcome.received = new Uint8Array([...outcome.received, ...bytes.subarray(5)]);
        if (outcome.received.length >= 5) done();
      } else if (bytes[0] === 4) {
        outcome.closed = bytes[5];
        done();
      }
    };
  });
}

let failed = false;
const report = (ok: boolean, line: string) => {
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
};
const said = (outcome: Outcome) =>
  outcome.rejected ? "upgrade refused" : outcome.closed !== undefined ? `CLOSE 0x${outcome.closed.toString(16)} (${reasons[outcome.closed] ?? "?"})` : outcome.received.length ? `${outcome.received.length} bytes` : "nothing";

console.log(`relay ${relay}`);
for (const host of ["example.com", "opencode.ai"]) {
  const outcome = await stream(host, 443, await clientHello(host));
  const [type, major] = outcome.received;
  // A TLS record: handshake (22), version 3.x. The ServerHello.
  report(type === 22 && major === 3, `${host}:443 -> ${said(outcome)}, first bytes ${Buffer.from(outcome.received.subarray(0, 5)).toString("hex")} (greeting type ${outcome.greeting})`);
}

const refusals: [string, number, string][] = [
  ["example.com", 80, "a port other than 443"],
  ["example.com", 22, "a port other than 443"],
  ["127.0.0.1", 443, "loopback, by address"],
  ["localhost", 443, "loopback, by name"],
  ["192.168.1.1", 443, "the LAN, by address"],
  ["100.96.253.39", 443, "the tailnet, by address"],
  ["diesel2.guineafowl-truck.ts.net", 443, "the tailnet, by name"],
  ["[fd7a:115c:a1e0::9d36:fd28]", 443, "the tailnet's IPv6, by address"],
  ["169.254.169.254", 443, "link-local"],
  ["1.1.1.1", 443, "a public address without a name"],
  ["2130706433", 443, "loopback as a number"],
];
for (const [host, port, what] of refusals) {
  const outcome = await stream(host, port);
  report(outcome.closed !== undefined && outcome.closed !== 0x02 && !outcome.received.length, `refused ${host}:${port} (${what}) -> ${said(outcome)}`);
}
{
  const outcome = await stream("example.com", 443, undefined, undefined, 2);
  report(outcome.closed !== undefined && !outcome.received.length, `refused UDP example.com:443 -> ${said(outcome)}`);
}
{
  const outcome = await stream("example.com", 443, undefined, { Origin: "https://evil.example" });
  report(outcome.rejected === true, `refused a page of another origin (https://evil.example) -> ${said(outcome)}`);
}
{
  const outcome = await stream("example.com", 443, await clientHello("example.com"), { Origin: "https://zu4tgfuxau5n.opentunnel.xyz" });
  report(outcome.received[0] === 22, `the page's origin (https://zu4tgfuxau5n.opentunnel.xyz) -> ${said(outcome)}`);
}
process.exit(failed ? 1 : 0);
