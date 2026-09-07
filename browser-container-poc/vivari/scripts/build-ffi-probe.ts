import { resolve } from 'node:path'
const root = resolve(import.meta.dir, '..')
const exports = ['ffi_alloc', 'ffi_free', 'mutate', 'retain', 'retained_value', 'call_callback', 'grow', 'wide', 'fractional', 'record_sum', 'result_pointer', 'allocation_epoch_pointer']
const version = Bun.spawnSync(['zig', 'version']).stdout.toString().trim()
if (version !== '0.15.2') throw Error('Requires Zig 0.15.2')
const proc = Bun.spawnSync(['zig', 'cc', '-target', 'wasm32-wasi', '-mexec-model=reactor', '-O2', '-Wl,--import-table', ...exports.map(x => `-Wl,--export=${x}`), resolve(root, 'probes/runtime/ffi-library.c'), '-o', resolve(root, '.runtime/ffi-library.wasm')], { stdout: 'inherit', stderr: 'inherit' })
if (proc.exitCode) process.exit(proc.exitCode)
await Bun.write(resolve(root, '.runtime/ffi-library.ffi.json'), JSON.stringify({abi: 'vivari-wasm32-flat-v1', wasm: 'ffi-library.wasm', tableInitial: 128}) + '\n')
