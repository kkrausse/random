import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type Resource = { role: string; byteCount: number; sha256: string; finalPath: string };
type ContentRecord = { schemaVersion: number; fingerprint: string; resources: Resource[] };
const digestPattern = /^[0-9a-f]{64}$/;

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function parseRecord(value: unknown): ContentRecord {
  const record = value as ContentRecord;
  if (record?.schemaVersion !== 1 || !digestPattern.test(record.fingerprint ?? "") ||
      !Array.isArray(record.resources) || record.resources.length === 0) {
    throw new Error("Invalid content record");
  }
  for (const resource of record.resources) {
    if (typeof resource.role !== "string" || !/^[a-zA-Z]+$/.test(resource.role) ||
        !Number.isSafeInteger(resource.byteCount) || resource.byteCount < 0 ||
        !digestPattern.test(resource.sha256 ?? "") || typeof resource.finalPath !== "string" ||
        !resource.finalPath || resource.finalPath.includes("\\") || isAbsolute(resource.finalPath) ||
        resource.finalPath.split("/").some(part => part === ".." || part === "." || !part)) {
      throw new Error("Invalid resource manifest");
    }
  }
  const canonical = [...record.resources]
    .sort((a, b) => {
      const first = a.role === b.role ? a.sha256 : a.role;
      const second = a.role === b.role ? b.sha256 : b.role;
      return first < second ? -1 : first > second ? 1 : 0;
    })
    .map(resource => `${resource.role}|${resource.byteCount}|${resource.sha256}`).join("\n");
  if (createHash("sha256").update(canonical).digest("hex") !== record.fingerprint) {
    throw new Error("Manifest fingerprint does not match its resources");
  }
  return record;
}

export async function verifyRecord(root: string, recordPath: string) {
  const resolvedRoot = await realpath(root);
  const resolvedRecord = await realpath(recordPath);
  if (!within(resolvedRoot, resolvedRecord)) throw new Error("Record escapes share root");
  const recordFile = await open(resolvedRecord, "r");
  let record: ContentRecord;
  try {
    const stat = await recordFile.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw new Error("Invalid record size/type");
    record = parseRecord(JSON.parse(await recordFile.readFile("utf8")));
  } finally { await recordFile.close(); }
  if (recordPath.split(sep).at(-1) !== `${record.fingerprint}.json`) throw new Error("Record filename does not match fingerprint");

  let bytes = 0;
  for (const resource of record.resources) {
    const path = await realpath(resolve(resolvedRoot, resource.finalPath));
    if (!within(resolvedRoot, path)) throw new Error(`Resource escapes share root: ${resource.finalPath}`);
    const handle = await open(path, "r");
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size !== BigInt(resource.byteCount)) throw new Error(`Size/type mismatch: ${resource.finalPath}`);
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ highWaterMark: 1_048_576, autoClose: false })) hash.update(chunk);
      const after = await handle.stat({ bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        throw new Error(`File changed during verification: ${resource.finalPath}`);
      }
      if (hash.digest("hex") !== resource.sha256) throw new Error(`SHA-256 mismatch: ${resource.finalPath}`);
      bytes += resource.byteCount;
    } finally { await handle.close(); }
  }
  return { fingerprint: record.fingerprint, resources: record.resources.length, bytes };
}

export async function verifyArchive(root: string, log: (message: string) => void = console.log) {
  root = await realpath(root);
  const objects = join(root, ".picsync", "objects");
  // Reports are distinct from commit records: a size-checked copy isn't a verified copy.
  const reports = join(root, ".picsync", "verification-reports");
  await mkdir(reports, { recursive: true });
  const reportPath = join(reports, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.jsonl`);
  const output = await open(reportPath, "wx");
  const summary = { status: "finished", verifiedObjects: 0, failedObjects: 0, verifiedResources: 0, verifiedBytes: 0, reportPath };
  try {
    for await (const prefix of await opendir(objects)) {
      if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/.test(prefix.name)) continue;
      for await (const entry of await opendir(join(objects, prefix.name))) {
        if (!entry.name.endsWith(".json")) continue;
        const recordPath = join(objects, prefix.name, entry.name);
        let result;
        try {
          const verified = await verifyRecord(root, recordPath);
          summary.verifiedObjects++;
          summary.verifiedResources += verified.resources;
          summary.verifiedBytes += verified.bytes;
          result = { status: "verified", ...verified };
        } catch (error) {
          summary.failedObjects++;
          result = { status: "failed", recordPath, error: String(error) };
          log(JSON.stringify(result));
        }
        await output.writeFile(`${JSON.stringify({ ...result, checkedAt: new Date().toISOString() })}\n`);
        const total = summary.verifiedObjects + summary.failedObjects;
        if (total % 100 === 0) log(`${total} objects checked; ${summary.failedObjects} failed; ${(summary.verifiedBytes / 1e9).toFixed(1)} GB verified`);
      }
    }
    if (summary.verifiedObjects + summary.failedObjects === 0) throw new Error("No content records found; nothing was verified");
    await output.writeFile(`${JSON.stringify(summary)}\n`);
    await output.sync();
    log(JSON.stringify(summary));
    return summary;
  } finally { await output.close(); }
}

if (import.meta.main) {
  const [root, ...extra] = Bun.argv.slice(2);
  if (!root || extra.length) {
    console.error("Usage: bun verify.ts /absolute/path/to/samba/share-root");
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyArchive(root);
      process.exitCode = result.failedObjects > 0 ? 1 : 0;
    } catch (error) {
      console.error(error);
      process.exitCode = 2;
    }
  }
}
