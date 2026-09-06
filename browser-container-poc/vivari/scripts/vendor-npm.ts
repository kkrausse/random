// Format from Vivari scripts/vendor-npm.mjs at 2629c710 (MIT).
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const root = new URL("../node_modules/npm/", import.meta.url).pathname;
const files: { p: string; o: number; l: number }[] = [];
const chunks: Buffer[] = [];
let offset = 0;
function walk(dir: string) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) {
      const bytes = readFileSync(join(root, path));
      files.push({ p: path, o: offset, l: bytes.length });
      chunks.push(bytes);
      offset += bytes.length;
    }
  }
}
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (version !== "10.9.2") throw new Error(`Unexpected npm ${version}`);
walk("");
const header = Buffer.from(JSON.stringify({ version, files }));
const size = Buffer.alloc(4);
size.writeUInt32LE(header.length);
await Bun.write(new URL("../public/vendor/npm-pack.bin", import.meta.url), gzipSync(Buffer.concat([size, header, ...chunks]), { level: 9 }));
console.log(`Packed npm ${version}: ${files.length} files`);
