// Independently recheck captured browser evidence; never executes native host code.
import assert from 'node:assert/strict';
const e = await Bun.file(new URL('./evidence.json', import.meta.url)).json();
assert.equal(e.phase,'complete'); assert.equal(e.code,0); assert.equal(e.results.length,26);
const ok=e.results.filter((r: any)=>r.status===200), bad=e.results.filter((r: any)=>r.status===400);
assert.equal(ok.length,20); assert.equal(bad.length,6);
for (const r of ok) {
  assert.equal(r.body.index,r.input.bytes.indexOf(r.input.needle));
  assert.equal(r.body.absolute,Math.abs(r.input.signed));
  assert.equal(r.body.elfClass,64); assert.equal(r.body.elfMachine,62);
  assert.equal(r.body.platform,'linux'); assert.equal(r.body.arch,'x64');
  assert.equal(r.body.librarySha256,'2fb72c67f292827c8c4095067197af7880c234a3a4060136e1b5518d10de1eb9');
  assert.ok(r.workerRoundTripMs>0 && r.bridgeRoundTripMs>0 && r.body.nativeMs>=0);
}
assert.deepEqual(bad.map((r: any)=>r.body.error),[
  'Error: Unsupported field: pointers/callbacks forbidden',
  'Error: Unsupported field: pointers/callbacks forbidden',
  'Error: Invalid bytes','Error: Invalid signed i32 (INT_MIN excluded)',
  'Error: Invalid needle','Error: Unsupported operation',
]);
for (const key of ['workerRoundTripMs','bridgeRoundTripMs']) {
  const values=ok.slice(5).map((r: any)=>r[key]).sort((a: number,b: number)=>a-b);
  console.log(key,{n:values.length,median:values[7],p95:values[14],min:values[0]});
}
console.log('26 cross-environment cases verified');
