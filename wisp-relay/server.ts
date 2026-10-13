// A private Wisp server: one WebSocket carries TCP streams to hosts on the internet, bytes
// copied both ways and never looked at. For pages that do their own TLS in the tab
// (agent-studio's `?relay=wss://...`, browser-agent-toolkit's `?wisp=`), instead of
// somebody's public Wisp server.
//
// The protocol work is Mercury Workshop's wisp-js (the reference server, Wisp v1 and v2).
// What is here is where it listens and what it refuses:
//   - loopback only; `tailscale serve` puts the tailnet's https in front (setup.sh);
//   - TCP only, to port 443 only (WISP_PORTS), by name only (no literal addresses);
//   - a name is resolved here, every address it resolves to has to be public (not private,
//     loopback, link-local, CGNAT/tailnet, unique-local, multicast or reserved), and the
//     connection is made to the address that was checked;
//   - a browser has to come from an allowed page origin (WISP_ORIGINS): a WebSocket is not
//     subject to CORS, so without this any site open in a browser on the tailnet could use
//     the relay. A client that sends no Origin (a script on a tailnet device) is let in.
//
//   HOST, PORT      where to listen. Default 127.0.0.1:4805.
//   WISP_PORTS      destination ports allowed. Default 443.
//   WISP_ORIGINS    allowed page origins: `https://host[:port]` exactly, or a bare host name
//                   (`localhost`, `*.example.ts.net`) on any scheme and port. Required.
//   WISP_LOG        DEBUG | INFO | WARN | ERROR | NONE. Default INFO: one line per stream,
//                   host and port, never content.
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import { logging, server as wisp } from "@mercuryworkshop/wisp-js/server";

const list = (value: string | undefined) => (value ?? "").split(/[\s,]+/).filter(Boolean);

/**
 * Addresses a name may resolve to. From browser-agent-toolkit's packages/relay
 * (tcp-relay.ts, `isPublicAddress`); stricter than wisp-js's own check, which lets
 * IPv6 unique-local (the tailnet's fd7a:...) and IPv4-mapped addresses through.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast and reserved
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT: tailnet addresses live here
    if (a === 169 && b === 254) return false; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
    return true;
  }
  if (family === 6) {
    const text = address.toLowerCase().split("%")[0]!;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
    if (mapped) return isPublicAddress(mapped[1]!);
    const [head = "", tail = ""] = text.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = text.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
    const words = groups.map((group) => parseInt(group, 16));
    if (words.length !== 8 || words.some(Number.isNaN)) return false;
    const first = words[0]!;
    if (words.slice(0, 7).every((word) => word === 0)) return false; // :: and ::1
    if ((first & 0xfe00) === 0xfc00) return false; // unique local (tailnet fd7a:...)
    if ((first & 0xffc0) === 0xfe80) return false; // link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (first === 0x2001 && words[1] === 0xdb8) return false; // documentation
    if (first === 0x64 && words[1] === 0xff9b) return false; // NAT64: an IPv4 address in disguise
    if (words.slice(0, 5).every((word) => word === 0)) return false; // IPv4-compatible and other ::/80 forms
    return true;
  }
  return false;
}

/**
 * wisp-js asks this for a name's address twice: once to check it, once to connect.
 * Both get an address that passed, or a throw, which ends the stream.
 */
async function resolvePublic(hostname: string): Promise<string> {
  const found = await lookup(hostname, { all: true });
  // Every answer has to be public: a name with one private address among its answers is not trusted for any.
  if (!found.length || !found.every((entry) => isPublicAddress(entry.address))) {
    logging.warn(`refused ${hostname}: it resolves to an address the relay does not connect to`);
    throw new Error(`${hostname} does not resolve to a public address`);
  }
  return (found.find((entry) => entry.family === 4) ?? found[0]!).address;
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  const url = URL.parse(origin);
  if (!url) return false;
  return allowed.some((entry) => {
    if (entry.includes("://")) return entry.replace(/\/$/, "") === url.origin;
    return entry.startsWith("*.") ? url.hostname.endsWith(entry.slice(1)) : url.hostname === entry;
  });
}

function refuse(socket: Duplex, status: string, body: string) {
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

const origins = list(process.env.WISP_ORIGINS);
if (!origins.length) {
  console.error("WISP_ORIGINS is required: the page origins allowed to use this relay, e.g. WISP_ORIGINS='https://app.example localhost'");
  process.exit(2);
}
const ports = list(process.env.WISP_PORTS ?? "443").map(Number);
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT) || 4805;

Object.assign(wisp.options, {
  port_whitelist: ports,
  allow_direct_ip: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  allow_udp_streams: false,
  dns_method: resolvePublic,
  stream_limit_total: 64,
});
logging.set_level(logging[(process.env.WISP_LOG ?? "INFO").toUpperCase() as "INFO"] ?? logging.INFO);

const http = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  response.end("wisp relay: a WebSocket at /\n");
});
http.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  // Only `/` is Wisp. wisp-js treats any other path as wsproxy (`/host:port`), which is not offered here.
  if (new URL(request.url ?? "/", "http://relay").pathname !== "/") return refuse(socket, "404 Not Found", "wisp relay: the WebSocket is at /\n");
  if (!originAllowed(origin, origins)) {
    logging.warn(`refused a connection from origin ${origin}`);
    return refuse(socket, "403 Forbidden", "wisp relay: this page's origin is not allowed\n");
  }
  wisp.routeRequest(request, socket, head);
});
// One bad stream is not a reason to drop the others.
process.on("unhandledRejection", (error) => logging.error(`unhandled rejection: ${error instanceof Error ? (error.stack ?? error.message) : error}`));
http.listen(port, host, () => {
  console.log(`wisp relay on ${host}:${port} for ${origins.join(", ")} -> any public host, port ${ports.join(", ")}`);
});
