import { test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArchive, resolveArchive } from "./archive";
let root: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "picsync-archive-")));
  await mkdir(join(root, "Trip"));
  await writeFile(join(root, "Trip", "photo10.ARW"), "raw");
  await writeFile(join(root, "Trip", "photo2.jpg"), "jpeg");
  await writeFile(join(root, "Trip", ".secret.jpg"), "hidden");
  await writeFile(join(root, "Trip", "notes.txt"), "notes");
  await symlink(tmpdir(), join(root, "escape"));
});
afterAll(() => rm(root, { recursive: true, force: true }));
test("folder browsing filters unsupported/hidden files and sorts photos naturally", async () => {
  expect((await listArchive(root, "")).folders.map((f) => f.name)).toEqual([
    "Trip",
  ]);
  const listing = await listArchive(root, "Trip");
  expect(listing.photos.map((p) => p.name)).toEqual([
    "photo2.jpg",
    "photo10.ARW",
  ]);
  expect(listing.photos[1]).toMatchObject({
    raw: true,
    bytes: 3,
    path: "Trip/photo10.ARW",
  });
});
test("archive paths reject traversal, absolute paths, hidden files and escaping symlinks", async () => {
  for (const path of [
    "../",
    "/etc/passwd",
    "Trip/../../",
    "Trip/.secret.jpg",
    "escape",
  ]) {
    await expect(resolveArchive(root, path)).rejects.toThrow();
  }
});
