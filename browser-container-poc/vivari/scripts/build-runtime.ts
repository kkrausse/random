// Build immutable upstream source plus reviewed patches; never edit packaged workers.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const revision = "2629c71097238400c45aefa213ef61df4794c2b7";
const root = resolve(import.meta.dir, "..");
const mode = process.argv[2] ?? "baseline";
if (!["baseline", "patched"].includes(mode)) throw new Error("Expected baseline or patched");
const source = join(root, ".runtime", mode);
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.0" };
function run(args: string[], cwd = source) {
  console.log("$", args.join(" "));
  const result = Bun.spawnSync(args, { cwd, env, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Failed (${result.exitCode}): ${args.join(" ")}`);
}
mkdirSync(join(root, ".runtime"), { recursive: true });
if (!existsSync(source)) {
  run(["git", "clone", "https://github.com/maitrungduc1410/vivari.git", source], root);
  run(["git", "checkout", "--detach", revision]);
}
const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: source }).stdout.toString().trim();
if (head !== revision) throw new Error(`Unexpected revision: ${head}`);
const changes = Bun.spawnSync(["git", "diff", "--name-only", "HEAD"], { cwd: source }).stdout.toString().trim();
const patches = existsSync(join(root, "patches")) && mode === "patched"
  ? readdirSync(join(root, "patches")).filter(p => p.endsWith(".patch")).sort() : [];
const diff = Bun.spawnSync(["git", "diff", "--binary", "HEAD"], { cwd: source }).stdout.toString();
const applied = patches.length === 1 && diff === readFileSync(join(root, "patches", patches[0]), "utf8");
if (changes && !applied) throw new Error(`Source has unrecognized changes; use a fresh checkout rather than overwrite them:\n${changes}`);
if (!applied) for (const patch of patches) {
  run(["git", "apply", "--check", join(root, "patches", patch)]);
  run(["git", "apply", "--intent-to-add", join(root, "patches", patch)]);
}
run(["rustc", "--version"]);
run(["bun", "install", "--frozen-lockfile"]);
for (const crate of ["vfs", "codec", "crypto"]) {
  for (const target of ["web", "nodejs"]) {
    run(["bunx", "--package", "wasm-pack@0.13.1", "wasm-pack", "build", `packages/${crate}`,
      "--target", target, "--out-dir", target === "web" ? "pkg" : "pkg-node", "--locked"]);
  }
}
run(["cargo", "build", "--locked", "--release", "--manifest-path", "packages/wasi-demo/Cargo.toml", "--target", "wasm32-wasip1"]);
mkdirSync(join(source, "packages/wasi-demo/pkg"), { recursive: true });
copyFileSync(join(source, "packages/wasi-demo/target/wasm32-wasip1/release/wasi_demo.wasm"), join(source, "packages/wasi-demo/pkg/wasi_demo.wasm"));
const dist = join(source, "packages/core/dist");
// Live kernels retain hashed worker URLs across host rebuilds. Archive immutable
// assets before Vite empties dist, then restore missing hashes for those kernels.
const retained = join(root, '.runtime', `${mode}-retained-assets`);
mkdirSync(retained, { recursive: true });
if (existsSync(join(dist, 'assets'))) cpSync(join(dist, 'assets'), retained, { recursive: true });
run(["bun", "run", "--cwd", "packages/core", "build"]);
for (const name of readdirSync(retained)) {
  if (!existsSync(join(dist, 'assets', name))) copyFileSync(join(retained, name), join(dist, 'assets', name));
}
copyFileSync(join(source, "LICENSE"), join(dist, "assets/LICENSE.vivari.txt"));
if (mode === "patched") copyFileSync(join(root, "LICENSE.sqlite-wasm"), join(dist, "assets/LICENSE.sqlite-wasm.txt"));
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
writeFileSync(join(root, ".runtime", `${mode}-build.json`), JSON.stringify({
  revision, license: "MIT", mode, bun: Bun.version, rust: "1.93.0", wasmPack: "0.13.1",
  sqlite: mode === "patched" ? { package: "@sqlite.org/sqlite-wasm", version: "3.49.1-build1", engine: "3.49.1", license: "Apache-2.0 (package); public domain (SQLite)" } : null,
  npmLockSha256: hash(join(source, "package-lock.json")),
  patches: patches.map(name => ({ name, sha256: hash(join(root, "patches", name)) })),
  assets: ["index.js", ...readdirSync(join(dist, "assets")).map(n => `assets/${n}`)]
    .map(name => ({ name, sha256: hash(join(dist, name)) })),
}, null, 2) + "\n");
console.log(`Built ${dist}`);
