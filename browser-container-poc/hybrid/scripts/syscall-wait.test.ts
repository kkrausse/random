import { test, expect } from 'bun:test';
import { patchWait } from './syscall-wait';
import { resolve } from 'node:path';

// Evaluate the actual source wait stanza with a deterministic delayed-notify
// interleaving. First wake belongs to the prior syscall; second carries response.
for (const path of ['packages/runtime/fs-client.js', 'packages/kernel-host/kernel-fs.js']) {
  test(`${path}: stale notification cannot publish request bytes as a response`, async () => {
    const text = await Bun.file(resolve(import.meta.dir, '../../vivari/.runtime/baseline', path)).text();
    const extract = (s: string) => s.slice(s.indexOf('    Atomics.wait(ctrl, I_STATE, STATE_REQUEST);'));
    const old = extract(text).split('\n')[0];
    const fixed = patchWait(text).match(/    while \(Atomics.load\(ctrl, I_STATE\) === STATE_REQUEST\) \{\n      Atomics.wait\(ctrl, I_STATE, STATE_REQUEST\);\n    \}/)![0];
    function exercise(code: string) {
      let state = 1, wakes = 0;
      const fake = { load: () => state, wait: () => { wakes++; if (wakes === 2) state = 2; return 'ok'; } };
      new Function('Atomics', 'ctrl', 'I_STATE', 'STATE_REQUEST', code)(fake, [], 0, 1);
      return { state, wakes };
    }
    expect(exercise(old)).toEqual({ state: 1, wakes: 1 });
    expect(exercise(fixed)).toEqual({ state: 2, wakes: 2 });
  });
}
