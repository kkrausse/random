import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dir, '../../.runtime/opencode-release-2.0.3');
const evidence = resolve(root, 'browser-acceptance');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const receipts = await Promise.all((await readdir(evidence)).filter(file => /^mu3.*-\d+-.*\.json$/.test(file)).map(async file => {
  const bytes = await readFile(resolve(evidence, file));
  return { file, sha256: hash(bytes), ...JSON.parse(bytes.toString()) };
}));
const run = 'mu3bs824';
const required = ['startup', 'ready', 'crud-add', 'crud-toggle', 'crud-delete', 'source-open', 'hmr-verify', 'model-verify', 'file-link', 'shell-verify', 'tailwind-verify', 'closed', 'retention'];
for (const phase of required) assert(receipts.some(r => r.run === run && r.phase === phase && r.status === 'PASS'), `Missing ${phase}`);
const shell = receipts.find(r => r.run === run && r.phase === 'shell-verify' && r.status === 'PASS');
assert.equal(shell.exit, 0);
assert.equal(shell.output[0].text, `editor-shell-${run}\n`);
const css = receipts.find(r => r.run === run && r.phase === 'tailwind-verify' && r.status === 'PASS');
assert.equal(css.sameDocument, true);
assert.equal(css.style.computed, '37px');
assert(css.style.matchingRules.length > 0);
for (const receipt of receipts.filter(r => r.run === run && r.phase === 'closed' && r.status === 'PASS')) {
  const chat = receipt.serviceExits.find((s: { name: string }) => s.name === 'chat');
  assert.deepEqual(chat.result, { exitCode: 0, signal: null, forced: false });
  assert.equal(chat.drained, true);
}
const restored = receipts.find(r => r.file === `${run}-027-close.json`);
assert.equal(restored.retention.source, await Bun.file(resolve(import.meta.dir, '../../../todo-app-demo/src/home.tsx')).text());
assert(receipts.some(r => r.run === 'mu3c05tk' && r.phase === 'cancel-startup' && r.status === 'SUBMITTED'));
assert(receipts.some(r => r.run === 'mu3c05tk' && r.phase === 'closed' && r.status === 'PASS'));
const tested = await Bun.file(resolve(evidence, 'tested-build-receipt.json')).json();
const final = await Bun.file(resolve(root, 'build-receipt.json')).json();
assert.deepEqual(tested.outputs, final.outputs, 'Provenance correction changed tested application bytes');
const smoke = await Bun.file(resolve(evidence, 'final-receipt-smoke.json')).json();
assert.equal(smoke.status, 'PASS');
assert(receipts.some(r => r.run === smoke.run && r.phase === 'ready' && r.status === 'PASS'));
assert.deepEqual(smoke.exits.find((s: { name: string }) => s.name === 'chat').result, { exitCode: 0, signal: null, forced: false });
const summary = { result: 'PASS', version: '2.0.3', run, cancellation: 'mu3c05tk', required,
  finalReceiptSmoke: smoke,
  server: final.outputs['server.js'], receiptSha256: hash(await readFile(resolve(root, 'build-receipt.json'))),
  testedReceiptSha256: hash(await readFile(resolve(evidence, 'tested-build-receipt.json'))),
  provenanceCorrection: 'Published-archive integrity is explicit; final build outputs are byte-identical to the browser-tested outputs',
  checks: receipts.map(({ file, sha256, phase, status }) => ({ file, sha256, phase, status })),
};
await Bun.write(resolve(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
