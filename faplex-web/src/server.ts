// faplex-web: a phone-first web UI over the faplex CLI. Everything it knows comes from faplex:
//   faplex watch --json   the session list (one JSON line per change), and the Unix socket that
//                         opens a session through a client watch keeps
//   faplex tail / send    last messages, and a reply typed at a session's prompt
//   faplex new            starting a session
// Nothing here talks to a harness directly.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalAuth } from "../../bun-web-terminal/src/auth.ts";
import { loadCredentials } from "../../bun-web-terminal/src/credentials.ts";
import { loadGhosttyTheme } from "../../bun-web-terminal/src/ghostty-theme.ts";
import { createWatch } from "./watch.ts";
import { parseTail } from "./tail.ts";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 14797);
// Sign-in uses the web terminal's access key (same trust: both run anything as you), so one
// saved key works for both. Its sign-in cookies are per origin, so each still signs in once.
const credentialPort = Number(process.env.CREDENTIAL_PORT ?? 14790);
const publicUrl = process.env.PUBLIC_URL;
const faplex = process.env.FAPLEX_BIN ?? "faplex";
const faplexCwd = process.env.FAPLEX_CWD ?? homedir();
const dist = join(import.meta.dir, "..", "dist");

const auth = new TerminalAuth(port, publicUrl, await loadCredentials(credentialPort));
const theme = loadGhosttyTheme();
await buildClient();

type Live = { kind: "live" };
type Term = { kind: "term"; key: string; cols: number; rows: number; socket?: Socket; pending: Uint8Array[] };
type Data = Live | Term;

const watch = createWatch(faplex, faplexCwd, (line) => server.publish("state", line));

