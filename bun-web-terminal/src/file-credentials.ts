import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { decodeCredentials, generateCredentials, type Credentials } from "./credentials";

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function checkPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid terminal port.");
}

async function checkDirectory(directory: string, create: boolean) {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  let stat;
  try {
    stat = await lstat(directory);
  } catch (error) {
    if (!create && missing(error)) return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
    throw new Error("Terminal credential directory must be owned by the current user, private (0700), and not a symlink.");
  }
  return true;
}

async function readCredentials(path: string): Promise<Credentials | undefined> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
      throw new Error("Terminal credential file must be owned by the current user, private (0600), and a regular file.");
    }
    if (stat.size > 4096) throw new Error("Invalid stored terminal credentials.");
    return decodeCredentials(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}

export async function loadFileCredentials(directory: string, port: number): Promise<Credentials> {
  checkPort(port);
  await checkDirectory(directory, true);
  const path = join(directory, `port-${port}.auth`);
  const existing = await readCredentials(path);
  if (existing) return existing;

  // Publish a complete file atomically, without replacing a concurrent startup's secret.
  const temporary = join(directory, `.credentials-${randomUUID()}`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(Buffer.from(JSON.stringify({ version: 1, ...generateCredentials() })).toString("base64"));
      await file.sync();
    } finally {
      await file.close();
    }
    try { await link(temporary, path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await unlink(temporary);
  }
  const saved = await readCredentials(path);
  if (!saved) throw new Error("Could not save terminal credentials.");
  const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  return saved;
}

export async function resetFileCredentials(directory: string, port: number) {
  checkPort(port);
  if (!await checkDirectory(directory, false)) return;
  const path = join(directory, `port-${port}.auth`);
  try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
}
