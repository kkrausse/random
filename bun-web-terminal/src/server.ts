import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dimensions, SessionManager, type Attachment, type Session } from "./sessions";

type SocketData = { sessionId: string; cols: number; rows: number; attachment?: Attachment };

const host = process.env.HOST ?? "127.0.0.1";
const port = parsePort(process.env.PORT ?? "3000");
const attachmentLimit = 20 * 1024 * 1024;
const dist = process.env.TERMINAL_DIST ?? join(import.meta.dir, "..", "dist");
const defaultTerminalCwd = join(import.meta.dir, "..", "..");
const attachmentRoot = join(tmpdir(), "bun-web-terminal");

if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost" && host !== "0.0.0.0") {
  throw new Error("HOST must be a loopback address or 0.0.0.0.");
}
if (host === "0.0.0.0") {
  console.warn("WARNING: The web terminal is available to the network without authentication and provides direct shell access.");
}

await buildClient();
const theme = loadGhosttyTheme();
const manager = new SessionManager(process.env.TERMINAL_CWD ?? defaultTerminalCwd);
const sessions = manager.sessions;
process.once("exit", () => manager.dispose());
process.once("SIGTERM", () => process.exit(0));
process.once("SIGINT", () => process.exit(0));

const server = Bun.serve<SocketData>({
  hostname: host,
  port,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/ws/")) {
      if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
      const sessionId = url.pathname.slice(4);
      const session = sessions.get(sessionId);
      if (!session) return new Response("Session not found", { status: 404 });
      const size = dimensions(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows")));
      if (!size) return new Response("Invalid terminal dimensions", { status: 400 });
      return server.upgrade(request, { data: { sessionId, ...size } }) ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/theme" && request.method === "GET") return Response.json(theme);
    if (url.pathname === "/api/sessions" && request.method === "GET") return Response.json([...sessions.values()].map(publicSession));
    if (url.pathname === "/api/sessions" && request.method === "POST") {
      if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
      const session = manager.create();
      return Response.json(publicSession(session), { status: 201 });
    }
    if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/attachments") && request.method === "POST") {
      if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
      const sessionId = url.pathname.slice(14, -12);
      const session = sessions.get(sessionId);
      if (!session) return new Response("Session not found", { status: 404 });
      return saveAttachment(request, session);
    }
    if (url.pathname.startsWith("/api/sessions/") && request.method === "DELETE") {
      if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
      const session = sessions.get(url.pathname.slice(14));
      if (!session) return new Response("Session not found", { status: 404 });
      manager.remove(session);
      void rm(join(attachmentRoot, session.id), { recursive: true, force: true });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/client.js") return serveFile(join(dist, "client.js"), "text/javascript; charset=utf-8");
    if (url.pathname === "/styles.css") return serveFile(join(import.meta.dir, "styles.css"), "text/css; charset=utf-8");
    if (url.pathname === "/favicon.svg") return new Response(terminalFavicon, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    if (url.pathname === "/ghostty-vt.wasm") return serveFile(join(dist, "ghostty-vt.wasm"), "application/wasm");
    if (url.pathname === "/" ) return Response.redirect(new URL("/sessions", url), 302);
    if (url.pathname === "/sessions/new" && request.method === "GET") {
      const session = manager.create();
      return Response.redirect(new URL(`/terminal/${session.id}`, url), 303);
    }
    if (url.pathname === "/sessions") return html(sessionsPage());
    if (url.pathname.startsWith("/terminal/")) {
      const session = sessions.get(url.pathname.slice(10));
      if (!session) return html(notFoundPage(), 404);
      return html(terminalPage(session));
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 1024 * 1024,
    backpressureLimit: 256 * 1024,
    closeOnBackpressureLimit: true,
    open(socket) {
      const session = sessions.get(socket.data.sessionId);
      if (!session) return socket.close(4004, "Session not found");
      socket.data.attachment = manager.attach(session, socket, socket.data.cols, socket.data.rows);
    },
    message(socket, message) {
      const attachment = socket.data.attachment;
      if (!attachment) return;
      if (typeof message !== "string") return attachment.input(message);
      try {
        const control = JSON.parse(message);
        if (control?.type === "ping") { socket.send('{"type":"pong"}'); return; }
        if (control?.type === "ack" && attachment.acknowledge(control.bytes)) return;
        if (control?.type === "resize") {
          const size = dimensions(control.cols, control.rows);
          if (size) { attachment.resize(size.cols, size.rows); return; }
        }
      } catch {}
      socket.close(1008, "Invalid terminal control message");
    },
    close(socket) {
      socket.data.attachment?.close();
    },
  },
});

console.log(`Web terminal: http://${host}:${server.port}/sessions`);

async function saveAttachment(request: Request, session: Session) {
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > attachmentLimit) {
    return new Response("Attachment exceeds 20 MiB", { status: 413 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > attachmentLimit) return new Response("Attachment exceeds 20 MiB", { status: 413 });
  const extension = imageExtension(bytes);
  if (!extension) return new Response("Only PNG, JPEG, GIF, and WebP images are supported", { status: 415 });

  const directory = join(attachmentRoot, session.id);
  const path = join(directory, `${crypto.randomUUID()}.${extension}`);
  await mkdir(directory, { recursive: true });
  await Bun.write(path, bytes);
  return Response.json({ path });
}

function imageExtension(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}

function publicSession(session: Session) {
  return {
    id: session.id,
    name: session.name,
    title: session.title,
    status: session.status,
    clients: session.attachment ? 1 : 0,
    createdAt: session.createdAt.toISOString(),
    exitCode: session.exitCode,
  };
}

async function buildClient() {
  await mkdir(dist, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "client.ts")],
    outdir: dist,
    target: "browser",
    naming: "client.js",
    minify: process.env.NODE_ENV === "production",
    sourcemap: process.env.NODE_ENV === "production" ? "none" : "inline",
  });
  if (!result.success) throw new AggregateError(result.logs, "Client build failed");
  const wasmUrl = import.meta.resolve("ghostty-web/ghostty-vt.wasm");
  await Bun.write(join(dist, "ghostty-vt.wasm"), Bun.file(new URL(wasmUrl)));
}