const server = Bun.serve<Data>({
  hostname: host,
  port,
  idleTimeout: 120,
  async fetch(request, server) {
    const denied = await auth.guard(request, server.requestIP(request)?.address);
    if (denied) return denied;
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/live") return server.upgrade(request, { data: { kind: "live" } }) ? undefined : new Response("Upgrade failed", { status: 400 });
    if (path === "/api/term") {
      const key = url.searchParams.get("key") ?? "";
      const cols = clamp(Number(url.searchParams.get("cols")), 20, 400, 80);
      const rows = clamp(Number(url.searchParams.get("rows")), 5, 200, 24);
      if (!watch.socket()) return new Response("faplex watch is not running", { status: 503 });
      return server.upgrade(request, { data: { kind: "term", key, cols, rows, pending: [] } }) ? undefined : new Response("Upgrade failed", { status: 400 });
    }
    if (path === "/api/theme") return Response.json(theme);
    if (path === "/api/tail" && request.method === "GET") return tail(url.searchParams.get("key") ?? "", Number(url.searchParams.get("n") ?? 2));
    if (path === "/api/send" && request.method === "POST") return send(await request.json());
    if (path === "/api/new" && request.method === "POST") return newSession(await request.json());
    if (path === "/api/attach" && request.method === "POST") return attach(request, url.searchParams.get("key") ?? "");
    if (path === "/api/log" && request.method === "POST") {
      console.log("client:", (await request.text()).slice(0, 1000));
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("/api/")) return new Response("Not found", { status: 404 });

    // Static build output; every other path is the app (client-side routes).
    if (path !== "/" && !path.includes("..")) {
      const file = Bun.file(join(dist, path));
      if (await file.exists()) return new Response(file, { headers: { "cache-control": path.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable" } });
    }
    return new Response(Bun.file(join(dist, "index.html")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  },
  websocket: {
    perMessageDeflate: true,
    open(ws) {
      if (ws.data.kind === "live") {
        ws.subscribe("state");
        const last = watch.last();
        if (last) ws.send(last);
        return;
      }
      const t = ws.data;
      const socket = connect(watch.socket()!);
      t.socket = socket;
      socket.on("connect", () => {
        socket.write(JSON.stringify({ key: t.key, cols: t.cols, rows: t.rows }) + "\n");
        for (const d of t.pending) socket.write(d);
        t.pending = [];
      });
      socket.on("data", (d: Buffer) => ws.sendBinary(d));
      // faplex ends the connection when the session is left (ctrl+], ← at an empty prompt, or
      // another screen opened it).
      socket.on("end", () => ws.close(4000, "left"));
      socket.on("error", (e) => ws.close(4001, e.message.slice(0, 100)));
    },
    message(ws, message) {
      if (ws.data.kind === "live") {
        // {"warm": key}: attach a client ahead of opening, so opening is a repaint.
        try {
          const msg = JSON.parse(String(message));
          if (typeof msg.warm === "string") watch.write({ warm: msg.warm });
        } catch {}
        return;
      }
      const t = ws.data;
      if (typeof message === "string") {
        try {
          const msg = JSON.parse(message);
          if (msg.resize) {
            t.cols = clamp(msg.resize.cols, 20, 400, t.cols);
            t.rows = clamp(msg.resize.rows, 5, 200, t.rows);
            watch.write({ size: { cols: t.cols, rows: t.rows } });
          }
        } catch {}
        return;
      }
      const bytes = new Uint8Array(message);
      if (t.socket?.readyState === "open") t.socket.write(bytes);
      else t.pending.push(bytes);
    },
    close(ws) {
      // The client faplex keeps stays, hidden; the agent is untouched.
      if (ws.data.kind === "term") ws.data.socket?.end();
    },
  },
});

console.log(`faplex-web: http://${host}:${port}/${publicUrl ? ` · ${publicUrl}` : ""}`);

const shutdown = () => {
  watch.stop();
  process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

// ---- one-shot faplex commands ----

async function run(args: string[], stdin?: string, timeoutMs = 60_000) {
  const proc = Bun.spawn([faplex, ...args], { cwd: faplexCwd, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err: err.replace(/^faplex: /, "").trim(), code };
}

const isKey = (key: unknown): key is string => typeof key === "string" && /^[^/\s]+\/[a-z-]+:[\w.-]+$/.test(key);

// Tails are cached per session until it changes, and run a few at a time.
const tails = new Map<string, { updatedAt: number; body: unknown }>();
let tailsRunning = 0;
const tailQueue: (() => void)[] = [];
async function tail(key: string, n: number) {
  if (!isKey(key)) return new Response("Bad key", { status: 400 });
  const count = clamp(n, 1, 20, 2);
  const updatedAt = watch.session(key)?.updatedAt ?? 0;
  const cacheKey = `${key}#${count}`;
  const hit = tails.get(cacheKey);
  if (hit && hit.updatedAt === updatedAt) return Response.json(hit.body);
  if (tailsRunning >= 3) await new Promise<void>((resolve) => tailQueue.push(resolve));
  tailsRunning++;
  try {
    const { out, err, code } = await run(["tail", key, "-n", String(count)], undefined, 20_000);
    const body = code === 0 ? { messages: parseTail(out) } : { messages: [], error: err || `tail exited ${code}` };
    if (code === 0) tails.set(cacheKey, { updatedAt, body });
    return Response.json(body);
  } finally {
    tailsRunning--;
    tailQueue.shift()?.();
  }
}

async function send(body: { key?: unknown; text?: unknown }) {
  if (!isKey(body.key) || typeof body.text !== "string" || !body.text.trim()) return new Response("Bad request", { status: 400 });
  const { err, code } = await run(["send", body.key], body.text);
  return code === 0 ? Response.json({ ok: true }) : Response.json({ ok: false, error: err || `send exited ${code}` }, { status: 409 });
}

async function newSession(body: { machine?: unknown; harness?: unknown; dir?: unknown; prompt?: unknown }) {
  if (typeof body.machine !== "string" || typeof body.harness !== "string") return new Response("Bad request", { status: 400 });
  const args = ["new", "--machine", body.machine, "--harness", body.harness, "--background"];
  if (typeof body.dir === "string" && body.dir.trim()) args.push("--dir", body.dir.trim());
  if (typeof body.prompt === "string" && body.prompt.trim()) args.push("--prompt", body.prompt.trim());
  const { out, err, code } = await run(args, undefined, 60_000);
  if (code === 0) return Response.json({ ok: true, key: out.trim().split("\n").at(-1) });
  if (code === 3) return Response.json({ ok: false, error: "That folder's trust prompt needs answering: start this one from faplex in a terminal once." }, { status: 409 });
  return Response.json({ ok: false, error: err || `new exited ${code}` }, { status: 409 });
}

// A file pasted on the phone: saved on the session's machine, and its path is typed at the prompt
// (how a harness takes an image). Remote machines get it over ssh, under /tmp/faplex-web.
async function attach(request: Request, key: string) {
  if (!isKey(key)) return new Response("Bad key", { status: 400 });
  const name = (decodeURIComponent(request.headers.get("x-filename") ?? "") || "pasted")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(-80);
  const file = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}-${name}`;
  const bytes = new Uint8Array(await request.arrayBuffer());
  const ssh = sshAlias(key.slice(0, key.indexOf("/")));
  if (!ssh) {
    const dir = join(tmpdir(), "faplex-web");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, file);
    await Bun.write(path, bytes);
    await chmod(path, 0o600);
    return Response.json({ path });
  }
  const dir = "/tmp/faplex-web";
  const proc = Bun.spawn(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", ssh, `mkdir -p -m 700 ${dir} && umask 077 && cat > ${dir}/${file}`], {
    stdin: new Blob([bytes]),
    stdout: "ignore",
    stderr: "pipe",
    timeout: 300_000,
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) return new Response(`copy to ${ssh} failed: ${err.trim() || `ssh exited ${code}`}`, { status: 502 });
  return Response.json({ path: `${dir}/${file}` });
}

/** The ssh host of a machine in faplex's config; undefined for this machine. */
function sshAlias(machineId: string): string | undefined {
  const dir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  try {
    const config = JSON.parse(readFileSync(join(dir, "faplex", "config.json"), "utf8")) as { machines?: { id?: string; ssh?: string }[] };
    return config.machines?.find((m) => m.ssh && (m.id ?? m.ssh) === machineId)?.ssh;
  } catch {
    return undefined;
  }
}

// ---- helpers ----

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

async function buildClient() {
  await rm(dist, { recursive: true, force: true });
  const tailwind = (await import("bun-plugin-tailwind")).default;
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "index.html")],
    outdir: dist,
    target: "browser",
    // Absolute, so /s/<key> loaded directly finds its assets.
    publicPath: "/",
    minify: true,
    sourcemap: "linked",
    plugins: [tailwind],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "Client build failed");
  const wasm = import.meta.resolve("@random/ghostty-web/ghostty-vt.wasm");
  await Bun.write(join(dist, "ghostty-vt.wasm"), Bun.file(new URL(wasm)));
  await cp(join(import.meta.dir, "..", "public"), dist, { recursive: true });
  // Root-relative links the HTML bundler would try to resolve, added after it.
  const index = join(dist, "index.html");
  const links = `<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
  await Bun.write(index, (await Bun.file(index).text()).replace("</head>", `${links}</head>`));
}
