import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runHeadlessProcessProbe } from './headless-process-probe.mjs';

const directory = fileURLToPath(new URL('../.runtime/headless-diagnostics', import.meta.url));
const out = 'OUT: α🙂\n';
const err = 'ERR: β🙂\n';
const eof = 'EOF observed\n';
const guest = `
const timer = setInterval(() => {}, 1000);
process.stdin.on('end', () => {
  process.stdout.write(${JSON.stringify(eof)});
  clearInterval(timer);
});
process.stdin.resume();
process.stdout.write('OUT: ');
process.stdout.write('α🙂\\n');
process.stderr.write('ERR: ');
process.stderr.write('β🙂\\n');
`;

async function launch(api) {
  await api.kernel.writeFilesBatch([{ path: '/probe.cjs', bytes: Buffer.from(guest) }]);
  const pid = api.launch('node', ['/probe.cjs'], { cwd: '/', env: { PATH: '/bin', HOME: '/tmp' } });
  await Promise.all([api.waitForOutput('stdout', out), api.waitForOutput('stderr', err)]);
  assert.ok(api.kernel.procs.has(pid), 'Both channels must be observed while the guest is still alive');
  assert.equal(api.text('stdout'), out);
  assert.equal(api.text('stderr'), err);
  api.stage('both-markers-observed-before-eof');
}

function verifyLogs(result, expectedOut) {
  for (const [channel, expected] of [['stdout', expectedOut], ['stderr', err]]) {
    const info = result.receipt.channels[channel];
    const bytes = Buffer.from(expected);
    assert.deepEqual(readFileSync(info.path), bytes);
    assert.equal(info.receivedBytes, bytes.length);
    assert.equal(info.persistedBytes, bytes.length);
    assert.equal(info.workerMessageBytes, bytes.length);
    assert.equal(info.receivedSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(info.persistedSha256, info.receivedSha256);
    assert.equal(info.fsynced, true);
    assert.equal(info.closed, true);
    assert.equal(info.observationComplete, true);
    assert.deepEqual(info.errors, []);
  }
  assert.equal(result.receipt.cleanup.completed, true);
  assert.equal(result.receipt.workers.length, 2);
  for (const worker of result.receipt.workers) {
    assert.equal(worker.terminationJoined, true);
    assert.equal(worker.exitObserved, true);
    assert.deepEqual(worker.errors, []);
  }
}

test('real guest: both channels observed before EOF, exact bytes and clean exit', { timeout: 20000 }, async () => {
  const result = await runHeadlessProcessProbe({ directory, name: 'live-eof', timeoutMs: 10000,
    exercise: async api => {
      await launch(api);
      api.closeStdin();
      await api.waitForOutput('stdout', eof);
      api.stage('guest-eof-observed');
      const exit = await api.waitForExit();
      assert.equal(exit.code, 0);
      assert.equal(exit.natural, true);
      assert.equal(exit.forced, false);
    },
  });
  assert.equal(result.receipt.result, 'PASS', JSON.stringify(result.receipt.primaryFailure));
  verifyLogs(result, out + eof);
  assert.deepEqual(JSON.parse(readFileSync(result.receiptPath, 'utf8')), result.receipt);
  assert.equal(result.receipt.stdin[0].posted, true);
  console.log('LIVE_EOF_RECEIPT', result.receiptPath, result.receiptSha256);
});

test('real guest: deadline retains both channels, forced exit and joined cleanup', { timeout: 15000 }, async () => {
  const result = await runHeadlessProcessProbe({ directory, name: 'forced-timeout', timeoutMs: 2000,
    exercise: async api => {
      await launch(api);
      await api.waitForOutput('stdout', 'INTENTIONALLY-ABSENT');
    },
  });
  assert.equal(result.receipt.result, 'TIMEOUT');
  assert.equal(result.receipt.primaryFailure.kind, 'timeout');
  assert.equal(result.receipt.primaryFailure.stage, 'both-markers-observed-before-eof');
  assert.equal(result.receipt.exit.forced, true);
  assert.equal(result.receipt.exit.natural, false);
  assert.equal(result.receipt.exit.code, 143);
  assert.equal(result.receipt.stdin.length, 0);
  verifyLogs(result, out);
  assert.deepEqual(JSON.parse(readFileSync(result.receiptPath, 'utf8')), result.receipt);
  console.log('TIMEOUT_RECEIPT', result.receiptPath, result.receiptSha256);
});

test('real guest: receipt-write failure remains explicit and preserves primary failure', { timeout: 15000 }, async () => {
  const result = await runHeadlessProcessProbe({ directory, name: 'receipt-error', timeoutMs: 10000,
    exercise: async api => {
      await launch(api);
      // A real filesystem error, not a mocked writer. Atomic rename cannot replace a directory.
      mkdirSync(resolve(api.root, 'receipt.json'));
      throw new Error('intentional primary exercise failure');
    },
  });
  assert.equal(result.receipt.result, 'FAIL');
  assert.equal(result.receipt.primaryFailure.message, 'intentional primary exercise failure');
  assert.equal(result.receiptPath, null);
  assert.ok(result.receiptWriteError);
  assert.ok(result.receipt.secondaryFailures.some(failure => failure.kind === 'receipt.write'));
  assert.equal(result.receipt.exit.forced, true);
  verifyLogs(result, out);
  // The fsynced temporary receipt retains the original failure even when publication failed.
  const pending = JSON.parse(readFileSync(result.intendedReceiptPath + '.tmp', 'utf8'));
  assert.equal(pending.primaryFailure.message, result.receipt.primaryFailure.message);
  console.log('EXPECTED_RECEIPT_WRITE_FAILURE', result.intendedReceiptPath, result.receiptWriteError.code);
});
