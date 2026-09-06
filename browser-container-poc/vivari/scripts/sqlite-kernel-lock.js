// Run in a SECOND booted tab on the same origin while the first owns OPFS.
return await page.evaluate(async () => {
  const source = `const assert=require('node:assert/strict'); const {DatabaseSync}=require('node:sqlite');
    const memory=new DatabaseSync(':memory:'); assert.equal(memory.prepare('SELECT 42 AS x').get().x,42); memory.close();
    assert.throws(()=>new DatabaseSync('/runtime-probe/second-kernel.sqlite'),/durable persistence unavailable/);
    console.log('SQLITE_SECOND_KERNEL_REJECTED');`;
  const vm = window.probe.vm;
  await vm.mount({ "kernel-lock.cjs": { file: { contents: source } } }, { mountPoint: "/runtime-probe" });
  const p = await vm.spawn("node", ["kernel-lock.cjs"], { cwd: "/runtime-probe" });
  let output = "";
  const timeout = setTimeout(() => p.kill(), 10000);
  try {
    const stream = (async () => { for await (const text of p.output) output += text; })();
    const code = await p.exit; await stream;
    if (code !== 0) throw new Error(output);
    return { code, output, locks: await navigator.locks.query() };
  } finally { clearTimeout(timeout); }
});
