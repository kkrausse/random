// Real Vivari process worker. Temporary VFS mailbox deliberately avoids runtime patches.
const fs = require('node:fs');
const cases = JSON.parse(fs.readFileSync('/workspace/ffi-cases.json', 'utf8'));
(async () => {
  const results = [];
  for (let id = 0; id < cases.length; id++) {
    const input = cases[id], start = performance.now();
    const path = '/workspace/ffi-reply-' + id + '.json';
    if (fs.existsSync(path)) fs.unlinkSync(path);
    console.log('FFI_REQUEST ' + JSON.stringify({id, input}));
    while (!fs.existsSync(path)) {
      if (performance.now() - start > 120000) throw Error('RPC timeout');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const response = JSON.parse(fs.readFileSync(path, 'utf8'));
    fs.unlinkSync(path);
    if (input.expectError) {
      if (response.status !== 400 || !response.body.error) throw Error('Expected rejection');
    } else {
      if (response.status !== 200 || response.body.index !== input.bytes.indexOf(input.needle) || response.body.absolute !== Math.abs(input.signed)) throw Error('Independent JS oracle mismatch ' + JSON.stringify(response));
      if (response.body.platform !== 'linux' || response.body.arch !== 'x64') throw Error('Wrong native environment');
    }
    results.push({input, ...response, workerRoundTripMs: performance.now() - start});
  }
  console.log('FFI_COMPLETE ' + JSON.stringify(results));
})().catch(e => { console.error(e); process.exitCode = 1; });
