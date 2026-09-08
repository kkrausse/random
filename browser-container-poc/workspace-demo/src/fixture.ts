import type { Workspace, WorkspaceFs } from "@vivari/workspace-api";

const key = "workspace-demo.fixture.v1";
const encoder = new TextEncoder();
export const starterFiles: Record<string, string> = {
  "/index.html": '<!doctype html>\n<html><body>\n<h1>Hello from the workspace fixture</h1>\n<p>Edit /index.html and write the file to update this static preview.</p>\n<!-- TODO: launch real Vite when the runtime and dependencies are ready. -->\n</body></html>\n',
  "/src/App.tsx": 'export default function App() {\n  return <h1>Hello from the workspace</h1>;\n}\n',
  "/package.json": JSON.stringify({ name: "workspace-example", private: true, scripts: { dev: "vite --host 0.0.0.0 --port 5173 --strictPort" } }, null, 2) + "\n",
};

/** UI fixture only: localStorage snapshots, no workers, OPFS, or execution. */
export function openFixture(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): Workspace {
  const saved = storage.getItem(key);
  const entries: unknown = saved ? JSON.parse(saved) : Object.entries(starterFiles).map(([path, text]) => [path, [...encoder.encode(text)]]);
  if (!Array.isArray(entries)) throw new Error("Invalid fixture snapshot");
  const files = new Map<string, Uint8Array>();
  const directories = new Set(["/"]);
  const listeners = new Set<Parameters<WorkspaceFs["watch"]>[0]>();
  let closed = false;
  function pathOf(path: string) {
    if (!path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) throw new Error("Use an absolute workspace path without . or ..");
    return path.replace(/\/+$/, "") || "/";
  }
  function parents(path: string) {
    const parts = path.split("/");
    while (parts.length > 1) { parts.pop(); directories.add(parts.join("/") || "/"); }
  }
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1]) || !entry[1].every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255)) throw new Error("Invalid fixture file");
    const path = pathOf(entry[0]);
    files.set(path, new Uint8Array(entry[1])); parents(path);
  }
  function check() { if (closed) throw new Error("Fixture workspace is closed"); }
  function changed(paths: string[]) { for (const listener of listeners) listener({ paths }); }
  const fs: WorkspaceFs = {
    async readFile(path) { check(); const bytes = files.get(pathOf(path)); if (!bytes) throw new Error(`File not found: ${path}`); return bytes.slice(); },
    async writeFile(path, data) {
      check(); path = pathOf(path);
      if (directories.has(path)) throw new Error("Cannot write a directory");
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      if (!directories.has(parent)) throw new Error(`Parent directory not found: ${parent}`);
      files.set(path, typeof data === "string" ? encoder.encode(data) : data.slice()); changed([path]);
    },
    async stat(path) { check(); path = pathOf(path); const bytes = files.get(path); if (!bytes && !directories.has(path)) throw new Error(`Path not found: ${path}`); return { isFile: !!bytes, isDirectory: directories.has(path), size: bytes?.length ?? 0 }; },
    async readdir(path) { check(); path = pathOf(path); if (!directories.has(path)) throw new Error(`Directory not found: ${path}`); const prefix = path === "/" ? "/" : path + "/"; return [...new Set([...files.keys(), ...directories].filter((name) => name.startsWith(prefix) && name !== path).map((name) => name.slice(prefix.length).split("/")[0]!))].sort(); },
    async mkdir(path) { check(); path = pathOf(path); if (files.has(path)) throw new Error("File already exists"); parents(path); directories.add(path); changed([path]); },
    async rename(from, to) { check(); from = pathOf(from); to = pathOf(to); if (files.has(to) || directories.has(to)) throw new Error("Destination exists"); const bytes = await fs.readFile(from); await fs.writeFile(to, bytes); files.delete(from); changed([from, to]); },
    async remove(path) { check(); path = pathOf(path); if (directories.has(path)) throw new Error("Fixture supports file removal only"); if (!files.delete(path)) throw new Error(`File not found: ${path}`); changed([path]); },
    watch(listener) { check(); listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    id: "workspace-demo-fixture", fs,
    persistence: { status: "ephemeral", reason: "UI fixture; explicit snapshots use localStorage, not the API durability contract" },
    async flush() { check(); storage.setItem(key, JSON.stringify([...files].map(([path, bytes]) => [path, [...bytes]]))); },
    async close() { closed = true; listeners.clear(); },
  };
}
