import type { Distribution, Runtime, Workspace, Endpoint } from "@vivari/workspace-api";
import { loadPrepared, preparedApps, openCodeLaunch, waitForOpenCode, type PreparedManifest } from "./prepared";
import type { Connection, WorkspaceController } from "./workspace-provider";
import { diagnostics } from "./diagnostics";

export async function sourcePaths(workspace: Workspace, directory = "/"): Promise<string[]> {
  const paths: string[] = [];
  for (const name of await workspace.fs.readdir(directory)) {
    if (["node_modules", ".git", ".opencode-state"].includes(name)) continue;
    const path = `${directory === "/" ? "" : directory}/${name}`;
    if ((await workspace.fs.stat(path)).isDirectory) paths.push(...await sourcePaths(workspace, path)); else paths.push(path);
  }
  return paths.sort();
}
export async function seedMissing(workspace: Workspace, project: Record<string, string>, proxy: string) {
  const existing = new Set(await sourcePaths(workspace));
  for (const [path, content] of Object.entries(project)) {
    if (existing.has(path)) continue;
    await workspace.fs.mkdir(path.slice(0, path.lastIndexOf("/")) || "/");
    await workspace.fs.writeFile(path, content.replaceAll("__MODEL_PROXY__", proxy));
  }
  await workspace.flush();
}
/** Native Fetch adapter for the public endpoint, including per-launch guest auth. */
function connection(endpoint: Endpoint, extraHeaders?: HeadersInit): Connection {
  return { url: endpoint.url, fetch: async (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), endpoint.url), init);
    const headers = new Headers(request.headers);
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
    return endpoint.fetch(request.url, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(), signal: request.signal, credentials: request.credentials, cache: request.cache, redirect: request.redirect });
  } };
}
/** App-specific recipe, deliberately outside both the API and reusable provider. */
export function createSampleRecipe() {
  let manifest: PreparedManifest;
  let distribution: Distribution;
  let boundRuntime: Runtime<{ apps: ReturnType<typeof preparedApps> }> | undefined;
  let delivered = false;
  return {
    async setup(signal?: AbortSignal) {
      const response = await fetch("/setup-check", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
      if (!response.ok) {
        if (response.headers.get("content-type")?.includes("application/json")) throw Error((await response.json()).message);
        throw Error("Dev server is outdated. Restart bun run demo in workspace-demo and open the printed URL");
      }
      manifest = await loadPrepared("/prepared/", signal);
      const responseRuntime = await fetch("/runtime/distribution.json", { signal });
      if (!responseRuntime.ok) throw Error("Runtime manifest missing. From workspace-demo run bun run demo");
      const runtimeManifest = await responseRuntime.json();
      distribution = { name: "vivari", version: runtimeManifest.version, assetBaseUrl: "/runtime/" };
      diagnostics.record("assets.versions", { runtimeVersion: distribution.version, openCodeVersion: manifest.openCodeVersion, files: manifest.assets.length });
      if (manifest.runtimeVersion !== distribution.version) throw Error("Prepared apps/runtime mismatch. Run bun run demo again to prepare matching assets");
    },
    async open(controller: WorkspaceController) { await this.setup(controller.signal); await controller.open(distribution); },
    async seed(controller: WorkspaceController) {
      if (!controller.workspace) throw Error("Open a workspace first");
      await seedMissing(controller.workspace, manifest.project, `http://host.vivari.internal:${location.port}/api/model/opencode`);
    },
    async runtime(controller: WorkspaceController) {
      if (controller.runtime) return;
      boundRuntime = await controller.startRuntime({ apps: preparedApps(manifest, controller.log, "/prepared/", controller.signal) }); delivered = false;
    },
    async deliver(controller: WorkspaceController) {
      if (controller.runtime !== boundRuntime || !boundRuntime) throw Error("Start the sample runtime first");
      if (!delivered) { await boundRuntime.tools.apps(); delivered = true; }
    },
    async vite(controller: WorkspaceController) {
      try {
        await controller.launch("vite", manifest.vite, 5173, async endpoint => {
          const response = await endpoint.fetch("/", { signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw Error(`Vite HTTP ${response.status}; inspect /index.html and Activity`);
          return connection(endpoint);
        });
        await controller.waitForClient("vite");
      } catch (error) { try { await controller.stopService("vite"); } catch (cleanupError) { diagnostics.record("service.cleanup.failed", { name: "vite", error: cleanupError }); } throw error; }
    },
    async chat(controller: WorkspaceController) {
      const launch = openCodeLaunch(manifest.opencode);
      try {
        await controller.launch("chat", launch.options, 4096, async endpoint => {
          controller.log(`Guest OpenCode health: ${await waitForOpenCode(endpoint, launch.headers, controller.signal)}`);
          return connection(endpoint, launch.headers);
        });
        await controller.waitForClient("chat");
      } catch (error) { try { await controller.stopService("chat"); } catch (cleanupError) { diagnostics.record("service.cleanup.failed", { name: "chat", error: cleanupError }); } throw error; }
    },
    async start(controller: WorkspaceController) {
      await controller.steps([
        ["Check prepared assets", () => this.setup(controller.signal)],
        ["Open or restore workspace (up to 2 minutes)", async () => { await controller.open(distribution); }],
        ["Add missing guest source and config", () => this.seed(controller)],
        ["Start browser runtime", () => this.runtime(controller)],
        ["Verify and deliver prepared apps", () => this.deliver(controller)],
        ["Launch guest Vite and render preview", () => this.vite(controller)],
        ["Launch guest OpenCode and connect chat", () => this.chat(controller)],
      ]);
      controller.status("Workspace ready. Edit and Save file, use the preview, or ask OpenCode to change the guest UI. Existing files and sessions were preserved.");
    },
  };
}
