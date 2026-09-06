import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const session = args[0];
const count = Number(args[1] ?? 3);
const mode = args[2] ?? 'all';
if (!session || !Number.isInteger(count) || count < 1 || count > 20 || !['all', 'edit', 'reload', 'http'].includes(mode)) {
  console.error('Usage: bun run profile <browser-control-session> [1-20 samples, default 3] [all|edit|reload|http]');
  process.exit(1);
}
const source = await Bun.file(new URL('./profile-browser.js', import.meta.url)).text();
const directory = new URL('../../doc/logs/qemu/profiles/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { session, mode, startedAt: new Date().toISOString(), samples: [] as any[], failure: undefined as unknown };
const output = new URL(`${Date.now()}-${mode}.json`, directory);
const modes = mode === 'all' ? ['reload', 'http', 'edit'] : [mode];
for (const phase of modes) {
  for (let index = 0; index < count; index++) {
    console.log(`${phase} sample ${index + 1}/${count}…`);
    const child = Bun.spawn(['browser-control', 'execute', '--session', session, '--json',
      `state.profileConfig = ${JSON.stringify({ mode: phase })};\n${source}`], { stdout: 'pipe', stderr: 'inherit' });
    const text = await new Response(child.stdout).text();
    const code = await child.exited;
    let result;
    try { result = JSON.parse(text); } catch { result = { ok: false, error: `Invalid browser-control output: ${text}` }; }
    if (code || !result.ok) {
      report.failure = { phase, sample: index + 1, error: result.error, diagnostic: result.diagnostic };
      await Bun.write(output, JSON.stringify(report, null, 2) + '\n');
      throw new Error(`Profile failed; report: ${output.pathname}\n${JSON.stringify(report.failure)}`);
    }
    report.samples.push(result.value);
    await Bun.write(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(result.value, null, 2));
  }
  const times = report.samples.filter((sample) => sample.mode === phase)
    .map((sample) => sample.visibleMs ?? sample.roundTripMs).sort((a, b) => a - b);
  console.log(`${phase}: min ${times[0].toFixed(0)} ms, median ${times[Math.floor(times.length / 2)].toFixed(0)} ms, max ${times.at(-1).toFixed(0)} ms`);
}
console.log(`Report: ${output.pathname}`);
