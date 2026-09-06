window.installSerialBridge = function installSerialBridge(slave, runtime = window) {
  const parent = runtime.parent;
  if (runtime.guestBridge) return runtime.guestBridge;
  const pending = new Map(); const sockets = new Map();
  const stats = { http: 0, wsMessages: 0, errors: 0, updates: [] };
  let sequence = 0; let buffer = ""; let ready = false; let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  const originalWrite = slave.write.bind(slave);
  const decoder = new TextDecoder();
  // Keep protocol writes separate from keyboard input once the bridge owns ttyS0.
  const write = slave.ldisc.writeFromLower.bind(slave.ldisc);
  const send = (message) => write(JSON.stringify(message) + "\n");
  slave.write = (data) => {
    buffer += typeof data === "string" ? data : decoder.decode(Uint8Array.from(data), { stream: true });
    while (buffer.length) {
      const start = buffer.indexOf("\x1e");
      if (start === -1) { originalWrite(buffer); buffer = ""; break; }
      if (start > 0) { originalWrite(buffer.slice(0, start)); buffer = buffer.slice(start); }
      const end = buffer.indexOf("\n"); if (end === -1) break;
      const line = buffer.slice(1, end); buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === "ready") {
          ready = true;
          slave.ldisc.writeFromLower = (data) => send({ type: "terminal-input", data: typeof data === "string" ? data : new TextDecoder().decode(Uint8Array.from(data)) });
          originalWrite("\r\nPreview bridge connected. Opening an interactive shell in /workspace…\r\n");
          const size = slave.ioctl?.("TIOCGWINSZ") || [30, 100];
          send({ type: "terminal-open", rows: size[0], cols: size[1] });
          resolveReady();
        } else if (message.type === "terminal-data") {
          originalWrite(Array.from(atob(message.data), (char) => char.charCodeAt(0)));
        } else if (message.type === "terminal-exit") {
          originalWrite(`\r\nShell exited (${message.code}). Press Enter to open a new shell; preview remains connected.\r\n`);
        } else if (message.type === "terminal-error") {
          originalWrite(`\r\nShell error: ${message.error}\r\n`);
        } else if (sockets.has(message.id)) {
          if (message.type === "ws-message") {
            stats.wsMessages++;
            try {
              const payload = JSON.parse(message.data);
              if (payload.type === "update") {
                stats.updates.push({ receivedAt: Date.now(), updates: payload.updates });
                if (stats.updates.length > 20) stats.updates.shift();
              }
            } catch { /* Non-JSON application messages are still forwarded. */ }
          }
          sockets.get(message.id).postMessage(message);
          if (message.type === "ws-close") { sockets.get(message.id).close(); sockets.delete(message.id); }
        } else if (pending.has(message.id)) {
          pending.get(message.id)(message); pending.delete(message.id);
        }
      } catch { stats.errors++; }
    }
  };
  const request = (message) => new Promise((resolve) => {
    const id = String(++sequence);
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: "Guest bridge timeout" }); }, 290_000);
    pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    if (message.type === "http") stats.http++;
    send({ ...message, id });
  });
  runtime.addEventListener("message", async (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.source !== "preview-bridge") return;
    const port = event.ports[0]; const message = event.data.request;
    if (!ready) { port.postMessage({ error: "Connect the guest bridge first" }); port.close(); return; }
    if (message.type === "ws-open") {
      const id = String(++sequence); sockets.set(id, port);
      port.onmessage = ({ data }) => send({ ...data, id }); send({ ...message, id });
    } else { port.postMessage(await request(message)); port.close(); }
  });
  runtime.guestBridge = {
    stats, request,
    resizeTerminal(cols, rows) { if (ready) send({ type: "terminal-resize", cols, rows }); },
    async connect(source) {
      if (ready) return;
      const encoded = btoa(unescape(encodeURIComponent(source)));
      write("stty -echo; : > /tmp/preview-bridge.b64\r");
      for (let offset = 0; offset < encoded.length; offset += 160) {
        write(`printf '%s' '${encoded.slice(offset, offset + 160)}' >> /tmp/preview-bridge.b64\r`);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      write("base64 -d /tmp/preview-bridge.b64 > /tmp/preview-bridge.ts; stty raw -echo; BUN_JSC_useFTLJIT=false NO_PROXY=127.0.0.1,localhost bun /tmp/preview-bridge.ts; stty sane\r");
      await Promise.race([readyPromise, new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Guest bridge did not start within 120 seconds; inspect the serial console")), 120_000);
      })]);
    },
  };
  return runtime.guestBridge;
}
