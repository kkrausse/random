import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
import { imageSize } from "image-size";

export interface UploadedPhotoRef {
  id: string;
}

export interface StoredPhotoFile {
  filename: string;
  width?: number;
  height?: number;
}

export function getUploadsDir() {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "uploads");
}

function getStagedUploadsDir(userId: string) {
  return path.join(getUploadsDir(), ".staged", encodeURIComponent(userId));
}

export function isSafeUploadFilename(filename: string) {
  return filename.length > 0 && !filename.includes("..") && !filename.includes("/") && !filename.includes("\\");
}

function getExtension(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext && /^[a-z0-9]+$/.test(ext) ? ext : "jpg";
}

function getDimensions(buffer: Buffer) {
  try {
    const dims = imageSize(buffer);
    return { width: dims.width, height: dims.height };
  } catch {
    return {};
  }
}

export async function storeUploadedFile(file: File): Promise<StoredPhotoFile> {
  const uploadsDir = getUploadsDir();
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${uuid()}.${getExtension(file)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), buffer);

  return { filename, ...getDimensions(buffer) };
}

export async function stageUploadedFile(userId: string, file: File): Promise<StoredPhotoFile & UploadedPhotoRef> {
  const stagedDir = getStagedUploadsDir(userId);
  await mkdir(stagedDir, { recursive: true });

  const id = `${uuid()}.${getExtension(file)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(stagedDir, id), buffer);

  return { id, filename: id, ...getDimensions(buffer) };
}

export async function promoteStagedUpload(userId: string, id: string): Promise<StoredPhotoFile> {
  if (!isSafeUploadFilename(id)) {
    throw new Error("Invalid upload id");
  }

  const uploadsDir = getUploadsDir();
  await mkdir(uploadsDir, { recursive: true });

  const stagedPath = path.join(getStagedUploadsDir(userId), id);
  const finalPath = path.join(uploadsDir, id);
  await rename(stagedPath, finalPath);

  const buffer = await readFile(finalPath);
  return { filename: id, ...getDimensions(buffer) };
}

export async function readStagedUpload(userId: string, id: string) {
  if (!isSafeUploadFilename(id)) {
    throw new Error("Invalid upload id");
  }

  return readFile(path.join(getStagedUploadsDir(userId), id));
}
