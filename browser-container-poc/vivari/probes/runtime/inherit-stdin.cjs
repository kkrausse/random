const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const listeners = {data:process.stdin.listenerCount('data'),end:process.stdin.listenerCount('end')};
const child = spawn('node', ['-e', `process.stdin.once('data',chunk=>{require('assert').equal(chunk.toString(),'hello €\\r');console.log('INHERIT_CHILD '+chunk.toString().trim());process.stdin.pause()});console.log('INHERIT_READY');`], {stdio:'inherit'});
child.on('exit', code=>{
  assert.equal(code,0);
  assert.equal(process.stdin.listenerCount('data'),listeners.data);
  assert.equal(process.stdin.listenerCount('end'),listeners.end);
  console.log('INHERIT_STDIN_PASS bytes/cleanup/exit');
});
