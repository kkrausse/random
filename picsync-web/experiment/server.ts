import { readdir, realpath } from "node:fs/promises";
import { BlockList } from "node:net";
import { basename, dirname, extname, join, relative, isAbsolute } from "node:path";

// Serve only the experiment assets and a fixed sample of untouched originals.
const librawRoot = dirname(Bun.resolveSync("libraw-wasm", import.meta.dir));
const modernRoot = dirname(Bun.resolveSync("libraw-modern", import.meta.dir));
const assets = new Map([
  ["/raw-worker.js", join(import.meta.dir, "raw-worker.js")],
  ["/wasm-viewer.js", join(import.meta.dir, "wasm-viewer.js")],
  ...["parallel-worker.js", "strip-worker.js", "strip-plan.js", "decode-strip.js", "stitch-strips.js"].map(name =>
    [`/${name}`, join(import.meta.dir, name)] as [string, string]),
  ["/vendor/index.js", join(librawRoot, "index.js")],
  ["/vendor/libraw.wasm", join(librawRoot, "libraw.wasm")],
  ...["index.js", "worker.js", "libraw.js", "libraw.wasm"].map(name =>
    [`/modern/${name}`, join(modernRoot, name)] as [string, string]),
]);
const root = await realpath(process.env.MEDIA_ROOT ?? "/home/pi/photos");
const hostname = process.env.HOST ?? "127.0.0.1";
const allowed = new BlockList();
const [network, prefix] = (process.env.LAN_CIDR ?? "127.0.0.0/8").split("/");
if (!network || !prefix || !/^\d+$/.test(prefix)) throw new Error("Invalid LAN_CIDR");
allowed.addSubnet(network, Number(prefix), "ipv4");
const formats: Record<string, string> = {
  ".arw": "image/x-sony-arw",
  ".dng": "image/dng",
  ".heic": "image/heic",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const samples: { path: string; name: string; type: string; bytes: number }[] = [];
const counts = new Map<string, number>();
async function discover(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await discover(path);
    if (!entry.isFile()) continue; // Do not follow symlinks.
    const type = formats[extname(entry.name).toLowerCase()];
    if (!type || (counts.get(type) ?? 0) >= 2) continue;
    samples.push({ path, name: basename(path), type, bytes: Bun.file(path).size });
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
}
await discover(root);

const server = Bun.serve({
  hostname,
  port: Number(process.env.PORT ?? 8788),
  async fetch(request, server) {
    const address = server.requestIP(request)?.address.replace(/^::ffff:/, "");
    if (!address || !allowed.check(address, "ipv4")) return new Response("LAN only", { status: 403 });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    };
    if (url.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "index.html")), { headers });
    const asset = assets.get(url.pathname);
    if (asset) return new Response(Bun.file(asset), { headers });
    if (url.pathname === "/samples") {
      return Response.json(samples.map(({ path, ...sample }, id) => ({ ...sample, id })), { headers });
    }
    const match = /^\/original\/(\d+)$/.exec(url.pathname);
    const sample = match ? samples[Number(match[1])] : undefined;
    if (!sample) return new Response("Not found", { status: 404 });
    // Recheck containment if a sampled file has since been replaced with a symlink.
    try {
      const path = await realpath(sample.path);
      const child = relative(root, path);
      if (child.startsWith("..") || isAbsolute(child)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(path), { headers: { ...headers, "Content-Type": sample.type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
});
console.log(`Original-image experiment: ${server.url} (${samples.length} samples)`);
