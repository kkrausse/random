import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import lock from "../artifacts.lock.json";

const destination = resolve(import.meta.dirname, "../public/qemu");
const base = `https://raw.githubusercontent.com/ktock/qemu-wasm-demo-images/${lock.revision}/${lock.directory}`;

async function gitBlobSha(file: string, bytes: number) {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(`blob ${bytes}\0`);
  hasher.update(await Bun.file(file).arrayBuffer());
  return hasher.digest("hex");
}

await mkdir(destination, { recursive: true });

for (const [name, expected] of Object.entries(lock.files)) {
  const output = resolve(destination, name);
  const valid = await stat(output)
    .then(async ({ size }) => size === expected.bytes && (await gitBlobSha(output, size)) === expected.gitBlob)
    .catch(() => false);
  if (valid) {
    console.log(`✓ ${name}`);
    continue;
  }

  const temporary = `${output}.download`;
  await mkdir(dirname(temporary), { recursive: true });
  await rm(temporary, { force: true });
  console.log(`↓ ${name} (${(expected.bytes / 1024 / 1024).toFixed(1)} MB)`);
  const download = Bun.spawn([
    "curl", "--location", "--fail", "--retry", "3", "--connect-timeout", "15",
    "--silent", "--show-error", "--output", temporary, `${base}/${name}`,
  ], { stdout: "inherit", stderr: "inherit" });
  const exitCode = await download.exited;
  if (exitCode !== 0) throw new Error(`${name}: curl exited with status ${exitCode}`);

  const size = (await stat(temporary)).size;
  const blob = await gitBlobSha(temporary, size);
  if (size !== expected.bytes || blob !== expected.gitBlob) {
    await rm(temporary, { force: true });
    throw new Error(`${name}: artifact verification failed`);
  }
  await rename(temporary, output);
}

console.log(`QEMU artifacts ready in ${destination}`);
