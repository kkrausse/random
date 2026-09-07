const assert = require('assert');
const ffi = require('bun:ffi');
const bunModule = require('bun');
assert.equal(bunModule.hash('module-contract'), Bun.hash('module-contract'));
assert.equal(bunModule.fileURLToPath(bunModule.pathToFileURL('/ffi-probe/contract.cjs')), '/ffi-probe/contract.cjs');
const path = process.argv[2] || '/ffi-probe/ffi-library.ffi.json';
const definitions = {
  mutate: {args: ['ptr', 'u32'], returns: 'u32'},
  retain: {args: ['ptr'], returns: 'void'},
  retained_value: {args: [], returns: 'u32'},
  call_callback: {args: ['ptr', 'ptr'], returns: 'u32'},
  grow: {args: [], returns: 'u32'},
  wide: {args: ['u64'], returns: 'u64'},
  fractional: {args: ['f32'], returns: 'f32'},
  record_sum: {args: ['ptr'], returns: 'u32'},
  result_pointer: {args: [], returns: 'ptr'},
  allocation_epoch_pointer: {args: [], returns: 'ptr'},
};
assert.throws(() => ffi.dlopen('/lib/native.so', {}), /explicit/);
assert.throws(() => ffi.dlopen(path, {bad: {args: ['napi_value']}}), /unsupported type/);
assert.throws(() => ffi.dlopen(path, {missing: {}}), /missing export/);
assert.throws(() => ffi.dlopen(path, {wide: {args: ['u32'], returns: 'u32'}}), /type|signature|import/i);
const lib = ffi.dlopen(path, definitions), s = lib.symbols;
assert.throws(() => ffi.dlopen(path, definitions), /one open/);
const bytes = new Uint8Array([1,2,3,4]);
const p = ffi.ptr(bytes);
assert.equal(ffi.ptr(bytes.subarray(1)), p + 1);
assert.equal(s.mutate(bytes.subarray(1,3), 2), 7);
assert.deepEqual([...bytes], [1,3,4,4]);
s.retain(p);
bytes[0] = 11;
assert.equal(s.retained_value(), 11);
s.grow();
assert.equal(s.mutate(p, 1), 12);
assert.equal(bytes[0], 12);
assert.equal(ffi.read.u8(p), 12);
assert.equal(s.wide(0xfffffffffffffffen), 0xffffffffffffffffn);
assert.equal(s.fractional(1.25), 2.5);
const resultPtr = s.result_pointer();
const mirror = new Uint8Array(ffi.toArrayBuffer(resultPtr, 0, 4));
assert.deepEqual([...mirror], [5,6,7,8]);
mirror[0] = 20;
assert.equal(ffi.read.u8(resultPtr), 20);
s.grow();
assert.equal(s.mutate(resultPtr, 4), 45);
assert.deepEqual([...mirror], [21,7,8,9]);
assert.equal(ffi.ptr(mirror), resultPtr);
const record = new Uint32Array([p, bytes.length]);
assert.equal(s.record_sum(record), 23);
let calls = 0;
const cb = new ffi.JSCallback((address, increment) => {
  calls++;
  assert.equal(address, p);
  assert.equal(bytes[0], 40); // Native writes visible before callback entry.
  assert.equal(ffi.read.u8(address), 40);
  assert.throws(() => lib.close(), /during a call/);
  bytes[0] += increment;
  assert.equal(s.retained_value(), 42); // Reentrant call synchronizes mutations.
  return 7;
}, {args: ['ptr','u32'], returns: 'u32'});
assert.equal(s.call_callback(cb.ptr, p), 49);
assert.equal(calls, 1);
assert.equal(bytes[0], 42);
const stale = cb.ptr;
cb.close(); cb.close();
assert.equal(cb.ptr, null);
assert.throws(() => s.call_callback(stale, p), /null|signature|table|indirect/i);
assert.throws(() => new ffi.JSCallback(() => {}, {threadsafe: true}), /threadsafe/);
assert.equal(ffi.toArrayBuffer(p, 0, bytes.length), bytes.buffer);
assert.throws(() => ffi.toArrayBuffer(p, 0, 1), /overlapping external/);
assert.throws(() => ffi.read.u32(0xffffffff), /outside linear memory/);
// ffi_alloc is compiled native code too: it may modify native-owned memory
// between symbol calls. An unchanged mirror must not overwrite those writes.
const epochPtr = s.allocation_epoch_pointer();
const epoch = new Uint32Array(ffi.toArrayBuffer(epochPtr, 0, 4));
const beforeAllocation = epoch[0];
ffi.ptr(new Uint8Array(32));
assert.equal(ffi.read.u32(epochPtr), beforeAllocation + 1);
lib.close(); lib.close();
assert.throws(() => s.retained_value(), /closed/);
assert.throws(() => ffi.ptr(bytes), /no open/);
const nodeFfi = require('node:ffi');
const node = nodeFfi.dlopen(path, {
  mutate: {arguments: ['pointer','u32'], return: 'u32'},
  call_callback: {arguments: ['pointer','pointer'], return: 'u32'},
});
const nodeBytes = new Uint8Array([3,4]);
const np = nodeFfi.getRawPointer(nodeBytes.buffer);
assert.equal(typeof np, 'bigint');
assert.equal(node.functions.mutate(np, 2), 9);
const ncb = node.lib.registerCallback({arguments: ['pointer','u32'], return: 'u32'}, (address, n) => {
  assert.equal(address, np); nodeBytes[0] += n; return 1;
});
assert.equal(node.functions.call_callback(ncb, np), 43);
assert.equal(nodeFfi.toArrayBuffer(np, 2, false), nodeBytes.buffer);
assert.notEqual(nodeFfi.toArrayBuffer(np, 2, true), nodeBytes.buffer);
node.lib.unregisterCallback(ncb);
node.lib.close();
const discard = ffi.dlopen(path, {mutate: {args: [ffi.FFIType.ptr, ffi.FFIType.u32], returns: ffi.FFIType.void}});
const discardedBytes = new Uint8Array([8]);
assert.equal(discard.symbols.mutate(discardedBytes, 1), undefined);
assert.equal(discardedBytes[0], 9);
discard.close();
console.log('FFI_CONTRACT_PASS pointer alias/copy/retain/growth/nested wasm32/callback/reentry/close/signature rejection');
