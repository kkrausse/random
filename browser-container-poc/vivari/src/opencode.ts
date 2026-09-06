import type { Vivari, VivariProcess } from "@vivari/core";

type Asset = { file: string; destination: string; bytes: number; sha256: string };
type Receipt = { bytes: number; sha256: string; successMarker: string; assets?: Asset[] };
export async function runOpenCode(vm: Vivari, options: {
  recover?: boolean;
  signal: AbortSignal;
  log: (text: string) => void;
  process: (proc: VivariProcess | undefined) => void;
}) {
  const response = await fetch("/.runtime/opencode-package/host-receipt.json", { signal: options.signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
    throw Error("Build the SDK demo first: bun scripts/package-opencode.ts host");
  }
  const receipt: Receipt = await response.json();
  let output = "";
  const log = (text: string) => { output += text; options.log(text); };
  async function run(file: string) {
    options.signal.throwIfAborted();
    const proc = await vm.spawn("bun", [file], { cwd: "/opencode-packaged", env: {
      OPENCODE_PROBE_DURABLE: "1", OPENCODE_PROBE_RECOVER: options.recover ? "1" : "0",
    } });
    options.process(proc);
    const abort = () => proc.kill();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 90000);
    try {
      const drain = (async () => { for await (const chunk of proc.output) log(chunk); })();
      const code = await proc.exit;
      await drain;
      options.signal.throwIfAborted();
      if (timedOut || code !== 0) throw Error(`${file}: ${timedOut ? "timed out" : `exit ${code}`}`);
    } finally { clearTimeout(timer); options.signal.removeEventListener("abort", abort); options.process(undefined); }
  }
  await vm.fs.mkdir("/opencode-packaged", { recursive: true });
  for (const asset of [{ file: "host.txt", destination: "/opencode-packaged/host.cjs", bytes: receipt.bytes, sha256: receipt.sha256 }, ...(receipt.assets ?? [])]) {
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
  await run("host.cjs");
  if (!output.includes(receipt.successMarker)) throw Error("Missing SDK completion checkpoint");
  return { output, sha256: receipt.sha256, recover: !!options.recover };
}