function loadGhosttyTheme() {
  const fallback = { background: "#282c34", foreground: "#ffffff" };
  const browserFont = process.env.TERMINAL_FONT ?? "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
  const scrollSensitivity = parseScrollSensitivity(process.env.TERMINAL_SCROLL_SENSITIVITY);
  const defaults = Bun.spawnSync(["ghostty", "+show-config", "--default"], { stdout: "pipe", stderr: "ignore" });
  if (defaults.exitCode !== 0) return { terminal: fallback, fontFamily: browserFont, fontSize: 14, scrollSensitivity };
  const overrides = Bun.spawnSync(["ghostty", "+show-config"], { stdout: "pipe", stderr: "ignore" });

  const values = new Map<string, string[]>();
  const config = `${defaults.stdout.toString()}\n${overrides.exitCode === 0 ? overrides.stdout.toString() : ""}`;
  for (const line of config.split("\n")) {
    const match = line.match(/^([^#=]+?)\s*=\s*(.*)$/);
    if (match) values.set(match[1]!.trim(), [...(values.get(match[1]!.trim()) ?? []), match[2]!.trim()]);
  }
  const palette = new Map((values.get("palette") ?? []).map((entry) => entry.split("=", 2) as [string, string]));
  const colors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
  const terminal: Record<string, string> = {
    background: values.get("background")?.at(-1) || fallback.background,
    foreground: values.get("foreground")?.at(-1) || fallback.foreground,
  };
  colors.forEach((name, index) => {
    const normal = palette.get(String(index));
    const bright = palette.get(String(index + 8));
    if (normal) terminal[name] = normal;
    if (bright) terminal[`bright${name[0]!.toUpperCase()}${name.slice(1)}`] = bright;
  });
  const cursor = values.get("cursor-color")?.at(-1);
  const selection = values.get("selection-background")?.at(-1);
  if (cursor) terminal.cursor = cursor;
  if (selection) terminal.selectionBackground = selection;
  return {
    terminal,
    fontFamily: browserFont,
    fontSize: Number(values.get("font-size")?.at(-1)) || 14,
    scrollSensitivity,
  };
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const requestUrl = new URL(request.url);
  if (host !== "0.0.0.0") {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const forwardedHost = request.headers.get("x-forwarded-host");
    if ((forwardedProto === "http" || forwardedProto === "https") && forwardedHost) {
      try {
        return origin === new URL(`${forwardedProto}://${forwardedHost}`).origin;
      } catch {}
    }
  }

  return origin === requestUrl.origin;
}

function parsePort(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`Invalid PORT: ${value}`);
  return parsed;
}

function parseScrollSensitivity(value: string | undefined) {
  if (value === undefined || value === "") return 0.5;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 5) throw new Error(`Invalid TERMINAL_SCROLL_SENSITIVITY: ${value}`);
  return parsed;
}

function serveFile(path: string, type: string) {
  const file = Bun.file(path);
  return file.exists().then((exists) => exists
    ? new Response(file, { headers: { "content-type": type, "x-content-type-options": "nosniff" } })
    : new Response("Not found", { status: 404 }));
}

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" } });
}

function document(title: string, bodyClass: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link id="favicon" rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"></head><body class="${bodyClass}">${content}<script type="module" src="/client.js"></script></body></html>`;
}

function sessionsPage() {
  return document("Sessions", "sessions-page", `<main class="sessions-shell"><header class="sessions-header"><div><span class="eyebrow">localhost · bun pty</span><h1>Sessions</h1></div><a id="create-session" href="/sessions/new">+ New shell</a></header><section id="session-list" aria-live="polite"></section></main>`);
}

function terminalPage(session: Session) {
  return document(session.name, "terminal-page", `<main id="terminal" aria-label="${session.name}"></main><button id="connection-status" type="button" data-status="connecting" title="Refresh terminal connection" aria-live="polite">Connecting...</button>`);
}

function notFoundPage() {
  return document("Session not found", "sessions-page", `<main class="sessions-shell"><span class="eyebrow">404</span><h1>Session not found</h1><p><a href="/sessions">Back to sessions</a></p></main>`);
}

const terminalFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#282c34"/><text x="4.5" y="17.5" font-size="13" font-family="monospace" font-weight="600" fill="#b5bd68">$_</text></svg>`;
