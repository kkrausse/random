import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { AppConfig, MediaAsset, MediaPage } from "../lib/types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"]);
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp", ".arw"]);

export class MediaNotFoundError extends Error {}

function mediaKind(path: string): MediaAsset["kind"] | undefined {
  const extension = extname(path).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (PHOTO_EXTENSIONS.has(extension)) return "photo";
}

function containedPath(root: string, relativePath: string) {
  const result = resolve(root, relativePath);
  const fromRoot = relative(root, result);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new MediaNotFoundError("Unknown media asset");
  return result;
}

async function walk(root: string, current = ""): Promise<MediaAsset[]> {
  const entries = await readdir(join(root, current), { withFileTypes: true });
  const results = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) return [];
    const relativePath = join(current, entry.name);
    if (entry.isDirectory()) return walk(root, relativePath);
    const kind = entry.isFile() ? mediaKind(entry.name) : undefined;
    if (!kind) return [];
    return [{ id: relativePath, filename: entry.name, relativePath, kind }];
  }));
  return results.flat();
}

export async function listMedia(config: AppConfig) {
  return (await walk(config.mediaRoot)).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
}

export function paginateMedia(media: MediaAsset[], limit: number, cursor: string | null, includePhotos: boolean): MediaPage {
  const filtered = includePhotos ? media : media.filter((asset) => asset.kind === "video");
  const start = cursor
    ? filtered.findIndex((asset) => asset.relativePath.localeCompare(cursor, undefined, { numeric: true }) > 0)
    : 0;
  const pageStart = start < 0 ? filtered.length : start;
  const page = filtered.slice(pageStart, pageStart + limit);
  const hasMore = pageStart + page.length < filtered.length;
  return {
    media: page,
    total: filtered.length,
    nextCursor: hasMore ? page.at(-1)!.relativePath : null,
  };
}

export async function resolveAsset(config: AppConfig, id: string) {
  const kind = mediaKind(id);
  if (!id || !kind) throw new MediaNotFoundError("Unknown media asset");
  const sourcePath = containedPath(config.mediaRoot, id);
  let sourceStat;
  try {
    const sourceLstat = await lstat(sourcePath);
    if (sourceLstat.isSymbolicLink()) throw new MediaNotFoundError("Unknown media asset");
    const [realRoot, realSource] = await Promise.all([realpath(config.mediaRoot), realpath(sourcePath)]);
    const fromRealRoot = relative(realRoot, realSource);
    if (fromRealRoot.startsWith("..") || isAbsolute(fromRealRoot)) throw new MediaNotFoundError("Unknown media asset");
    sourceStat = await stat(sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new MediaNotFoundError("Unknown media asset");
    }
    throw error;
  }
  if (!sourceStat.isFile()) throw new MediaNotFoundError("Unknown media asset");
  return { sourcePath, sourceStat, kind };
}
