// Explicit distribution delivery. Builds source via the established vivari patch
// workflow first; this script packages that output without editing emitted code.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, "../..");
const source = resolve(root, "vivari/.runtime/patched/packages/core/dist");
const destination = resolve(process.argv[2] ?? resolve(root, "workspace-api/dist/runtime"));
const index = await readFile(resolve(source, "index.js"), "utf8");
const kernelWorker = index.match(/assets\/kernel-worker-[\w-]+\.js/)?.[0];
if (!kernelWorker) throw new Error("Cannot locate active kernel worker in built SDK");
const kernelBytes = await readFile(resolve(source, kernelWorker));
if (!kernelBytes.includes(Buffer.from("workspace-flush"))) throw new Error("Runtime output lacks workspace-v1; rebuild patched source first");
const patch = await readFile(resolve(root, "vivari/patches/0001-sqlite.patch"));
const version = createHash("sha256").update(patch).digest("hex");
await mkdir(destination, { recursive: true });
await cp(resolve(source, "assets"), resolve(destination, "assets"), { recursive: true });
await writeFile(resolve(destination, "distribution.json"), JSON.stringify({
  abi: "workspace-v1", name: "vivari", version, kernelWorker, serviceWorker: "assets/sw.js",
  upstream: "2629c71097238400c45aefa213ef61df4794c2b7",
  kernelSha256: createHash("sha256").update(kernelBytes).digest("hex"),
}, null, 2) + "\n");
console.log(JSON.stringify({ destination, version, kernelWorker }));
