// Native-only reduction: build against a copied pinned package, execute away from it.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = fileURLToPath(new URL('../../../.runtime/opencode-v2-source/', import.meta.url));
const pinned = resolve(source, 'packages/cli/node_modules/jsonc-parser');
const manifest = JSON.parse(readFileSync(resolve(pinned, 'package.json'), 'utf8'));
if (manifest.version !== '3.3.1') throw new Error(`Unexpected jsonc-parser ${manifest.version}`);
const temp = resolve(tmpdir(), 'opencode');
mkdirSync(temp, { recursive: true });
const root = mkdtempSync(resolve(temp, 'jsonc-repro-'));
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: resolve(root, 'home'), TMPDIR: root };
mkdirSync(env.HOME);
const build = resolve(root, 'build');
mkdirSync(resolve(build, 'node_modules'), { recursive: true });
cpSync(pinned, resolve(build, 'node_modules/jsonc-parser'), { recursive: true, dereference: true });
cpSync(fileURLToPath(new URL('./entry.ts', import.meta.url)), resolve(build, 'entry.ts'));
writeFileSync(resolve(build, 'package.json'), '{"type":"module"}\n');
const bun = process.execPath;
const node = process.env.NODE_BINARY || 'node';
function run(label: string, command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30000 });
  console.log(JSON.stringify({ checkpoint: label, command, args, cwd, status: result.status,
    signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }));
  if (result.error || result.signal) throw new Error(`${label} did not complete`);
  return result;
}
console.log(JSON.stringify({ checkpoint: 'JSONC_INPUT', root, package: manifest.version,
  lockSha256: createHash('sha256').update(readFileSync(resolve(source, 'bun.lock'))).digest('hex') }));
run('NODE_VERSION', node, ['--version'], root);
run('BUN_VERSION', bun, ['--version'], root);
for (const variant of ['bundled', 'external', 'unbundled']) {
  const guest = resolve(root, variant);
  mkdirSync(guest);
  writeFileSync(resolve(guest, 'package.json'), '{"type":"module"}\n');
  if (variant === 'unbundled') {
    // The invocation contains only JS syntax; preserve its bytes for native Node.
    cpSync(resolve(build, 'entry.ts'), resolve(guest, 'entry.js'));
  } else {
    const result = run(`BUILD_${variant}`, bun, ['build', './entry.ts', '--target=node',
      `--outdir=${guest}`, ...(variant === 'external' ? ['--packages=external'] : [])], build);
    if (result.status !== 0) throw new Error(`${variant} build failed`);
  }
  if (variant !== 'bundled') {
    mkdirSync(resolve(guest, 'node_modules'));
    cpSync(pinned, resolve(guest, 'node_modules/jsonc-parser'), { recursive: true, dereference: true });
  }
  for (const [name, command] of [['NODE', node], ['BUN', bun]]) {
    const result = run(`${variant}_${name}`, command, ['./entry.js'], guest);
    const pass = result.status === 0 && result.stdout.includes('JSONC_PARSE_EDIT_DONE');
    if (variant === 'bundled' ? pass || !result.stderr.includes('./impl/format') : !pass) {
      throw new Error(`Unexpected ${variant} ${name} result`);
    }
  }
}
console.log('JSONC_REPRO_DONE');
// Retain isolated artifacts and logs for inspection; the printed temp root is not source.
