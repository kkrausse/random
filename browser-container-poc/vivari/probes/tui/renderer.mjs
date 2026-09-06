// The real OpenTUI renderer dependency used by the pinned source audit.
// No mock renderer, FFI replacement, test renderer, or host execution.
console.log('tui: entry', JSON.stringify({ platform: process.platform, arch: process.arch, versions: process.versions, stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY }));
try {
  const { createCliRenderer, TextRenderable } = await import('@opentui/core');
  console.log('tui: imported');
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useKittyKeyboard: {}, autoFocus: false });
  console.log('tui: initialized');
  renderer.root.add(new TextRenderable(renderer, { id: 'qualification', content: 'Real OpenTUI renderer qualification' }));
  renderer.keyInput.on('keypress', key => {
    console.log('tui: input', key.name);
    if (key.name === 'q') renderer.destroy();
  });
  renderer.start();
  console.log('tui: render requested');
} catch (error) {
  console.error('tui: failed', error.stack ?? String(error));
  process.exitCode = 1;
}
