// JSON-line transport over ttyS0. Vite execution stays in the guest.
const sockets = new Map<string, WebSocket>();
const send = (message: object) => process.stdout.write(`\x1e${JSON.stringify(message)}\n`);
const origin = "http://127.0.0.1:5173";
async function handle(message: any) {
  const { id, type } = message;
  try {
    if (type === "http") {
      const url = new URL(message.path, origin);
      if (url.origin !== origin) throw new Error("Only guest-loopback Vite is available");
      const response = await fetch(url, {
        method: message.method, headers: { accept: message.accept || "*/*" },
        redirect: "manual", signal: AbortSignal.timeout(240_000),
      });
      const body = Buffer.from(Bun.gzipSync(new Uint8Array(await response.arrayBuffer()))).toString("base64");
      send({ id, type, status: response.status, headers: [...response.headers].filter(([key]) =>
        !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)), body });
    } else if (type === "ws-open") {
      const url = new URL(message.path, "ws://127.0.0.1:5173");
      if (url.origin !== "ws://127.0.0.1:5173") throw new Error("Invalid WebSocket destination");
      const socket = new WebSocket(url, message.protocols);
      sockets.set(id, socket);
      socket.onopen = () => send({ id, type: "ws-open", protocol: socket.protocol });
      socket.onmessage = (event) => send({ id, type: "ws-message", data: event.data });
      socket.onerror = () => send({ id, type: "ws-error", error: "Guest WebSocket failed" });
      socket.onclose = (event) => {
        sockets.delete(id); send({ id, type: "ws-close", code: event.code, reason: event.reason });
      };
    } else if (type === "ws-send") {
      sockets.get(id)?.send(message.data);
    } else if (type === "ws-close") {
      sockets.get(id)?.close(message.code, message.reason);
    } else if (type === "exec") {
      const child = Bun.spawn(["sh", "-c", message.command], { cwd: "/workspace", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      send({ id, type, stdout, stderr, code });
    } else if (type === "stop") {
      process.exit(0);
    }
  } catch (error) { send({ id, type: "error", error: String(error) }); }
}
send({ type: "ready" });
let input = "";
for await (const chunk of Bun.stdin.stream()) {
  input += new TextDecoder().decode(chunk);
  let end;
  while ((end = input.indexOf("\n")) !== -1) {
    const line = input.slice(0, end); input = input.slice(end + 1);
    try { void handle(JSON.parse(line)); } catch { /* Ignore terminal noise. */ }
  }
}
