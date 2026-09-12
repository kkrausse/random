import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { qualifiedOpenCodeCandidate, readQualifiedOpenCodeApplication, verifyApplicationDelivery } from '../src/opencode-application';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(change: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'opencode-application-'));
  directories.push(root);
  const outputs = { 'server.js': { bytes: 4, sha256: hash('test') } };
  const receipt = JSON.stringify({ result: 'BUILD_PASS', exitCode: 0, sourceStatus: '', sourceRevision: 'fixture', outputs, ...change });
  await writeFile(join(root, 'build-receipt.json'), receipt);
  await writeFile(join(root, 'server.js'), 'test');
  return { receiptPath: join(root, 'build-receipt.json'), outputDirectory: root, guestDirectory: '/app',
    contract: { id: 'supporting-verifier-fixture', receiptSha256: hash(receipt), sourceRevision: 'fixture', outputs } };
}

test('generic verifier returns checked bytes and independently supplied provenance', async () => {
  const input = await fixture();
  const result = await verifyApplicationDelivery(input);
  expect(result.assets[0].bytes.toString()).toBe('test');
  expect(result.assets[0].destination).toBe('/app/server.js');
  expect(result.provenance).toEqual({ id: input.contract.id, receiptSha256: input.contract.receiptSha256, sourceRevision: 'fixture' });
});

test('rejects changed output even at the same byte length', async () => {
  const input = await fixture();
  await writeFile(join(input.outputDirectory, 'server.js'), 'evil');
  await expect(verifyApplicationDelivery(input)).rejects.toThrow('output integrity');
});

test('rejects changed receipt bytes before trusting its outputs', async () => {
  const input = await fixture();
  await writeFile(input.receiptPath, '{}');
  await expect(verifyApplicationDelivery(input)).rejects.toThrow('receipt integrity');
});

test('rejects wrong revision, dirty build, and mismatched output records even under caller hash', async () => {
  for (const change of [{ sourceRevision: 'wrong' }, { sourceStatus: ' M server.ts' }, { outputs: { 'server.js': { bytes: 4, sha256: hash('evil') } } }]) {
    await expect(verifyApplicationDelivery(await fixture(change))).rejects.toThrow('receipt');
  }
});

test('exact candidate wrapper rejects a generic passing receipt', async () => {
  const input = await fixture();
  await expect(readQualifiedOpenCodeApplication(input.outputDirectory, { outputDirectory: input.outputDirectory })).rejects.toThrow('receipt integrity');
  expect(Object.keys(qualifiedOpenCodeCandidate.outputs)).toHaveLength(5);
});

test('rejects escaping delivery targets and output names', async () => {
  const input = await fixture();
  await expect(verifyApplicationDelivery({ ...input, guestDirectory: '/app/../escape' })).rejects.toThrow('guest directory');
  const unsafe = await fixture({ outputs: { '../escape': { bytes: 4, sha256: hash('test') } } });
  unsafe.contract.outputs = { '../escape': { bytes: 4, sha256: hash('test') } } as typeof unsafe.contract.outputs;
  await expect(verifyApplicationDelivery(unsafe)).rejects.toThrow('output contract');
});
