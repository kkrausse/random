const assert=require('assert');
const ffi=require('bun:ffi');
const lib=ffi.dlopen('/ffi-probe/opentui.ffi.json',{
  createEditBuffer:{args:['u8','ptr'],returns:'ptr'},
  destroyEditBuffer:{args:['ptr'],returns:'void'},
  editBufferSetText:{args:['ptr','ptr','u32'],returns:'void'},
  editBufferGetText:{args:['ptr','ptr','u32'],returns:'u32'},
  editBufferGetTextBuffer:{args:['ptr'],returns:'ptr'},
  textBufferGetByteSize:{args:['ptr'],returns:'u32'},
  yogaNodeCreate:{args:[],returns:'ptr'},
  yogaNodeFree:{args:['ptr'],returns:'void'},
  yogaNodeCalculateLayout:{args:['ptr','f32','f32','u32'],returns:'void'},
  yogaNodeGetComputedLayout:{args:['ptr','ptr'],returns:'void'},
});
const {original,adapted}=require('./text-scratch-adapters.cjs');
original.opentui=adapted.opentui=lib;
const a=lib.symbols.createEditBuffer(0,0),b=lib.symbols.createEditBuffer(0,0);
const node=lib.symbols.yogaNodeCreate();
try{
  for(const text of ['','abc','é中🙂\nnext','x'.repeat(5000)]){
    const bytes=new TextEncoder().encode(text);
    lib.symbols.editBufferSetText(a,bytes.length?ffi.ptr(bytes):null,bytes.length);
    for(const cap of [0,1,4,8,32,8192])assert.deepEqual(adapted.editBufferGetText(a,cap),original.editBufferGetText(a,cap));
  }
  const saved=adapted.editBufferGetText(a,1<<20),copy=saved.slice();
  assert(adapted.vivariTextScratch.byteLength < 16384); // Requested cap is not allocated for short text.
  const bytes=new TextEncoder().encode('different buffer');
  lib.symbols.editBufferSetText(b,ffi.ptr(bytes),bytes.length);
  const before=ffi.vivariStats();
  for(let i=0;i<128;i++)assert.equal(new TextDecoder().decode(adapted.editBufferGetText(b,1<<20)),'different buffer');
  assert.deepEqual(saved,copy); // Caller-owned result survives subsequent reads.
  assert.equal(ffi.vivariStats().pinnedBytes,before.pinnedBytes);
  assert.equal(ffi.vivariStats().pins,before.pins);
  lib.symbols.yogaNodeCalculateLayout(node,120,40,1);
  assert.deepEqual(adapted.yogaNodeGetComputedLayout(node),original.yogaNodeGetComputedLayout(node));
  const layout=adapted.yogaNodeGetComputedLayout(node);
  assert.equal(layout.width,120);assert.equal(layout.height,40);
  lib.symbols.yogaNodeCalculateLayout(node,80,20,1);
  const layoutBefore=ffi.vivariStats();
  for(let i=0;i<128;i++){
    const next=adapted.yogaNodeGetComputedLayout(node);
    assert.equal(next.width,80);assert.equal(next.height,20);
  }
  assert.equal(layout.width,120);assert.equal(layout.height,40);
  assert.equal(ffi.vivariStats().pinnedBytes,layoutBefore.pinnedBytes);
  assert.equal(ffi.vivariStats().pins,layoutBefore.pins);
  console.log('TEXT_SCRATCH_PASS '+JSON.stringify({reads:128,pins:before.pins,pinnedBytes:before.pinnedBytes}));
}finally{lib.symbols.yogaNodeFree(node);lib.symbols.destroyEditBuffer(a);lib.symbols.destroyEditBuffer(b);lib.close()}
