import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, extname } from "node:path";

export const formats: Record<string, string> = {
  ".arw": "image/x-sony-arw",
  ".dng": "image/dng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
export async function resolveArchive(root: string, path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).some((p) => p.startsWith(".")))
    throw new Error("Invalid path");
  const resolved = await realpath(join(root, path));
  const child = relative(root, resolved);
  if (child === ".." || child.startsWith("../") || isAbsolute(child))
    throw new Error("Outside archive");
  return resolved;
}
export async function listArchive(root: string, path: string) {
  const directory = await resolveArchive(root, path);
  const entries = await readdir(directory, { withFileTypes: true });
  const folders: { name: string; path: string }[] = [];
  const photos: { name: string; path: string; bytes: number; raw: boolean }[] =
    [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const child = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) folders.push({ name: entry.name, path: child });
    else if (entry.isFile() && formats[extname(entry.name).toLowerCase()]) {
      const info = await stat(join(directory, entry.name));
      photos.push({
        name: entry.name,
        path: child,
        bytes: info.size,
        raw: /\.(arw|dng)$/i.test(entry.name),
      });
    }
  }
  const sort = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  return { path, folders: folders.sort(sort), photos: photos.sort(sort) };
}
