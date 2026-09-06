import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

const relay = 'http://127.0.0.1:5193';
const chunkSize = 256 * 1024;
const usage = `Usage: bun scripts/vv.ts status
       bun scripts/vv.ts --runtime ID boot
       bun scripts/vv.ts --runtime ID exec -- COMMAND [ARG...]
       bun scripts/vv.ts --runtime ID shell
       bun scripts/vv.ts --runtime ID logs [--follow]
       bun scripts/vv.ts --runtime ID read PATH [HOST_FILE|-]
       bun scripts/vv.ts --runtime ID write PATH [HOST_FILE|-]
       bun scripts/vv.ts --runtime ID probe [--recover|--tools|--model [MODEL_ID]]
File transfers default to host stdout/stdin. All paths are browser-runtime paths
except HOST_FILE. Global flags before the command: --runtime ID,
--cwd PATH (default /workspace), --timeout MS, --env KEY=VALUE (repeatable).
shell exits with Ctrl+D; Ctrl+C interrupts its foreground job.`;
const words = process.argv.slice(2);
let runtime: string | undefined;
let cwd = '/workspace', timeout = 120000;
const env: Record<string, string> = {};
while (['--runtime', '--cwd', '--timeout', '--env'].includes(words[0] ?? '')) {
  const flag = words.shift(), value = words.shift();
  if (!value) throw Error(`Missing value for ${flag}`);
  if (flag === '--runtime') runtime = value;
  if (flag === '--cwd') cwd = value;
  if (flag === '--timeout') timeout = Number(value);
  if (flag === '--env') { const at = value.indexOf('='); if (at < 1) throw Error('Expected KEY=VALUE'); env[value.slice(0, at)] = value.slice(at + 1); }
}
const command = words.shift();

