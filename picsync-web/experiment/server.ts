import { readdir, realpath } from "node:fs/promises";
import { BlockList } from "node:net";
import { basename, extname, join, relative, isAbsolute } from "node:path";

// Small, dependency-free experiment: serve a fixed sample of untouched originals.
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
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (url.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "index.html")), { headers });
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
