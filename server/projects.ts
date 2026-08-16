import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { NormalizedCrop, Project, ProjectSettings, TimelineItem } from "../lib/types";

export class ProjectValidationError extends Error {}
export class ProjectNotFoundError extends Error {}
export class ProjectConflictError extends Error {}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 30 };
const MAX_PROJECT_DIMENSION = 8192;
const MAX_PROJECT_FPS = 240;
const projectLocks = new Map<string, Promise<void>>();

function fail(message: string): never {
  throw new ProjectValidationError(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) fail(`Unexpected ${label} field: ${unexpected}`);
}

function nonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) fail(`Invalid ${label}`);
  return value;
}

function positiveNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`Invalid ${label}`);
  return value;
}

function nonNegativeNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`Invalid ${label}`);
  return value;
}

function validateCrop(value: unknown): NormalizedCrop | undefined {
  if (value === undefined) return undefined;
  const crop = object(value, "crop");
  onlyKeys(crop, ["x", "y", "width", "height"], "crop");
  const x = nonNegativeNumber(crop.x, "crop.x");
  const y = nonNegativeNumber(crop.y, "crop.y");
  const width = positiveNumber(crop.width, "crop.width");
  const height = positiveNumber(crop.height, "crop.height");
  if (x + width > 1 || y + height > 1) fail("Invalid crop bounds");
  return { x, y, width, height };
}

export function validateProjectSettings(value: unknown): ProjectSettings {
  const settings = object(value, "project settings");
  onlyKeys(settings, ["width", "height", "fps"], "settings");
  const width = positiveNumber(settings.width, "settings.width");
  const height = positiveNumber(settings.height, "settings.height");
  const fps = positiveNumber(settings.fps, "settings.fps");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > MAX_PROJECT_DIMENSION || height > MAX_PROJECT_DIMENSION || width % 2 || height % 2) {
    fail(`Project dimensions must be even and between 2 and ${MAX_PROJECT_DIMENSION}`);
  }
  if (fps > MAX_PROJECT_FPS) fail(`Project fps must be at most ${MAX_PROJECT_FPS}`);
  return { width, height, fps };
}

function validateItem(value: unknown, index: number): TimelineItem {
  const item = object(value, `item ${index}`);
  const id = nonEmptyString(item.id, `items[${index}].id`);
  const mediaId = nonEmptyString(item.mediaId, `items[${index}].mediaId`);
  if (item.stabilize !== true && item.stabilize !== false) fail(`Invalid items[${index}].stabilize`);
  const common = { id, mediaId, stabilize: item.stabilize, crop: validateCrop(item.crop) };
  if (item.kind === "video") {
    onlyKeys(item, ["id", "mediaId", "kind", "sourceIn", "sourceOut", "stabilize", "crop"], `items[${index}]`);
    const sourceIn = nonNegativeNumber(item.sourceIn, `items[${index}].sourceIn`);
    const sourceOut = positiveNumber(item.sourceOut, `items[${index}].sourceOut`);
    if (sourceOut <= sourceIn) fail(`Invalid items[${index}] source range`);
    return { ...common, kind: "video", sourceIn, sourceOut };
  }
  if (item.kind === "photo") {
    onlyKeys(item, ["id", "mediaId", "kind", "photoDuration", "stabilize", "crop"], `items[${index}]`);
    return { ...common, kind: "photo", photoDuration: positiveNumber(item.photoDuration, `items[${index}].photoDuration`) };
  }
  return fail(`Invalid items[${index}].kind`);
}

export function validateProject(value: unknown): Project {
  const project = object(value, "project");
  onlyKeys(project, ["version", "id", "name", "createdAt", "updatedAt", "revision", "settings", "items"], "project");
  if (project.version !== 1) fail("Unsupported project version");
  const id = validId(nonEmptyString(project.id, "project id"));
  const name = nonEmptyString(project.name, "project name");
  const createdAt = nonEmptyString(project.createdAt, "createdAt");
  const updatedAt = nonEmptyString(project.updatedAt, "updatedAt");
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) fail("Invalid project timestamp");
  if (!Number.isInteger(project.revision) || (project.revision as number) < 1) fail("Invalid project revision");
  if (!Array.isArray(project.items)) fail("Invalid project items");
  const items = project.items.map(validateItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) fail("Timeline item IDs must be unique");
  return {
    version: 1, id, name, createdAt, updatedAt,
    revision: project.revision as number,
    settings: validateProjectSettings(project.settings),
    items,
  };
}

function validId(id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) fail("Invalid project id");
  return id;
}

function projectPath(root: string, id: string) {
  const path = resolve(root, `${validId(id)}.json`);
  const fromRoot = relative(resolve(root), path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) fail("Invalid project path");
  return path;
}

async function atomicWrite(root: string, project: Project) {
  await mkdir(root, { recursive: true });
  const path = projectPath(root, project.id);
  const temporary = join(root, `.${project.id}-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withProjectLock<T>(root: string, id: string, operation: () => Promise<T>): Promise<T> {
  const key = projectPath(root, id);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  projectLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectLocks.get(key) === current) projectLocks.delete(key);
  }
}

export async function listProjects(root: string): Promise<Project[]> {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const projects = await Promise.all(entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".json"))
    .map(async (entry) => {
      const project = validateProject(JSON.parse(await readFile(join(root, entry.name), "utf8")));
      if (`${project.id}.json` !== entry.name) throw new Error(`Project file ID mismatch: ${entry.name}`);
      return project;
    }));
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readProject(root: string, id: string): Promise<Project> {
  const path = projectPath(root, id);
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isFile()) throw new ProjectNotFoundError("Project not found");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ProjectNotFoundError("Project not found");
    throw error;
  }
  const project = validateProject(JSON.parse(await readFile(path, "utf8")));
  if (project.id !== id) throw new Error("Project file ID mismatch");
  return project;
}

export async function createProject(root: string, value: unknown = {}): Promise<Project> {
  const input = object(value, "project input");
  onlyKeys(input, ["name", "settings"], "project input");
  const now = new Date().toISOString();
  const project: Project = {
    version: 1,
    id: crypto.randomUUID(),
    name: input.name === undefined ? "Untitled Project" : nonEmptyString(input.name, "project name"),
    createdAt: now,
    updatedAt: now,
    revision: 1,
    settings: input.settings === undefined ? { ...DEFAULT_PROJECT_SETTINGS } : validateProjectSettings(input.settings),
    items: [],
  };
  await atomicWrite(root, project);
  return project;
}

export async function updateProject(root: string, id: string, value: unknown): Promise<Project> {
  const submitted = validateProject(value);
  if (submitted.id !== id) fail("Project id does not match URL");
  return withProjectLock(root, id, async () => {
    const current = await readProject(root, id);
    if (submitted.revision !== current.revision) throw new ProjectConflictError("Project revision conflict");
    if (submitted.createdAt !== current.createdAt) fail("createdAt cannot be changed");
    const updated = { ...submitted, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    await atomicWrite(root, updated);
    return updated;
  });
}

export async function deleteProject(root: string, id: string, revision: unknown): Promise<void> {
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) fail("Invalid project revision");
  await withProjectLock(root, id, async () => {
    const current = await readProject(root, id);
    if (revision !== current.revision) throw new ProjectConflictError("Project revision conflict");
    await rm(projectPath(root, id));
  });
}
