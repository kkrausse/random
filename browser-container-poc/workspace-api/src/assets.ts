/** Server/build-time only: consume an explicitly delivered runtime directory. */
import { cp, mkdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";

export interface RuntimeAssetManifest {
  abi: "workspace-v1";
  name: "vivari";
  version: string;
  kernelWorker: string;
  serviceWorker: string;
  kernelSha256: string;
  upstream?: string;
}

function assetPath(root: string, path: string): string {
  if (typeof path !== "string" || !/^assets\/[\w./-]+$/.test(path) || path.split("/").includes("..")) throw Error("Invalid runtime manifest asset path");
  return resolve(root, path);
}

/** Verify the delivered ABI, pinned version, boot worker and SW before copying. */
export async function readRuntimeAssets(source: string, expectedVersion?: string): Promise<RuntimeAssetManifest> {
  const manifest = JSON.parse(await readFile(resolve(source, "distribution.json"), "utf8")) as RuntimeAssetManifest;
  if (manifest.abi !== "workspace-v1" || manifest.name !== "vivari" || !/^[a-f0-9]{64}$/.test(manifest.version)) throw Error("Invalid runtime distribution manifest");
  if (expectedVersion && manifest.version !== expectedVersion) throw Error(`Runtime version mismatch: expected ${expectedVersion}, received ${manifest.version}`);
  const worker = await readFile(assetPath(source, manifest.kernelWorker));
  await readFile(assetPath(source, manifest.serviceWorker));
  if (createHash("sha256").update(worker).digest("hex") !== manifest.kernelSha256) throw Error("Runtime kernel hash mismatch");
  return manifest;
}

/** Destination must be new. Version is durable patch identity, not npm version. */
export async function copyRuntimeAssets(options: { source: string; destination: string; expectedVersion?: string }): Promise<RuntimeAssetManifest> {
  const source = resolve(options.source), destination = resolve(options.destination);
  const rel = relative(source, destination);
  if (!rel || (!rel.startsWith("..") && !rel.startsWith("/"))) throw Error("Runtime destination must be outside the source directory");
  const manifest = await readRuntimeAssets(source, options.expectedVersion);
  await mkdir(destination, { recursive: false });
  await cp(resolve(source, "assets"), resolve(destination, "assets"), { recursive: true, dereference: true });
  await cp(resolve(source, "distribution.json"), resolve(destination, "distribution.json"));
  return manifest;
}
