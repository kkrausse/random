// JSON-line transport over ttyS0. Vite execution stays in the guest.
import { mkdirSync, readFileSync } from "node:fs";

const sockets = new Map<string, WebSocket>();
const send = (message: object) => process.stdout.write(`\x1e${JSON.stringify(message)}\n`);
const origin = "http://127.0.0.1:5173";
let shell: ReturnType<typeof Bun.spawn> | undefined;
let terminalSize = { cols: 100, rows: 30 };
function openShell(cols = terminalSize.cols, rows = terminalSize.rows) {
  if (shell) return;
  terminalSize = { cols, rows };
  // The minimal boot image mounts devtmpfs, but not the pseudo-terminal filesystem.
  if (!readFileSync("/proc/mounts", "utf8").split("\n").some((line) => line.split(" ")[1] === "/dev/pts")) {
    mkdirSync("/dev/pts", { recursive: true });
    const mounted = Bun.spawnSync(["mount", "-t", "devpts", "devpts", "/dev/pts"]);
    if (mounted.exitCode !== 0) throw new Error(`Could not mount /dev/pts: ${mounted.stderr.toString()}`);
  }
  const child = Bun.spawn(["sh", "-i"], {
    cwd: "/workspace", env: { ...process.env, TERM: "xterm-256color" },
    terminal: {
      cols, rows,
      data(_terminal, data) { send({ type: "terminal-data", data: Buffer.from(data).toString("base64") }); },
    },
  });
  shell = child;
  void child.exited.then((code) => {
    child.terminal?.close();
    shell = undefined;
    send({ type: "terminal-exit", code });
  });
}
async function handle(message: any) {
  const { id, type } = message;
  try {
    if (type === "terminal-open") {
      openShell(message.cols, message.rows);
    } else if (type === "terminal-input") {
      openShell();
      shell!.terminal!.write(message.data);
    } else if (type === "terminal-resize") {
      terminalSize = { cols: message.cols, rows: message.rows };
      shell?.terminal?.resize(message.cols, message.rows);
    } else if (type === "http") {
      const started = performance.now();
      const url = new URL(message.path, origin);
      if (url.origin !== origin) throw new Error("Only guest-loopback Vite is available");
      const response = await fetch(url, {
        method: message.method, headers: { accept: message.accept || "*/*" },
        redirect: "manual", signal: AbortSignal.timeout(240_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const fetched = performance.now();
      const body = Buffer.from(Bun.gzipSync(bytes)).toString("base64");
      const timing = { fetchMs: fetched - started, gzipMs: performance.now() - fetched, bytes: bytes.length };
      send({ id, type, status: response.status, headers: [...response.headers].filter(([key]) =>
        !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)), body, timing });
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
  } catch (error) { send({ id, type: type.startsWith("terminal-") ? "terminal-error" : "error", error: String(error) }); }
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
