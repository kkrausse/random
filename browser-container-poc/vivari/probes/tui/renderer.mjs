// The real OpenTUI renderer dependency used by the pinned source audit.
// No mock renderer, FFI replacement, test renderer, or host execution.
import { qualifyAbi } from './abi.mjs';
import fs from 'node:fs';
console.log('tui: entry', JSON.stringify({ platform: process.platform, arch: process.arch, versions: process.versions, stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY }));
const write = process.stdout.write.bind(process.stdout);
let inRenderer = false;
const trace = [];
const report = message => {
  trace.push(message); fs.writeFileSync('/ffi-probe/tui-trace.jsonl', trace.join(''));
  if (!inRenderer) write(message);
};
try {
  const { createCliRenderer, TextRenderable, setRenderLibPath, resolveRenderLib, t, fg } = await import('@opentui/core');
  if (process.env.VV_TUI_FFI_ARTIFACT) setRenderLibPath(process.env.VV_TUI_FFI_ARTIFACT);
  console.log('tui: imported');
  const lib = resolveRenderLib();
  if (lib.createAudioEngine() !== null) throw Error('Unavailable audio must return null');
  report('tui: audio honestly unavailable\n');
  qualifyAbi(lib, report);
  for (let cycle = 1; cycle <= 2; cycle++) {
    inRenderer = true;
    const renderer = await createCliRenderer({ exitOnCtrlC: false, useKittyKeyboard: {}, autoFocus: false });
    report(`tui: initialized ${cycle}\n`);
    const text = new TextRenderable(renderer, { id: 'qualification', content: t`Real OpenTUI renderer ${fg('#00ff00')('qualification')} cycle ${cycle}` });
    renderer.root.add(text);
    let input = '';
    const done = new Promise(resolve => renderer.keyInput.on('keypress', key => {
      report(`tui: input ${cycle} ${key.name}\n`);
      if (key.name === 'q') { renderer.destroy(); resolve(); }
      else { input += key.name; text.content = `Real OpenTUI input ${input} cycle ${cycle}`; }
    }));
    const resized = (width, height) => report(`tui: resize ${cycle} ${width}x${height}\n`);
    renderer.on('resize', resized);
    renderer.start();
    report(`tui: render requested ${cycle}\n`);
    await done;
    renderer.off('resize', resized);
    inRenderer = false;
    report(`tui: destroyed ${cycle}\n`);
  }
  process.stdin.pause();
  write(trace.filter(s => /tui: (input|resize|render requested)/.test(s)).join(''));
  report('TUI_LIFECYCLE_PASS\n');
} catch (error) {
  console.error('tui: failed', error.stack ?? String(error));
  process.exitCode = 1;
}
