// Executed ONLY in QEMU Linux. No native addresses cross the protocol.
import { dlopen, ptr } from 'bun:ffi';
import { readFileSync, writeFileSync } from 'node:fs';
if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Linux x64 required');
const path = '/lib/ld-musl-x86_64.so.1';
const elf = readFileSync(path);
// Independent binary ABI check: ELF64, little endian, EM_X86_64.
if (elf.readUInt32LE(0) !== 0x464c457f || elf[4] !== 2 || elf[5] !== 1 || elf.readUInt16LE(18) !== 62) throw Error('Unexpected ELF ABI');
const librarySha256 = new Bun.CryptoHasher('sha256').update(elf).digest('hex');
const lib = dlopen(path, {
  memchr: { args: ['ptr', 'i32', 'u64'], returns: 'ptr' },
  abs: { args: ['i32'], returns: 'i32' },
});
Bun.serve({ hostname: '127.0.0.1', port: 5173, fetch(req) {
  try {
    const input = JSON.parse(new URL(req.url).searchParams.get('q') || '{}');
    if (Object.keys(input).some(k => !['op', 'bytes', 'needle', 'signed'].includes(k))) throw Error('Unsupported field: pointers/callbacks forbidden');
    if (input.op !== 'scan-v1') throw Error('Unsupported operation');
    if (!Array.isArray(input.bytes) || input.bytes.length > 4096 || !input.bytes.every((v: any) => Number.isInteger(v) && v >= 0 && v <= 255)) throw Error('Invalid bytes');
    if (!Number.isInteger(input.needle) || input.needle < 0 || input.needle > 255) throw Error('Invalid needle');
    if (!Number.isInteger(input.signed) || input.signed < -2147483647 || input.signed > 2147483647) throw Error('Invalid signed i32 (INT_MIN excluded)');
    const bytes = Uint8Array.from(input.bytes.length ? input.bytes : [0]);
    const owner = bytes.buffer;
    const address = ptr(bytes);
    const start = performance.now();
    const found = lib.symbols.memchr(address, input.needle, BigInt(input.bytes.length));
    const absolute = lib.symbols.abs(input.signed);
    const nativeMs = performance.now() - start;
    const index = found ? Number(found) - Number(address) : -1;
    if (index < -1 || index >= input.bytes.length || owner.byteLength < input.bytes.length) throw Error('Invalid native result');
    return Response.json({ index, absolute, nativeMs, platform: process.platform, arch: process.arch, library: path, librarySha256, elfClass:64, elfMachine:62 });
  } catch (e) { return Response.json({ error: String(e) }, { status: 400 }); }
} });
writeFileSync('/tmp/hybrid-ffi-ready', 'ready');