type Message = { type: string; id: string; event?: string; data?: unknown; result?: any; error?: unknown };
async function request(
  op: string,
  args: Record<string, unknown> = {},
  options: { id?: string; timeout?: number; ready?: () => void; output?: (data: string) => void } = {},
): Promise<any> {
  const response = await fetch(`${relay}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime, op, args, requestId: options.id ?? crypto.randomUUID(), timeout: options.timeout ?? timeout }),
  });
  if (!response.ok) throw new Error(`Relay HTTP ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error('Missing relay response stream');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Relay disconnected before result');
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const message: Message = JSON.parse(line);
        if (message.type === 'event' && message.event === 'ready') options.ready?.();
        if (message.type === 'event' && message.event === 'output' && typeof message.data === 'string') {
          (options.output ?? ((data) => { process.stdout.write(data); }))(message.data);
        }
        if (message.type === 'result') {
          if (message.error !== undefined && message.error !== null) {
            throw new Error(typeof message.error === 'string' ? message.error : JSON.stringify(message.error));
          }
          return message.result;
        }
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function print(value: unknown) {
  if (value !== undefined) console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function execute(argv: string[], interactive: boolean) {
  const id = crypto.randomUUID();
  let finished = false;
  let input = Promise.resolve();
  const decoder = new StringDecoder('utf8');
  let ready = false;
  const raw = interactive && !!process.stdin.isTTY;
  const sendInput = (data: string) => {
    if (!data) return;
    process.stdin.pause();
    input = input.then(async () => {
      if (!finished) await request('input', { process: id, data });
    }).catch((error) => {
      if (!finished) console.error(`stdin: ${error.message}`);
    }).finally(() => { if (!finished) process.stdin.resume(); });
  };
  const onData = (data: Buffer) => sendInput(decoder.write(data));
   const onEnd = () => {
     sendInput(decoder.end() + (interactive ? '\x04' : ''));
     if (!interactive) input = input.then(async () => { if (!finished) await request('input', { process: id, eof: true }); }).catch(error => { if (!finished) console.error(`stdin EOF: ${error.message}`); });
   };
  const kill = () => {
    void request('kill', { process: id }).catch((error) => console.error(`kill: ${error.message}`));
  };
  process.on('SIGINT', kill);
  process.on('SIGTERM', kill);
  try {
    const result = await request('exec', { argv, cwd, env }, {
      id,
      timeout: interactive ? 86_400_000 : timeout,
      output: data => { process.stdout.write(raw ? data.replace(/(?<!\r)\n/g, '\r\n') : data); },
      ready: () => {
        if (ready) return;
        ready = true;
        if (raw) process.stdin.setRawMode(true);
        process.stdin.on('data', onData);
        process.stdin.once('end', onEnd);
        process.stdin.resume();
      },
    });
    const code = typeof result === 'number' ? result : result?.exitCode ?? result?.code;
    if (typeof code === 'number' && Number.isInteger(code)) process.exitCode = code;
  } finally {
    finished = true;
    if (raw) process.stdin.setRawMode(false);
    process.stdin.off('data', onData);
    process.stdin.off('end', onEnd);
    process.stdin.pause();
    process.off('SIGINT', kill);
    process.off('SIGTERM', kill);
    await input;
  }
}

async function readFile(path: string, destination?: string) {
  const file = destination && destination !== '-' ? await open(destination, 'w') : undefined;
  try {
    let offset = 0;
    while (true) {
      const result = await request('read', { path, offset, length: chunkSize });
      if (typeof result?.data !== 'string' || !Number.isSafeInteger(result?.size) || result.size < offset) {
        throw new Error('Invalid read result: expected {data:base64,size:totalBytes}');
      }
      const data = Buffer.from(result.data, 'base64');
      if (data.length > chunkSize || offset + data.length > result.size || (!data.length && offset < result.size)) {
        throw new Error('Invalid read chunk length');
      }
      if (file) {
        let written = 0;
        while (written < data.length) {
          const { bytesWritten } = await file.write(data, written, data.length - written);
          if (!bytesWritten) throw new Error('Host file write made no progress');
          written += bytesWritten;
        }
      } else if (!process.stdout.write(data)) await once(process.stdout, 'drain');
      offset += data.length;
      if (offset >= result.size) break;
    }
  } finally { await file?.close(); }
}

async function writeFile(path: string, source?: string) {
  const file = source && source !== '-' ? await open(source, 'r') : undefined;
  let offset = 0;
  const send = async (data: Buffer) => {
    const result = await request('write', { path, offset, data: data.toString('base64'), truncate: offset === 0 });
    if (result?.bytes !== data.length) throw Error('Guest write byte count mismatch');
    offset += data.length;
  };
  try {
    if (file) {
      const buffer = Buffer.alloc(chunkSize);
      while (true) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        await send(buffer.subarray(0, bytesRead));
      }
    } else {
      for await (const value of process.stdin) {
        const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
        for (let start = 0; start < data.length; start += chunkSize) await send(data.subarray(start, start + chunkSize));
      }
    }
    if (offset === 0) await send(Buffer.alloc(0));
  } finally { await file?.close(); }
}

async function main() {
  if (!command || command === '--help' || command === '-h') { console.log(usage); return; }
  if (command === 'status') {
    if (words.length) throw new Error(usage);
    const response = await fetch(`${relay}/runtimes`);
    if (!response.ok) throw new Error(`Relay HTTP ${response.status}: ${await response.text()}`);
    print(runtime ? await request('status') : await response.json());
    return;
  }
  if (!runtime || runtime.startsWith('--')) throw new Error(`--runtime ID is required.\n${usage}`);
  switch (command) {
    case 'boot':
      if (words.length) throw new Error(usage);
      print(await request('boot'));
      break;
    case 'exec':
      if (words.shift() !== '--' || !words.length) throw new Error(usage);
      await execute(words, false);
      break;
    case 'shell':
      if (words.length) throw new Error(usage);
      await execute(['sh'], true);
      break;
    case 'logs': {
      if (words.length > 1 || (words.length && words[0] !== '--follow')) throw new Error(usage);
      let previous: string | undefined;
      do {
        const result = await request('logs');
        const snapshot = typeof result === 'string' ? result : JSON.stringify(result);
        if (snapshot !== previous) {
          if (previous !== undefined && snapshot.startsWith(previous)) process.stdout.write(snapshot.slice(previous.length));
          else process.stdout.write(snapshot);
        }
        previous = snapshot;
        if (!words.length) break;
        await Bun.sleep(1000);
      } while (true);
      break;
    }
    case 'read':
    case 'write':
      if (!words[0] || words.length > 2) throw new Error(usage);
      await (command === 'read' ? readFile : writeFile)(words[0], words[1]);
      break;
    case 'probe':
      if (words[0] === '--model') {
        if (words.length > 2 || (words[1] && !/^[a-zA-Z0-9._-]+$/.test(words[1]))) throw new Error(usage);
        const { output: _output, ...receipt } = await request('probe', { entry: 'model', model: words[1] }, { timeout: Math.max(timeout, 240000) });
        print(receipt);
      } else {
        if (words.length > 1 || (words.length && !['--recover', '--tools'].includes(words[0]))) throw new Error(usage);
        const { output: _output, ...receipt } = await request('probe', { entry: words[0] === '--tools' ? 'tools' : 'host', recover: words[0] === '--recover' }); print(receipt);
      }
      break;
    default: throw new Error(usage);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
