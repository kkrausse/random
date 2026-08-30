import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  deleteProject,
  listProjects,
  ProjectConflictError,
  ProjectValidationError,
  readProject,
  updateProject,
  validateProject,
} from "./projects";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "video-editor-projects-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project persistence", () => {
  test("creates, reads, lists, updates, and deletes projects", async () => {
    const root = await temporaryRoot();
    const created = await createProject(root, { name: "Vacation" });
    expect(created.settings).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(await readProject(root, created.id)).toEqual(created);
    expect(await listProjects(root)).toEqual([created]);

    const updated = await updateProject(root, created.id, { ...created, name: "Vacation cut" });
    expect(updated.name).toBe("Vacation cut");
    expect(updated.revision).toBe(2);
    expect((await readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(false);

    await deleteProject(root, created.id, updated.revision);
    expect(await listProjects(root)).toEqual([]);
  });

  test("rejects stale concurrent updates", async () => {
    const root = await temporaryRoot();
    const project = await createProject(root);
    const results = await Promise.allSettled([
      updateProject(root, project.id, { ...project, name: "First" }),
      updateProject(root, project.id, { ...project, name: "Second" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ProjectConflictError);
  });

  test("validates timeline semantics", () => {
    const now = new Date().toISOString();
    expect(() => validateProject({
      version: 1,
      id: "project",
      name: "Bad range",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      items: [{ id: "clip", mediaId: "movie.mp4", kind: "video", sourceIn: 2, sourceOut: 1, stabilize: false }],
    })).toThrow(ProjectValidationError);

    expect(() => validateProject({
      version: 1,
      id: "project",
      name: "Transition",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      items: [{
        id: "clip",
        mediaId: "movie.mp4",
        kind: "video",
        sourceIn: 0,
        sourceOut: 1,
        stabilize: false,
        transition: { duration: 1 },
      }],
    })).toThrow("Unexpected items[0] field: transition");
  });

  test("rejects traversal project IDs", async () => {
    const root = await temporaryRoot();
    expect(readProject(root, "../outside")).rejects.toBeInstanceOf(ProjectValidationError);
  });
});
