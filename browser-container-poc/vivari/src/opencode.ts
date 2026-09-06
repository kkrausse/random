import type { Vivari, VivariProcess } from "@vivari/core";
import { modelBaseURL } from './model-transport';

type Asset = { file: string; destination: string; bytes: number; sha256: string };
type Receipt = { bytes: number; sha256: string; successMarker: string; assets?: Asset[] };
export async function runOpenCode(vm: Vivari, options: {
  recover?: boolean;
  entry?: 'host' | 'tools' | 'model' | 'prompt';
  model?: string;
  prompt?: { text: string; directory: string };
  event?: (event: { type: string; data?: Record<string, unknown> }) => void;
  signal: AbortSignal;
  log: (text: string) => void;
  process: (proc: VivariProcess | undefined) => void;
}) {
  const entry = options.entry ?? 'host';
  const response = await fetch(`/.runtime/opencode-package/${entry}-receipt.json`, { signal: options.signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
    throw Error(`Build the SDK probe first: bun scripts/package-opencode.ts ${entry}`);
  }
  const receipt: Receipt = await response.json();
  let output = "";
  let pending = "";
  const log = (text: string) => {
    output += text;
    options.log(text);
    pending += text;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.startsWith('sdk-event ')) options.event?.(JSON.parse(line.slice(10)));
    }
  };
  async function run(file: string) {
    options.signal.throwIfAborted();
    const proc = await vm.spawn("bun", [file], { cwd: "/opencode-packaged", env: {
      OPENCODE_PROBE_DURABLE: "1", OPENCODE_PROBE_RECOVER: options.recover ? "1" : "0",
      ...(options.model ? { OPENCODE_PROBE_MODEL: options.model } : {}),
      ...(['model', 'prompt'].includes(entry) ? { OPENCODE_PROBE_BASE_URL: modelBaseURL(location.origin, 'opencode') } : {}),
    } });
    options.process(proc);
    const abort = () => proc.kill();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, ['model', 'prompt'].includes(entry) ? 210000 : 90000);
    try {
      const drain = (async () => { for await (const chunk of proc.output) log(chunk); })();
      const code = await proc.exit;
      await drain;
      options.signal.throwIfAborted();
      if (timedOut || code !== 0) throw Error(`${file}: ${timedOut ? "timed out" : `exit ${code}`}`);
    } finally { clearTimeout(timer); options.signal.removeEventListener("abort", abort); options.process(undefined); }
  }
  await vm.fs.mkdir("/opencode-packaged", { recursive: true });
  for (const asset of [{ file: `${entry}.txt`, destination: `/opencode-packaged/${entry}.cjs`, bytes: receipt.bytes, sha256: receipt.sha256 } as Asset, ...(receipt.assets ?? [])]) {
    const response = await fetch(`/.runtime/opencode-package/${asset.file}`, { signal: options.signal });
    if (!response.ok) throw Error(`Asset fetch failed: ${asset.file}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw Error(`Asset digest mismatch: ${asset.file}`);
    let count = 0;
    for (let offset = 0; offset < bytes.length; offset += 262144) {
      options.signal.throwIfAborted();
      await vm.fs.writeFile(`/opencode-packaged/part-${count++}`, bytes.slice(offset, offset + 262144));
    }
    await vm.fs.writeFile("/opencode-packaged/assemble.cjs", `const fs=require('node:fs');const dest=${JSON.stringify(asset.destination)};fs.mkdirSync(require('node:path').dirname(dest),{recursive:true});const fd=fs.openSync(dest,'w');try{for(let i=0;i<${count};i++){const p='/opencode-packaged/part-'+i;fs.writeSync(fd,fs.readFileSync(p));fs.unlinkSync(p);}}finally{fs.closeSync(fd);}if(require('node:crypto').createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==${JSON.stringify(hash)})throw Error('Guest digest mismatch');`);
    await run("assemble.cjs");
    log(`Verified ${asset.destination} (${bytes.length} bytes)\n`);
  }
  if (entry === 'prompt') {
    if (!options.prompt?.text.trim()) throw Error('Prompt required');
    await vm.fs.writeFile('/opencode-packaged/prompt-input.json', JSON.stringify(options.prompt));
  }
  await run(`${entry}.cjs`);
  if (!output.includes(receipt.successMarker)) throw Error("Missing SDK completion checkpoint");
  const prefix = `checkpoint: ${entry} receipt `;
  const resultLine = output.split('\n').find(line => line.startsWith(prefix));
  if ((entry === 'tools' || entry === 'model') && !resultLine) throw Error('Missing qualification receipt');
  return { output, entry, sha256: receipt.sha256, recover: !!options.recover,
    ...(resultLine ? { qualification: JSON.parse(resultLine.slice(prefix.length)) } : {}),
  };
}
