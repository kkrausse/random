// Install on a connected VM. The baseline keyboard hook cannot see protocol
// writes after serial-bridge binds its private writer; observe request boundaries.
return await page.frames()[1].evaluate(() => {
  const bridge = window.guestBridge;
  if (!bridge) throw new Error('Connect preview first');
  if (bridge.perfObserved === 2) return 'already installed';
  const samples = [];
  bridge.profile = { samples };
  const record = (request, response, startedAt, start) => {
    samples.push({ type: request.type, path: request.path, startedAt,
      roundTripMs: performance.now() - start, status: response.status,
      wireBytes: new TextEncoder().encode(JSON.stringify(response)).length + 2,
      guest: response.timing, error: response.error });
    if (samples.length > 200) samples.shift();
  };
  const original = bridge.request.bind(bridge);
  bridge.request = async (request) => {
    const startedAt = Date.now(), start = performance.now();
    const response = await original(request);
    record(request, response, startedAt, start);
    return response;
  };
  // HTTP requests in the preview use a closed-over request function. Observe
  // incoming serial responses independently; retain IDs and receive timestamps,
  // rather than guessing path correspondence under concurrent requests.
  const slave = window.Module.pty;
  const write = slave.write.bind(slave);
  const decoder = new TextDecoder();
  let buffer = '';
  bridge.perfResponses = [];
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
        if (response.type === 'http') {
          bridge.perfResponses.push({ id: response.id, receivedAt: Date.now(),
            status: response.status, wireBytes: new TextEncoder().encode(buffer.slice(0, end + 1)).length,
            guest: response.timing, error: response.error });
          if (bridge.perfResponses.length > 200) bridge.perfResponses.shift();
        }
      } catch { /* Baseline bridge owns protocol errors. */ }
      buffer = buffer.slice(end + 1);
    }
    return write(data);
  };
  bridge.perfObserved = 2;
  return 'direct-request and serial-response timing observers installed';
});
