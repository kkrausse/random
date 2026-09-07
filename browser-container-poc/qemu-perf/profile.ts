// Reuse the baseline observer read-only, with evidence scoped to this spike.
import { mkdir } from 'node:fs/promises';
const [session, mode = 'edit', countText = '5', label = 'baseline'] = process.argv.slice(2);
const count = Number(countText);
if (!session || !['edit', 'http', 'reload'].includes(mode) || !Number.isInteger(count) || count < 1 || count > 20 || !/^[\w-]+$/.test(label)) {
  throw new Error('Usage: bun qemu-perf/profile.ts <session> <edit|http|reload> <1-20> <label>');
}
const source = await Bun.file(new URL('../qemu/scripts/profile-browser.js', import.meta.url)).text();
// The baseline fixture observer restores before returning. Wrap it to retain raw
// guest HTTP timing responses during both the measured edit and restoration.
const observedSource = `const responseStart=Date.now(); const value=await(async()=>{${source}\n})();
value.serialResponses=await page.frames()[1].evaluate((start)=>guestBridge.perfResponses?.filter(x=>x.receivedAt>=start)??[],responseStart); return value;`;
const directory = new URL('./evidence/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL(`${Date.now()}-${label}-${mode}.json`, directory);
const report = { session, mode, label, startedAt: new Date().toISOString(), samples: [] as unknown[], failure: undefined as unknown,
  emergencyRestoration: undefined as unknown };
async function browser(code: string) {
  const child = Bun.spawn(['browser-control', 'execute', '--session', session, '--json', code], { stdout: 'pipe', stderr: 'inherit' });
  const text = await new Response(child.stdout).text();
  const status = await child.exited;
  const result = JSON.parse(text);
  if (status || !result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
// Keep recovery data outside the page evaluation: context destruction can
// interrupt its finally block while the VM and guest write survive.
const backup = mode === 'edit' ? await browser(`return await page.frames()[1].evaluate(()=>guestBridge.request({type:'exec',command:'base64 src/WelcomeCard.tsx'}))`) : undefined;
if (backup && (backup.code !== 0 || !backup.stdout)) throw new Error('Cannot back up fixture');
for (let index = 0; index < count; index++) {
  const child = Bun.spawn(['browser-control', 'execute', '--session', session, '--json',
    `state.profileConfig=${JSON.stringify({ mode })};\n${observedSource}`], { stdout: 'pipe', stderr: 'inherit' });
  const text = await new Response(child.stdout).text();
  const code = await child.exited;
  let result;
  try { result = JSON.parse(text); } catch { result = { ok: false, error: text }; }
  if (code || !result.ok) report.failure = { index, error: result.error };
  else report.samples.push(result.value);
  await Bun.write(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(result.value ?? report.failure));
  if (report.failure) {
    if (backup) {
      const encoded = backup.stdout.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error('Invalid backup encoding');
      const command = `printf '%s' '${encoded}' | base64 -d > src/WelcomeCard.tsx; base64 src/WelcomeCard.tsx`;
      try {
        const restored = await browser(`return await page.frames()[1].evaluate(command=>guestBridge.request({type:'exec',command}),${JSON.stringify(command)})`);
        report.emergencyRestoration = { verified: restored.code === 0 && restored.stdout.replace(/\s/g, '') === encoded };
      } catch (error) { report.emergencyRestoration = { verified: false, error: String(error) }; }
      await Bun.write(output, JSON.stringify(report, null, 2) + '\n');
    }
    throw new Error(`Failed; retained ${output.pathname}`);
  }
}
console.log(output.pathname);
