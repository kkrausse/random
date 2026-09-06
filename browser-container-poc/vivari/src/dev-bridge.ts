import type { Vivari, VivariProcess } from '@vivari/core';
import { runOpenCode } from './opencode';

// Dev transport only. No guest command executes on the relay machine.
export function connectDevBridge(host: {
  vm: () => Vivari | undefined; boot: () => Promise<void>;
  acquire: () => () => void; log: (s: string) => void; logs: () => string;
}) {
  const runtime = crypto.randomUUID(); // New page = new identity; stale IDs never reconnect.
  const jobs = new Map<string, { abort: AbortController; proc?: VivariProcess; writer?: WritableStreamDefaultWriter<string> }>();
  let socket: WebSocket;
  const send = (value: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  async function request(message: any) {
    const connection = socket;
    // An old request must never publish onto a replacement relay connection.
    const reply = (value: unknown) => { if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(value)); };
    const { id, op, args = {} } = message;
    let release: (() => void) | undefined;
    const job = { abort: new AbortController() } as { abort: AbortController; proc?: VivariProcess; writer?: WritableStreamDefaultWriter<string> };
    const output = (data: string) => { host.log(data); reply({ type: 'event', id, event: 'output', data }); };
    try {
      let result: unknown;
      if (op === 'status') result = { ready: !!host.vm(), runtime };
      else if (op === 'logs') result = host.logs();
      else if (op === 'input' || op === 'kill') {
        const target = jobs.get(args.process);
        if (!target) throw Error('Unknown or completed process');
        if (op === 'kill') { target.abort.abort(); target.proc?.kill(); }
        else {
          if (!target.writer) throw Error('Process not ready for input');
          if (args.eof) { await target.writer.close(); target.writer.releaseLock(); target.writer = undefined; }
          else { if (typeof args.data !== 'string' || args.data.length > 262144) throw Error('Invalid input chunk'); await target.writer.write(args.data); }
        }
        result = { ok: true };
      } else {
        release = host.acquire();
        jobs.set(id, job);
        if (op === 'boot') { if (!host.vm()) await host.boot(); result = { ready: true }; }
        else {
          const vm = host.vm();
          if (!vm) throw Error('Runtime not booted');
          const attach = (proc: VivariProcess | undefined) => {
            job.writer?.releaseLock(); job.writer = undefined; job.proc = proc;
            if (proc) { job.writer = proc.input.getWriter(); if (job.abort.signal.aborted) proc.kill(); }
          };
          const run = async (argv: string[], emit: (s: string) => void, env = {}, cwd = '/workspace') => {
            if (!Array.isArray(argv) || !argv.length || !argv.every(x => typeof x === 'string')) throw Error('Expected nonempty argv');
            job.abort.signal.throwIfAborted();
            const proc = await vm.spawn(argv[0], argv.slice(1), { cwd, env });
            attach(proc);
            reply({ type: 'event', id, event: 'ready', data: { process: id } });
            const drain = (async () => { for await (const chunk of proc.output) emit(chunk); })();
            const code = await proc.exit;
            await drain; attach(undefined);
            job.abort.signal.throwIfAborted();
            return code;
          };
          if (op === 'exec') result = { code: await run(args.argv, output, args.env, args.cwd) };
          else if (op === 'probe') {
            if (args.entry !== undefined && !['host', 'tools'].includes(args.entry)) throw Error('Unknown probe entry');
            result = await runOpenCode(vm, { entry: args.entry, recover: !!args.recover, signal: job.abort.signal, log: output, process: attach });
          }
          else if (op === 'read' || op === 'write') {
            // Use guest fd I/O: SDK whole-file reads/writes exceed the syscall window.
            if (typeof args.path !== 'string' || !args.path.startsWith('/')) throw Error('Expected absolute guest path');
            if (!Number.isSafeInteger(args.offset) || args.offset < 0) throw Error('Invalid offset');
            if (op === 'read' && (!Number.isInteger(args.length) || args.length < 1 || args.length > 262144)) throw Error('Invalid chunk length');
            if (op === 'write' && (typeof args.data !== 'string' || args.data.length > 349528)) throw Error('Chunk too large');
            const source = `const fs=require('node:fs');const a=${JSON.stringify(args)};` + (op === 'read'
              ? `const fd=fs.openSync(a.path,'r');try{const b=Buffer.alloc(a.length);const n=fs.readSync(fd,b,0,b.length,a.offset);console.log(JSON.stringify({data:b.subarray(0,n).toString('base64'),size:fs.fstatSync(fd).size}));}finally{fs.closeSync(fd);}`
              : `const fd=fs.openSync(a.path,a.truncate?'w':'r+');try{const b=Buffer.from(a.data,'base64');let n=0;while(n<b.length){const k=fs.writeSync(fd,b,n,b.length-n,a.offset+n);if(!k)throw Error('Short write');n+=k;}console.log(JSON.stringify({bytes:n}));}finally{fs.closeSync(fd);}`);
            let text = '';
            const code = await run(['node', '-e', source], s => { text += s; });
            if (code !== 0) throw Error(`File operation exited ${code}: ${text}`);
            result = JSON.parse(text.trim());
          } else throw Error(`Unknown operation: ${op}`);
        }
      }
      reply({ type: 'result', id, result });
    } catch (error) { reply({ type: 'result', id, error: String(error) }); }
    finally { job.writer?.releaseLock(); jobs.delete(id); release?.(); }
  }
  async function connect() {
    try {
      const response = await fetch('http://127.0.0.1:5193/token');
      if (!response.ok) throw Error('Relay unavailable');
      const { token } = await response.json();
      socket = new WebSocket(`ws://127.0.0.1:5193/browser?token=${encodeURIComponent(token)}`);
      socket.onopen = () => send({ type: 'hello', id: runtime });
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'request') void request(message);
        if (message.type === 'cancel') { const job = jobs.get(message.id); job?.abort.abort(); job?.proc?.kill(); }
      };
      socket.onclose = () => {
        for (const job of jobs.values()) { job.abort.abort(); job.proc?.kill(); }
        setTimeout(connect, 1500);
      };
    } catch { setTimeout(connect, 1500); }
  }
  window.addEventListener('error', event => host.log(`[browser error] ${event.message}\n`));
  window.addEventListener('unhandledrejection', event => host.log(`[unhandled rejection] ${event.reason}\n`));
  void connect();
}
