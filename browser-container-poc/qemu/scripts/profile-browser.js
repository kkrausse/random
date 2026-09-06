// Executed by browser-control; configuration is supplied by profile.ts.
if (state.profileConfig.mode === 'reload') {
  await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="Guest application preview"]');
    if (!frame || !document.querySelector('iframe[title="QEMU serial console"]')?.contentWindow?.guestBridge) {
      throw new Error('Connect the fixture preview first');
    }
    window.__profileReload = { previous: frame.contentDocument, startedAt: Date.now(), start: performance.now() };
  });
  await page.getByRole('button', { name: 'Reload preview', exact: true }).click();
  try {
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe[title="Guest application preview"]');
      const ready = frame?.contentDocument !== window.__profileReload.previous && frame?.contentDocument?.querySelector('h1');
      if (ready) window.__profileReload.visibleMs = performance.now() - window.__profileReload.start;
      return !!ready;
    }, null, { timeout: 90_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      bridge: document.querySelector('iframe[title="QEMU serial console"]')?.contentWindow?.guestBridge?.stats,
      resources: document.querySelector('iframe[title="Guest application preview"]')?.contentWindow?.performance
        .getEntriesByType('resource').map(({ name, duration }) => ({ name, duration })),
    }));
    throw new Error(`${error}\n${JSON.stringify(diagnostic)}`);
  }
  return await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="Guest application preview"]');
    const bridge = document.querySelector('iframe[title="QEMU serial console"]').contentWindow.guestBridge;
    const measurement = window.__profileReload;
    delete window.__profileReload;
    return { mode: 'reload', visibleMs: measurement.visibleMs,
      transport: bridge.profile?.samples.filter((sample) => sample.startedAt >= measurement.startedAt) ?? [],
      resources: frame.contentWindow.performance.getEntriesByType('resource').map(({ name, duration }) => ({ name, duration })) };
  });
}
return await page.evaluate(async (config) => {
  const runtime = document.querySelector('iframe[title="QEMU serial console"]')?.contentWindow;
  const preview = document.querySelector('iframe[title="Guest application preview"]');
  const bridge = runtime?.guestBridge;
  if (!bridge || !preview?.contentWindow?.document.querySelector('h1')) {
    throw new Error('Start the VM, connect preview, and wait for the fixture heading before profiling.');
  }
  // Observe the existing transport in place, preserving the running VM and its cache.
  if (!bridge.profile) {
    const pending = new Map();
    const samples = [];
    const slave = runtime.Module.pty;
    const write = slave.write.bind(slave);
    const input = slave.ldisc.writeFromLower.bind(slave.ldisc);
    const decoder = new TextDecoder();
    let buffer = '';
    slave.ldisc.writeFromLower = (text) => {
      try {
        const request = JSON.parse(text);
        if (request.id && ['http', 'exec'].includes(request.type)) {
          pending.set(request.id, { type: request.type, path: request.path, startedAt: Date.now() });
          if (pending.size > 200) pending.delete(pending.keys().next().value);
        }
      } catch { /* Shell input is not a bridge request. */ }
      return input(text);
    };
    slave.write = (data) => {
      buffer += typeof data === 'string' ? data : decoder.decode(Uint8Array.from(data), { stream: true });
      while (buffer.length) {
        const start = buffer.indexOf('\x1e');
        if (start < 0) { buffer = ''; break; }
        buffer = buffer.slice(start);
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        try {
          const response = JSON.parse(buffer.slice(1, end));
          const request = pending.get(response.id);
          if (request) {
            samples.push({ ...request, roundTripMs: Date.now() - request.startedAt,
              wireBytes: end + 1, status: response.status, error: response.error, guest: response.timing });
            pending.delete(response.id);
            if (samples.length > 200) samples.shift();
          }
        } catch { /* The bridge handles protocol errors. */ }
        buffer = buffer.slice(end + 1);
      }
      return write(data);
    };
    bridge.profile = { samples };
  }
  const exec = async (command) => {
    const result = await bridge.request({ type: 'exec', command });
    if (result.error || result.code !== 0) throw new Error(result.error || result.stderr);
    return result.stdout;
  };
  const waitFor = async (predicate) => {
    const deadline = performance.now() + 90_000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Preview did not settle within 90 seconds');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  if (config.mode === 'http') {
    const path = '/src/WelcomeCard.tsx';
    const loopback = await exec(`curl --noproxy '*' -fsS -o /dev/null -w '%{time_total} %{size_download}' http://127.0.0.1:5173${path}`);
    const start = performance.now();
    const response = await bridge.request({ type: 'http', path, method: 'GET' });
    const roundTripMs = performance.now() - start;
    if (response.error || response.status !== 200) throw new Error(response.error || `HTTP ${response.status}`);
    return { mode: 'http', roundTripMs, loopbackSecondsAndBytes: loopback,
      base64Bytes: response.body.length, guest: response.timing };
  }
  const file = 'src/WelcomeCard.tsx';
  const original = await exec(`cat ${file}`);
  if (!/<h1>[^<]*<\/h1>/.test(original)) throw new Error('Expected fixture with a plain-text h1');
  const token = `Profile ${Date.now()}`;
  const encode = (text) => btoa(unescape(encodeURIComponent(text)));
  const write = (text) => exec(`printf '%s' '${encode(text)}' | base64 -d > ${file}`);
  const documentBefore = preview.contentDocument;
  const win = preview.contentWindow;
  win.performance.clearResourceTimings();
  const startEpoch = Date.now();
  const start = performance.now();
  let commandMs;
  try {
    const command = write(original.replace(/<h1>[^<]*<\/h1>/, `<h1>${token}</h1>`))
      .then(() => { commandMs = performance.now() - start; });
    await Promise.all([command, waitFor(() => preview.contentDocument?.querySelector('h1')?.textContent === token)]);
    const visibleMs = performance.now() - start;
    if (preview.contentDocument !== documentBefore) throw new Error('Full document reload instead of HMR');
    const update = bridge.stats.updates.find((entry) => entry.receivedAt >= startEpoch);
    const resources = win.performance.getEntriesByType('resource').map(({ name, startTime, duration }) => ({
      name, startMs: win.performance.timeOrigin + startTime - startEpoch, duration,
    }));
    return { mode: 'edit', commandMs, notificationMs: update ? update.receivedAt - startEpoch : null,
      visibleMs, documentPreserved: true, resources,
      transport: bridge.profile.samples.filter((sample) => sample.startedAt >= startEpoch) };
  } finally {
    await write(original);
    const heading = original.match(/<h1>([^<]*)<\/h1>/)[1];
    await waitFor(() => preview.contentDocument?.querySelector('h1')?.textContent === heading);
  }
}, state.profileConfig);
