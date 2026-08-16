import { readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { AppConfig, MediaAsset } from "../lib/types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"]);

function containedPath(root: string, relativePath: string) {
  const result = resolve(root, relativePath);
  const fromRoot = relative(root, result);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Invalid media path");
  return result;
}

async function walk(root: string, current = ""): Promise<MediaAsset[]> {
  const entries = await readdir(join(root, current), { withFileTypes: true });
  const results = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) return [];
    const relativePath = join(current, entry.name);
    if (entry.isDirectory()) return walk(root, relativePath);
    if (!entry.isFile() || !VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) return [];
    return [{ id: relativePath, filename: entry.name, relativePath }];
  }));
  return results.flat();
}

export async function listMedia(config: AppConfig) {
  return (await walk(config.mediaRoot)).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
}

export async function resolveAsset(config: AppConfig, id: string) {
  if (!id || !VIDEO_EXTENSIONS.has(extname(id).toLowerCase())) throw new Error("Unknown media asset");
  const sourcePath = containedPath(config.mediaRoot, id);
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error("Unknown media asset");
  return { sourcePath, sourceStat };
}
