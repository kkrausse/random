import type { ToolDescriptor, NodeLaunchOptions, Endpoint } from "@kev-browser-agent-kit/workspace";

export function openCodeLaunch(options: NodeLaunchOptions) {
  const password = crypto.randomUUID() + crypto.randomUUID();
  return { options: { ...options, env: { ...options.env, OPENCODE_SERVER_PASSWORD: password } },
    headers: { authorization: "Basic " + btoa("opencode:" + password) } };
}

export async function waitForOpenCode(endpoint: Endpoint, headers: HeadersInit, signal?: AbortSignal) {
  const deadline = Date.now() + 30000;
  let failure: unknown;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await endpoint.fetch("/api/health", { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
      const body = await response.text();
      if (response.ok) return body;
       failure = Error(`OpenCode health HTTP ${response.status}`);
    } catch (error) { failure = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw failure;
}

export interface PreparedManifest {
  format: "workspace-apps-v1";
  runtimeVersion: string;
  openCodeVersion: string;
  assets: { file: string; destination: string; bytes: number; sha256: string }[];
  vite: NodeLaunchOptions;
  opencode: NodeLaunchOptions;
  project: Record<string, string>;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function loadPrepared(base = "/prepared/", signal?: AbortSignal): Promise<PreparedManifest> {
  const response = await fetch(base + "manifest.json", { signal });
  if (!response.ok) throw Error(`Prepared apps unavailable (HTTP ${response.status}). From browser-container-poc run: bun run --cwd editable-app-demo prepare, then retry Start workspace`);
  const manifest = await response.json() as PreparedManifest;
  if (manifest.format !== "workspace-apps-v1" || manifest.openCodeVersion !== "0.0.0-dev-19167") throw Error("Unsupported prepared application manifest");
  const destinations = new Set<string>();
  for (const asset of manifest.assets) {
    if (!/^[a-f0-9]{64}\.bin$/.test(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0
      || !["/workspace/node_modules/", "/opencode-v2/"].some(prefix => asset.destination.startsWith(prefix))
      || asset.destination.split("/").some(part => part === "." || part === ".." || part.includes("\\"))
      || destinations.has(asset.destination)) throw Error(`Invalid prepared asset: ${asset.destination}`);
    destinations.add(asset.destination);
  }
  return manifest;
}

/** Application-owned explicit delivery, using the public installer seam. No programs start here. */
export function preparedApps(manifest: PreparedManifest, report: (message: string) => void = () => {}, base = "/prepared/", signal?: AbortSignal): ToolDescriptor<void, void> {
  return {
    name: "prepared-apps", version: manifest.runtimeVersion,
    async bind(context) {
      return async () => {
        let done = 0;
        for (const asset of manifest.assets) {
          signal?.throwIfAborted();
          const response = await fetch(base + asset.file, { signal });
          if (!response.ok) throw Error(`Prepared asset HTTP ${response.status}: ${asset.file}. From browser-container-poc run: bun run --cwd editable-app-demo prepare, then retry Start workspace`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw Error(`Asset hash mismatch: ${asset.destination}`);
          await context.installFile(asset.destination, bytes);
          if (++done % 100 === 0) report(`Prepared ${done}/${manifest.assets.length} files`);
        }
        report(`Prepared ${done} verified files; no application launched`);
      };
    },
  };
}
