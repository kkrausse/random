import { adaptTextRead, originalTextRead, adaptLayoutRead, originalLayoutRead } from './opentui-text-scratch';
// Exercise the exact packaging transform, then run both adapters against the
// real renderer in a guest worker (ffi-headless.mjs --text-scratch).
await Bun.write(new URL('../.runtime/text-scratch-adapters.cjs',import.meta.url),
  `const ffi=require('bun:ffi');const ptr=ffi.ptr;const ptrOrNull=b=>b.byteLength?ffi.ptr(b):null;
exports.original={${originalTextRead},${originalLayoutRead}};exports.adapted={${adaptTextRead(originalTextRead)},${adaptLayoutRead(originalLayoutRead)}};`);
