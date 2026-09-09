import { resolve } from "node:path";
import type { PreparedManifest } from "./src/prepared";

export const root = import.meta.dirname;
export const runtimeRoot = resolve(process.env.RUNTIME_DIR ?? `${root}/../workspace-api/dist/runtime`);
export const preparedRoot = resolve(process.env.PREPARED_DIR ?? `${root}/dist/prepared`);
export const sourceRoot = resolve(process.env.OPENCODE_PACKAGE_DIR ?? `${root}/../vivari/.runtime/opencode-v2-package`);
const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export async function preparationFingerprint() {
  const files = [`${root}/prepare.ts`, `${root}/src/SampleApp.tsx`, `${root}/guest/package.json`, `${root}/guest/bun.lock`, `${runtimeRoot}/distribution.json`, `${sourceRoot}/receipt.json`];
  return hash(new TextEncoder().encode((await Promise.all(files.map(async file => hash(new Uint8Array(await Bun.file(file).arrayBuffer()))))).join("\n")));
}
/** Startup verifies hashes; HTTP preflight checks presence before opening storage. */
export async function checkAssets(verify = false) {
  const fix = "From browser-container-poc/editable-app-demo run: bun run demo. It prepares missing/stale apps. See README prerequisites if the pinned runtime or OpenCode source is unavailable.";
  try {
    const runtime = await Bun.file(`${runtimeRoot}/distribution.json`).json();
    const prepared = await Bun.file(`${preparedRoot}/manifest.json`).json() as PreparedManifest;
    if (runtime.abi !== "workspace-v1" || prepared.format !== "workspace-apps-v1" || prepared.runtimeVersion !== runtime.version) throw Error("Prepared apps and runtime ABI/version differ");
    const files = [resolve(runtimeRoot, runtime.kernelWorker), resolve(runtimeRoot, runtime.serviceWorker), ...prepared.assets.map(asset => resolve(preparedRoot, asset.file))];
    const exists = await Promise.all(files.map(file => Bun.file(file).exists()));
    const missing = files.find((_, index) => !exists[index]);
    if (missing) throw Error(`Missing asset: ${missing}`);
    const receipt = await Bun.file(`${preparedRoot}/source-receipt.json`).json();
    if (receipt.preparationFingerprint !== await preparationFingerprint()) throw Error("Prepared recipe/source inputs changed");
    if (verify) {
      if (hash(new Uint8Array(await Bun.file(files[0]!).arrayBuffer())) !== runtime.kernelSha256) throw Error("Runtime kernel hash mismatch; rebuild the workspace-api distribution");
      for (const asset of prepared.assets) {
        const bytes = new Uint8Array(await Bun.file(resolve(preparedRoot, asset.file)).arrayBuffer());
        if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw Error(`Prepared asset hash mismatch: ${asset.file}`);
      }
    }
    return { ok: true, message: "Runtime and prepared app files available" };
  } catch (error) { return { ok: false, message: `${error instanceof Error ? error.message : String(error)}. ${fix} Runtime directory: ${runtimeRoot}; prepared directory: ${preparedRoot}` }; }
}
