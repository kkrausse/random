// Run against a booted real browser runtime. Never substitutes a host executor.
export {};
const runtime = process.argv[2];
if (!runtime) throw Error('Usage: bun scripts/qualify-bridge.ts RUNTIME_ID');
async function request(op: string, args: unknown, requestId = crypto.randomUUID(), timeout = 30000) {
  const response = await fetch('http://127.0.0.1:5193/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime, op, args, requestId, timeout }) });
  const text = await response.text();
  if (!response.ok) throw Error(text);
  const messages = text.trim().split('\n').map(line => JSON.parse(line));
  const final = messages.find(m => m.type === 'result');
  if (!final || final.error) throw Error(JSON.stringify(messages));
  return { result: final.result, output: messages.filter(m => m.event === 'output').map(m => m.data).join('') };
}
const assert = (value: unknown, message: string) => { if (!value) throw Error(message); };
await request('boot', {});
const command = await request('exec', { argv: ['node', '-e', "console.log(process.cwd());console.error('stderr-marker');process.exit(7)"], cwd: '/workspace' });
assert(command.result.code === 7 && command.output.includes('/workspace') && command.output.includes('stderr-marker'), 'output/cwd/exit');
const path = `/workspace/bridge-proof-${Date.now()}.bin`;
const bytes = crypto.getRandomValues(new Uint8Array(65536));
const fixture = Buffer.concat(Array.from({length: 20}, () => Buffer.from(bytes)));
for (let offset = 0; offset < fixture.length; offset += 262144) await request('write', { path, offset, data: fixture.subarray(offset, offset + 262144).toString('base64'), truncate: offset === 0 });
const chunks: Buffer[] = [];
for (let offset = 0; offset < fixture.length; offset += 262144) {
  const { result } = await request('read', { path, offset, length: 262144 });
  assert(result.size === fixture.length, 'file size'); chunks.push(Buffer.from(result.data, 'base64'));
}
assert(Buffer.concat(chunks).equals(fixture), 'large binary roundtrip');
await request('exec', { argv: ['node', '-e', `require('fs').unlinkSync(${JSON.stringify(path)})`] });
console.log('PASS: live browser cwd, merged stdout/stderr, nonzero exit, 1.25 MiB binary roundtrip');
const shellId = crypto.randomUUID();
const response = await fetch('http://127.0.0.1:5193/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime, op: 'exec', args: { argv: ['sh'], cwd: '/workspace' }, requestId: shellId, timeout: 30000 }) });
let pending = '', shellOutput = '', started = false, interrupted = false, resumed = false, closing = false, exited = false;
for await (const chunk of response.body!) {
  pending += new TextDecoder().decode(chunk);
  while (pending.includes('\n')) {
    const end = pending.indexOf('\n');
    const event = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
    if (event.error) throw Error(event.error);
    if (event.event === 'ready' && !started) {
      started = true;
      await request('input', { process: shellId, data: "cd /\rpwd\rnode -e \"console.log('WAITING');setInterval(()=>{},1000)\"\r" });
    }
    if (event.event === 'output') {
      shellOutput += event.data;
      // Wait for actual process output, not the shell's command echo.
      if (shellOutput.includes('\nWAITING\n') && !interrupted) {
        interrupted = true;
        await request('input', { process: shellId, data: '\x03' });
        shellOutput = '';
      } else if (interrupted && !resumed && shellOutput.includes('$\x1b[0m ')) {
        resumed = true;
        shellOutput = '';
        await request('input', { process: shellId, data: 'echo shell-survived\r' });
      } else if (resumed && !closing && shellOutput.includes('\nshell-survived\n') && shellOutput.includes('$\x1b[0m ')) {
        closing = true;
        await request('input', { process: shellId, data: '\x04' });
      }
    }
    if (event.type === 'result') { assert(event.result.code === 0, 'shell exit'); exited = true; }
  }
}
assert(started && interrupted && exited && shellOutput.includes('shell-survived'), `shell input/cancel: ${shellOutput}`);
console.log('PASS: existing sh stdin, cwd, foreground Ctrl+C, shell survives and exits');
