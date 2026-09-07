// Browser Control CLI: starts a bounded asynchronous probe, leaving the VM alive.
await page.bringToFront();
return await page.evaluate(() => {
  if (window.hybridAcceptance?.phase === 'running') throw Error('Acceptance already running');
  const h = window.hybrid, frame = document.getElementById('preview');
  const report = window.hybridAcceptance = { phase: 'running', started: new Date().toISOString(), samples: [] };
  const path = '/workspace/src/WelcomeCard.tsx';
  const encode = text => btoa(unescape(encodeURIComponent(text)));
  const write = text => h.exec(`printf '%s' '${encode(text)}' | base64 -d > /workspace/src/.hybrid-edit.tmp && mv /workspace/src/.hybrid-edit.tmp '${path}'`);
  const read = async () => (await h.exec(`base64 '${path}' | tr -d '\\n'`)).stdout.trim();
  const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const visible = (text, document) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 30000;
    const tick = () => {
      if (frame.contentDocument !== document) return reject(Error('Preview Document replaced'));
      const h1 = document.querySelector('h1');
      if (h1?.textContent === text && h1.getBoundingClientRect().height) return resolve(performance.now());
      if (performance.now() > deadline) return reject(Error('HMR visibility timeout: ' + text));
      requestAnimationFrame(tick);
    }; tick();
  });
  void (async () => {
    const originalBase64 = await read(), original = decodeURIComponent(escape(atob(originalBase64)));
    const heading = original.match(/<h1>([^<]+)<\/h1>/)?.[1];
    if (!heading) throw Error('Plain fixture heading required');
    const document = frame.contentDocument, origin = frame.contentWindow.performance.timeOrigin;
    document.__hybridSentinel = crypto.randomUUID();
    report.documentSentinel = document.__hybridSentinel;
    report.originalSha256 = await hash(new TextEncoder().encode(original));
    try {
      await visible(heading, document);
      for (let i = 0; i < 5; i++) {
        await delay(250);
        const text = `Linux hybrid warm edit ${i + 1}`;
        const edited = original.replace(`<h1>${heading}</h1>`, `<h1>${text}</h1>`);
        const start = performance.now();
        await write(edited);
        const saved = performance.now();
        const receipt = await h.sync();
        const synced = performance.now();
        const painted = await visible(text, document);
        const guest = await read(), worker = await h.vm.fs.readFile(path);
        const workerBase64 = btoa(String.fromCharCode(...worker));
        if (guest !== encode(edited) || workerBase64 !== guest) throw Error('Exact guest/worker bytes differ');
        if (frame.contentWindow.performance.timeOrigin !== origin) throw Error('Preview time origin changed');
        report.samples.push({ index: i + 1, totalMs: painted - start, linuxSaveMs: saved - start,
          syncMs: synced - saved, postSyncVisibleMs: painted - synced, receipt,
          sha256: await hash(worker), exactBytes: true, sameDocument: true, timeOrigin: origin });
        await delay(250);
        await write(original); await h.sync(); await visible(heading, document);
        if (await read() !== originalBase64 || btoa(String.fromCharCode(...await h.vm.fs.readFile(path))) !== originalBase64)
          throw Error('Restoration byte mismatch');
      }
      report.phase = 'complete';
    } finally {
      await write(original); await h.sync();
      await visible(heading, document);
      report.restored = await read() === originalBase64 && btoa(String.fromCharCode(...await h.vm.fs.readFile(path))) === originalBase64;
    }
  })().catch(error => { report.phase = 'failed'; report.error = String(error); });
  return report;
});
