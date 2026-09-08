import { readdir, realpath, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { PreparedManifest } from "./src/prepared";
import { sampleApp } from "./src/sample";
import { preparationFingerprint, preparedRoot } from "./setup";

const root = import.meta.dirname;
const out = preparedRoot;
const runtime = resolve(process.env.RUNTIME_DIR ?? resolve(root, "../workspace-api/dist/runtime"));
const source = resolve(process.env.OPENCODE_PACKAGE_DIR ?? resolve(root, "../vivari/.runtime/opencode-v2-package"));
const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const receipt = await Bun.file(join(source, "receipt.json")).json();
// The reviewed POC receipt pins the matched V2 core/schema bundle, not a moving beta.
if (receipt.revision !== "d7a7256bb6b0952f486c95718cfbf460b1570a56") throw Error("Prepare the matched OpenCode V2 POC package first");
const distribution = await Bun.file(join(runtime, "distribution.json")).json();
const projectPackage = await Bun.file(join(root, "guest/package.json")).json();
delete projectPackage.overrides; // Host preparation selects WASM; user project metadata remains ordinary.
const assets: PreparedManifest["assets"] = [];
async function add(destination: string, bytes: Uint8Array) {
  const sha256 = hash(bytes), file = sha256 + ".bin";
  await Bun.write(join(out, file), bytes);
  assets.push({ file, destination, bytes: bytes.length, sha256 });
}
async function walk(directory: string, destination: string) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".bin" || entry.name === ".cache") continue;
    const path = join(directory, entry.name);
    const actual = entry.isSymbolicLink() ? await realpath(path) : path;
    const info = await stat(actual);
    if (info.isDirectory()) await walk(actual, destination + "/" + entry.name);
    else if (info.isFile()) await add(destination + "/" + entry.name, new Uint8Array(await Bun.file(actual).arrayBuffer()));
  }
}
await walk(join(root, "guest/node_modules"), "/workspace/node_modules");
for (const asset of receipt.assets) {
  const bytes = new Uint8Array(await Bun.file(join(source, asset.file)).arrayBuffer());
  if (hash(bytes) !== asset.sha256 || bytes.length !== asset.bytes) throw Error(`OpenCode receipt mismatch: ${asset.file}`);
  await add(asset.destination, bytes);
}
// The reviewed CLI expects Bun identity. Runtime.node launches this ordinary guest wrapper.
const wrapper = `const child=require('child_process').spawn('bun',['/opencode-v2/cli/entry.cjs',...process.argv.slice(2)],{stdio:['pipe','inherit','inherit'],env:process.env});process.stdin.on('data',chunk=>child.stdin.write(chunk));process.stdin.once('end',()=>child.stdin.end());process.on('SIGINT',()=>child.kill('SIGINT'));child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.stdin.pause();process.exitCode=code??1});`;
await add("/opencode-v2/run.cjs", new TextEncoder().encode(wrapper));
const manifest: PreparedManifest = {
  format: "workspace-apps-v1", runtimeVersion: distribution.version, openCodeVersion: "0.0.0-dev-19167", assets,
  vite: { entry: "/workspace/node_modules/vite/bin/vite.js", args: ["--configLoader", "native", "--host", "0.0.0.0", "--port", "5173", "--strictPort"], cwd: "/workspace", env: {} },
  opencode: { entry: "/opencode-v2/run.cjs", args: ["serve", "--port", "4096"], cwd: "/workspace", env: {
    XDG_DATA_HOME: "/workspace/.opencode-state/data", XDG_CONFIG_HOME: "/workspace/.opencode-state/config", XDG_CACHE_HOME: "/workspace/.opencode-state/cache", XDG_STATE_HOME: "/workspace/.opencode-state/state",
    OPENCODE_MODELS_PATH: "/opencode-v2/models.json", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_FFF: "1", OPENCODE_DISABLE_FILEWATCHER: "1", OTUI_TREE_SITTER_WORKER_PATH: "/opencode-v2/parser/entry.cjs",
  } },
  project: {
    "/opencode.json": JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "opencode/muse-spark-1.3-contributor-free", snapshots: false, providers: { opencode: { settings: { baseURL: "__MODEL_PROXY__" } } }, permissions: [{ action: "read", resource: "*", effect: "allow" }, { action: "edit", resource: "*", effect: "allow" }] }, null, 2),
    "/package.json": JSON.stringify(projectPackage, null, 2),
    "/index.html": '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    "/src/main.tsx": 'import React from "react"; import {createRoot} from "react-dom/client"; import App from "./App"; const root=createRoot(document.getElementById("root")!); root.render(<App/>); if(import.meta.hot) import.meta.hot.accept("./App", module=>{if(module) root.render(React.createElement(module.default))});',
    "/src/App.tsx": sampleApp,
    "/vite.config.mjs": 'import react from "@vitejs/plugin-react"; export default {plugins:[react()],optimizeDeps:{include:["react","react-dom/client","react/jsx-dev-runtime","react/jsx-runtime"],noDiscovery:true},server:{host:"0.0.0.0",port:5173,strictPort:true}};',
  },
};
await Bun.write(join(out, "manifest.json"), JSON.stringify(manifest));
await Bun.write(join(out, "source-receipt.json"), JSON.stringify({ preparationFingerprint: await preparationFingerprint(), openCode: receipt, guestLockSha256: hash(new Uint8Array(await Bun.file(join(root, "guest/bun.lock")).arrayBuffer())) }, null, 2));
console.log(`Prepared ${assets.length} files (${assets.reduce((n,a)=>n+a.bytes,0)} bytes), runtime ${distribution.version}`);
