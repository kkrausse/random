import { resolve } from "node:path"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { adaptWire, unavailableAudio } from './opentui-wire'
const root = resolve(import.meta.dir, "../.runtime/opentui-source")
const zig = resolve(root, "packages/core/src/zig")
const revision = '0c8c4f7cff2927e3df63a9757a45eff9a343611c'
const patch = resolve(import.meta.dir, '../patches/opentui/0001-wasm.patch')
function run(args: string[], cwd = root) {
  const p = Bun.spawnSync(args,{cwd,stdout:'pipe',stderr:'pipe'})
  if(p.exitCode) throw Error(p.stderr.toString())
  return p.stdout.toString()
}
if (!existsSync(root)) {
  run(['git','clone','https://github.com/anomalyco/opentui.git',root], resolve(import.meta.dir,'..'))
  run(['git','checkout','--detach',revision])
}
if(run(['git','rev-parse','HEAD']).trim() !== revision) throw Error('OpenTUI pin mismatch')
const diff = run(['git','diff','--binary','HEAD'])
const expected = await Bun.file(patch).text()
if(diff && diff !== expected) throw Error('Unrecognized OpenTUI source changes')
if(!diff) run(['git','apply',patch])
if(run(['zig','version']).trim() !== '0.15.2') throw Error('Requires Zig 0.15.2')
// Explicit source profile: audio symbols link, engine creation fails honestly.
let source = await Bun.file(resolve(zig, "lib.zig")).text()
const start = source.indexOf("export fn createAudioEngine(")
const end = source.indexOf("export fn getArenaAllocatedBytes()", start)
if (start < 0 || end < start) throw new Error("OpenTUI audio source boundary drift")
source = source.slice(0, start) + unavailableAudio(source.slice(start, end)) + source.slice(end)
source = source.replace('const native_audio = @import("audio.zig");', '').replace('    _ = native_audio;', '')
source = source.replace(/fn acquireAudioEngine\(handle: NativeHandle\) \?\*native_audio.Engine \{[^}]+\}/, '')
source = adaptWire(source, await Bun.file(resolve(zig, 'text-buffer.zig')).text())
source += `
// WASM offsets refer only to this instance's linear memory. Caller owns each allocation.
export fn wasmAlloc(len: u32) ?[*]u8 {
    const bytes = globalAllocator.alloc(u8, len) catch return null;
    return bytes.ptr;
}
export fn wasmFree(ptr: [*]u8, len: u32) void {
    globalAllocator.free(ptr[0..len]);
}
// General Vivari FFI allocator contract, independent of renderer symbols.
export fn ffi_alloc(len: u32) ?[*]u8 { return wasmAlloc(len); }
export fn ffi_free(ptr: [*]u8, len: u32) void { wasmFree(ptr, len); }
`
await Bun.write(resolve(zig, "wasm-lib.zig"), source)
const proc = Bun.spawn(["zig", "build", "-Dtarget=wasm32-wasi", "-Doptimize=ReleaseSmall"], { cwd: zig, stdout: "inherit", stderr: "inherit" })
const code = await proc.exited
if(code) process.exit(code)
await Bun.write(resolve(root, '../opentui.ffi.json'), JSON.stringify({abi: 'vivari-wasm32-flat-v1', wasm: 'opentui.wasm', tableInitial: 4096}) + '\n')
const bytes = await Bun.file(resolve(zig,'zig-out/bin/opentui.wasm')).arrayBuffer()
const module = new WebAssembly.Module(bytes)
const hash = (v: string | ArrayBuffer) => createHash('sha256').update(typeof v === 'string' ? v : new Uint8Array(v)).digest('hex')
await Bun.write(resolve(root,'../opentui-wasm-build.json'),JSON.stringify({revision,zig:'0.15.2',patchSha256:hash(expected),adapterSha256:hash(source),wasmSha256:hash(bytes),bytes:bytes.byteLength,imports:WebAssembly.Module.imports(module),exports:WebAssembly.Module.exports(module)},null,2)+'\n')
run(['zig','cc','-target','wasm32-wasi','-mexec-model=reactor','-O2','-Wl,--export=probe',resolve(import.meta.dir,'../probes/runtime/wasi-positional.c'),'-o',resolve(root,'../wasi-positional.wasm')])
