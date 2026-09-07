import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// --import is inherited by Worker threads, so both kernel and process callers
// actually run the overlay (registerHooks in just the parent would not suffice).
const run = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('./runtime-hook.mjs', import.meta.url)),
  fileURLToPath(new URL('../../vivari/.runtime/baseline/scripts/verify-node.mjs', import.meta.url))], { stdio: 'inherit' });
process.exit(run.status ?? 1);
