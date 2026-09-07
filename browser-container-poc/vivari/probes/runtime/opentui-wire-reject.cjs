const assert = require('node:assert/strict');
const ffi = require('node:ffi');
const mode = process.argv[2];
const {lib, functions: s} = ffi.dlopen('/ffi-probe/opentui.ffi.json', {
  textBufferSetStyledText: {arguments:['u32','pointer','u32'], return:'void'},
  audioStartMixer: {arguments:['u32'], return:'i32'},
});
try {
  if (mode === 'audio') {
    assert.throws(() => s.audioStartMixer(0), /unreachable|RuntimeError/);
  } else {
    const record = new ArrayBuffer(40), view = new DataView(record);
    view.setUint32(0, 16, true);
    view.setBigUint64(8, mode === 'wide' ? 0x100000000n : 0xffffffffn, true);
    assert.throws(() => s.textBufferSetStyledText(0, record, 1), /unreachable|RuntimeError/);
  }
  console.log('WIRE_REJECTION_PASS ' + mode);
} finally { lib.close(); }
