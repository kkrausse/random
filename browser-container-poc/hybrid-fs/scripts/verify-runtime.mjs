import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const run=spawnSync(process.execPath,['--import',fileURLToPath(new URL('./runtime-hook.mjs',import.meta.url)),fileURLToPath(new URL('../../vivari/.runtime/baseline/scripts/verify-node.mjs',import.meta.url))],{stdio:'inherit'});
process.exit(run.status??1);
