import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

// One-time import into an empty parent index. Pause all PicSync writers first.
const root = await realpath(Bun.argv[2] ?? "/home/pi/photos");
const source = join(root, "iphone-uploads", ".picsync");
const target = join(root, ".picsync");
async function exists(path: string) {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
if (await exists(target)) throw new Error("Parent .picsync already exists; refusing to replace it");
function prefixed(path: unknown): string {
  if (typeof path !== "string" || !path || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`Invalid relative path: ${path}`);
  }
  return `iphone-uploads/${path}`;
}
const records: { path: string; original: string; updated: string }[] = [];
let bytes = 0;
for (const prefix of await readdir(join(source, "objects"))) {
  if (!/^[a-f0-9]{2}$/.test(prefix)) continue;
  for (const name of await readdir(join(source, "objects", prefix))) {
    if (!name.endsWith(".json")) continue;
    const path = join("objects", prefix, name);
    const original = await readFile(join(source, path), "utf8");
    const record = JSON.parse(original);
    if (record.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(record.fingerprint) || name !== `${record.fingerprint}.json` || prefix !== record.fingerprint.slice(0, 2) || !Array.isArray(record.resources) || !record.resources.length) throw new Error(`Invalid record: ${path}`);
    for (const resource of record.resources) {
      if (!/^[a-zA-Z]+$/.test(resource.role) || !Number.isSafeInteger(resource.byteCount) || resource.byteCount < 0 || !/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error(`Invalid resource: ${path}`);
      resource.finalPath = prefixed(resource.finalPath);
      if (resource.temporaryPath != null) resource.temporaryPath = prefixed(resource.temporaryPath);
      const media = await realpath(resolve(root, resource.finalPath));
      if (!media.startsWith(root + sep)) throw new Error(`Path escapes archive: ${media}`);
      const info = await stat(media);
      if (!info.isFile() || info.size !== resource.byteCount) throw new Error(`Missing/incorrect size: ${media}`);
      bytes += info.size;
    }
    const canonical = [...record.resources].sort((a, b) => {
      const x = a.role === b.role ? a.sha256 : a.role;
      const y = a.role === b.role ? b.sha256 : b.role;
      return x < y ? -1 : x > y ? 1 : 0;
    }).map(r => `${r.role}|${r.byteCount}|${r.sha256}`).join("\n");
    if (createHash("sha256").update(canonical).digest("hex") !== record.fingerprint) throw new Error(`Fingerprint mismatch: ${path}`);
    records.push({ path, original, updated: JSON.stringify(record) });
  }
}
if (!records.length) throw new Error("No source records");
console.log(JSON.stringify({ phase: "preflight", records: records.length, bytes }));
const stamp = new Date().toISOString().replaceAll(":", "-");
const backup = join(root, `.picsync-import-backup-${stamp}`);
await cp(source, backup, { recursive: true, errorOnExist: true, force: false });
const staging = join(root, `.picsync-import-staging-${stamp}`);
await mkdir(staging);
for (const record of records) {
  if (await readFile(join(source, record.path), "utf8") !== record.original) throw new Error("Source changed during import; keep uploads paused");
  const output = join(staging, record.path);
  await mkdir(join(output, ".."), { recursive: true });
  await writeFile(output, record.updated, { flag: "wx" });
}
await writeFile(join(staging, "import-summary.json"), JSON.stringify({ source, backup, records: records.length, bytes, importedAt: stamp, validation: "fingerprint and file size; full checksum verification separate" }, null, 2));
if (await exists(target)) throw new Error("Parent index appeared during import; refusing to publish");
await rename(staging, target);
console.log(JSON.stringify({ phase: "imported", records: records.length, bytes, backup, target }));
