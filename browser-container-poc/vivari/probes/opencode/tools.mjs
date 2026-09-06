// Actual pinned SDK APIs in the guest; fixture setup/assertions use Node fs.
import { OpenCode } from '@opencode-ai/sdk';
import fs from 'node:fs';
import { Global } from '@opencode-ai/util/global';
import { qualifyTools } from './tool-registry.mjs';
// Provision the genuine WASM executable at OpenCode's ordinary binary-cache path.
// Vivari's chmod is currently a no-op, so PATH which() rejects mode-0666 files.
fs.mkdirSync(Global.Path.bin, { recursive: true });
fs.copyFileSync('/bin/rg', `${Global.Path.bin}/rg`);
console.log('checkpoint: ripgrep cache provisioned', Global.Path.bin);
const directory = `/workspace/opencode-tools-${Date.now()}`;
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(`${directory}/sum.cjs`, 'module.exports = (a, b) => a - b;\n');
fs.writeFileSync(`${directory}/sum.test.cjs`, "require('node:assert/strict').equal(require('./sum.cjs')(2,3),5);console.log('fixture test passed');\n");
const assert = (condition, message) => { if (!condition) throw Error(message); };
console.log('checkpoint: tools creating host', directory);
const host = await OpenCode.create({ log: { level: 'debug', emit: entry => console.log('sdk-log', JSON.stringify(entry)) } });
try {
  const location = { directory };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  const events = host.events.subscribe({ signal: abort.signal })[Symbol.asyncIterator]();
  try {
    const connected = await events.next();
    assert(connected.value?.type === 'server.connected', 'SDK event stream missing connection handshake');
    const session = await host.sessions.create({ location, title: 'Browser tool qualification' });
    let seen = false;
    while (!seen) {
      const next = await events.next();
      assert(!next.done, 'SDK event stream closed before session event');
      seen = next.value.type === 'session.created' && JSON.stringify(next.value).includes(session.id);
    }
    console.log('checkpoint: SDK streamed session.created', session.id);
  } finally { clearTimeout(timer); abort.abort(); await events.return?.(); }
  const content = await host.file.read({ location, path: 'sum.cjs' });
  assert(new TextDecoder().decode(content).includes('a - b'), 'SDK file.read content mismatch');
  console.log('checkpoint: file.read passed');
  let missingRejected = false;
  try { await host.file.read({ location, path: 'missing.cjs' }); }
  catch { missingRejected = true; }
  assert(missingRejected, 'SDK missing file unexpectedly readable');
  const listing = await host.file.list({ location });
  console.log('checkpoint: file.list', JSON.stringify(listing));
  assert(JSON.stringify(listing.data).includes('sum.test.cjs'), 'SDK file.list missing fixture');
  const found = await host.file.find({ location, query: 'sum', type: 'file' });
  console.log('checkpoint: file.find', JSON.stringify(found));
  assert(JSON.stringify(found.data).includes('sum.cjs'), 'SDK file.find missing fixture');
  const absent = await host.file.find({ location, query: 'no-such-fixture-xyz', type: 'file' });
  assert(absent.data.length === 0, 'SDK file.find absent query matched');
} finally {
  await host.close();
  console.log('checkpoint: tools host closed');
}
const registry = await qualifyTools(directory);
console.log('checkpoint: tools receipt', JSON.stringify(registry));
console.log('checkpoint: tools passed');
