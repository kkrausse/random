import { adaptTextRead, originalTextRead } from './opentui-text-scratch';
// Exercise the exact packaging transform, then run both adapters against the
// real renderer in a guest worker (ffi-headless.mjs --text-scratch).
await Bun.write(new URL('../.runtime/text-scratch-adapters.cjs',import.meta.url),
  `const ffi=require('bun:ffi');const ptrOrNull=b=>b.byteLength?ffi.ptr(b):null;
exports.original={${originalTextRead}};exports.adapted={${adaptTextRead(originalTextRead)}};`);
