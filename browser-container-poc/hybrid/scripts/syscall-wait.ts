// Source-build overlay only. Never modify the sibling checkout or emitted JS.
export function patchWait(source: string) {
  const before = '    Atomics.wait(ctrl, I_STATE, STATE_REQUEST);';
  if (source.split(before).length !== 2) throw Error('Pinned syscall wait site changed');
  return source.replace(before, '    while (Atomics.load(ctrl, I_STATE) === STATE_REQUEST) {\n      Atomics.wait(ctrl, I_STATE, STATE_REQUEST);\n    }');
}
