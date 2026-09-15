import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyArchive, verifyRecord } from "./verify";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "picsync-verify-"));
  directories.push(root);
  const sha256 = createHash("sha256").update("original").digest("hex");
  const fingerprint = createHash("sha256").update(`photo|8|${sha256}`).digest("hex");
  const directory = join(root, ".picsync", "objects", fingerprint.slice(0, 2));
  await mkdir(directory, { recursive: true });
  const recordPath = join(directory, `${fingerprint}.json`);
  const record = { schemaVersion: 1, fingerprint, resources: [{ role: "photo", byteCount: 8, sha256, finalPath: "photo ü.jpg" }] };
  await writeFile(join(root, "photo ü.jpg"), "original");
  await writeFile(recordPath, JSON.stringify(record));
  return { root, recordPath, record };
}

test("verifies content and writes a separate verification report", async () => {
  const { root } = await fixture();
  const result = await verifyArchive(root, () => {});
  expect(result.verifiedObjects).toBe(1);
  expect(result.verifiedBytes).toBe(8);
  expect(result.failedObjects).toBe(0);
  expect(await Bun.file(result.reportPath).text()).toContain('"status":"verified"');
});

test("rejects same-size corruption and reports it as failed", async () => {
  const { root } = await fixture();
  await writeFile(join(root, "photo ü.jpg"), "modified");
  const result = await verifyArchive(root, () => {});
  expect(result.failedObjects).toBe(1);
  expect(result.verifiedObjects).toBe(0);
});

test("rejects missing resources and malformed manifests", async () => {
  const { root, recordPath, record } = await fixture();
  await rm(join(root, "photo ü.jpg"));
  await expect(verifyRecord(root, recordPath)).rejects.toThrow();
  record.resources = [];
  await writeFile(recordPath, JSON.stringify(record));
  await expect(verifyRecord(root, recordPath)).rejects.toThrow("Invalid content record");
});

test("rejects paths and symlinks escaping the archive", async () => {
  const { root, recordPath, record } = await fixture();
  record.resources[0]!.finalPath = "../outside.jpg";
  await writeFile(recordPath, JSON.stringify(record));
  await expect(verifyRecord(root, recordPath)).rejects.toThrow("Invalid resource manifest");
  record.resources[0]!.finalPath = "photo ü.jpg";
  await writeFile(recordPath, JSON.stringify(record));
  await rm(join(root, "photo ü.jpg"));
  await symlink("/etc/hosts", join(root, "photo ü.jpg"));
  await expect(verifyRecord(root, recordPath)).rejects.toThrow("Resource escapes share root");
});
