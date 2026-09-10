import type { Workspace } from "@kev-browser-agent-kit/workspace";

export type SourceWorkspace = Pick<Workspace, "fs" | "flush">;
export async function sourcePaths(workspace: SourceWorkspace, directory = "/"): Promise<string[]> {
  const paths: string[] = [];
  for (const name of await workspace.fs.readdir(directory)) {
    if (["node_modules", ".git", ".opencode-state"].includes(name)) continue;
    const path = `${directory === "/" ? "" : directory}/${name}`;
    if ((await workspace.fs.stat(path)).isDirectory) paths.push(...await sourcePaths(workspace, path));
    else paths.push(path);
  }
  return paths.sort();
}

/** Serial file operations, revision-aware writes, and stale read protection. */
export class SourceDocument {
  private tail: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private generation = 0;
  private saved = 0;
  path = "";
  text = "";
  constructor(readonly workspace: SourceWorkspace) {}
  get dirty() { return this.revision !== this.saved; }
  edit(text: string) { this.text = text; this.revision++; this.generation++; }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => {});
    return result;
  }
  async open(path: string) {
    if (this.dirty) throw Error("Wait for local autosave before reading another file.");
    const generation = ++this.generation;
    return this.enqueue(async () => {
      const bytes = await this.workspace.fs.readFile(path);
      if (generation !== this.generation) return false;
      this.path = path; this.text = new TextDecoder().decode(bytes);
      return true;
    });
  }
  flush() {
    const path = this.path, text = this.text, revision = this.revision;
    if (!path || !this.dirty) return this.tail.then(() => {});
    return this.enqueue(async () => {
      await this.workspace.fs.writeFile(path, text);
      await this.workspace.flush();
      this.saved = revision;
    });
  }
}
