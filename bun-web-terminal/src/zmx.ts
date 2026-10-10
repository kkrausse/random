import { connect } from "node:net";
import { existsSync } from "node:fs";
import { readlink } from "node:fs/promises";
import { basename, join } from "node:path";

// zmx keeps one small daemon per session. The CLI covers everything that is not
// on the typing path; an attachment speaks the daemon's socket protocol itself.

export type ZmxSession = {
  name: string;
  pid: number;
  clients: number;
  createdAt: Date;
  cwd: string;
  labels: Record<string, string>;
};

export type Zmx = ReturnType<typeof zmxAt>;

export async function openZmx(dir?: string) {
  const env = zmxEnv(dir);
  if (!Bun.which("zmx", { PATH: env.PATH ?? "" })) {
    throw new Error("zmx is required on PATH (https://zmx.sh; e.g. install the release binary as ~/.local/bin/zmx).");
  }
  const version = await run(["zmx", "version"], env);
  const socketDir = version.stdout.match(/^socket_dir\t(.+)$/m)?.[1];
  if (version.code !== 0 || !socketDir) throw new Error(`Could not read the zmx socket directory: ${version.stderr.trim() || version.stdout.trim()}`);
  return zmxAt(socketDir, env);
}

function zmxEnv(dir?: string): Record<string, string | undefined> {
  // ZMX_SESSION would turn an attach into "switch the session I am inside".
  return { ...process.env, ...(dir ? { ZMX_DIR: dir } : {}), ZMX_SESSION: undefined, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

function zmxAt(socketDir: string, env: Record<string, string | undefined>) {
  const socketPath = (name: string) => join(socketDir, name);
  return {
    socketDir,
    socketPath,

    async list(): Promise<ZmxSession[] | undefined> {
      const result = await run(["zmx", "list"], env);
      if (result.code !== 0 && !/no sessions found/.test(result.stderr)) return undefined;
      const sessions: ZmxSession[] = [];
      for (const line of result.stdout.split("\n")) {
        const fields = new Map<string, string>();
        for (const field of line.split("\t")) {
          // The first field may carry a marker for the caller's own session.
          const match = field.match(/([A-Za-z0-9_.-]+)=(.*)$/);
          if (match) fields.set(match[1]!, match[2]!);
        }
        const name = fields.get("name");
        // A daemon too busy to answer is reported with err=; it is still there.
        if (!name || (fields.has("err") && fields.get("status") !== "unreachable")) continue;
        const labels: Record<string, string> = {};
        for (const [key, value] of fields) {
          if (!["name", "pid", "clients", "created", "cwd", "cmd", "ended", "exit_code", "err", "status"].includes(key)) labels[key] = value;
        }
        sessions.push({
          name, labels,
          pid: Number(fields.get("pid")) || 0,
          clients: Number(fields.get("clients")) || 0,
          createdAt: new Date(Number(fields.get("created")) * 1000 || 0),
          cwd: filePath(fields.get("cwd") ?? ""),
        });
      }
      return sessions;
    },

    // The daemon is forked from a zmx client, which needs a terminal. Leave
    // once it has attached: only then does the daemon restore later clients.
    async create(name: string, cwd: string) {
      let attached = false;
      const client = Bun.spawn(["zmx", "attach", name], {
        cwd, env,
        terminal: { cols: 100, rows: 30, name: "xterm-256color", data() { attached = true; } },
      });
      try {
        for (let waited = 0; !(attached && existsSync(socketPath(name))); waited += 20) {
          if (waited > 5000 && existsSync(socketPath(name))) break;
          if (client.exitCode !== null || waited > 5000) throw new Error(`Could not create terminal ${name}`);
          await Bun.sleep(20);
        }
      } finally {
        client.kill();
        client.terminal?.close();
      }
    },

    async kill(name: string) {
      const result = await run(["zmx", "kill", name], env);
      if (result.code !== 0 && existsSync(socketPath(name))) throw new Error(result.stderr.trim() || `Could not remove terminal ${name}`);
    },

    async setLabel(name: string, key: string, value: string) {
      const result = await run(["zmx", "set", name, `${key}=${value}`], env);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Could not label terminal ${name}`);
    },

    attach(name: string, size: Size, handlers: LinkHandlers) { return attachSession(socketPath(name), size, handlers); },
  };
}

// What runs in the foreground of each session's terminal and where, by the
// shell's pid. zmx itself only knows a directory the shell reports (OSC 7).
export async function foreground(pids: number[]) {
  const column = async (format: string, ids: number[]) => {
    const rows = new Map<number, string>();
    if (ids.length === 0) return rows;
    const result = await run(["ps", "-o", format, "-p", ids.join(",")], process.env);
    for (const line of result.stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) rows.set(Number(match[1]), match[2]!.trim());
    }
    return rows;
  };
  const groups = await column("pid=,tpgid=", pids);
  const leaders = [...new Set([...groups.values()].map(Number).filter(pid => pid > 0))];
  const [names, directories] = await Promise.all([column("pid=,comm=", leaders), workingDirectories(leaders)]);
  const processes = new Map<number, { command: string; cwd?: string }>();
  for (const [pid, group] of groups) {
    // macOS reports the full path, and a login shell as "-zsh".
    processes.set(pid, { command: basename(names.get(Number(group)) ?? "").replace(/^-/, ""), cwd: directories.get(Number(group)) });
  }
  return processes;
}

async function workingDirectories(pids: number[]) {
  const directories = new Map<number, string>();
  if (process.platform === "linux") {
    await Promise.all(pids.map(async (pid) => {
      try { directories.set(pid, await readlink(`/proc/${pid}/cwd`)); } catch {}
    }));
  } else if (pids.length) {
    // -F prints a "p<pid>" line, then the fields asked for: "n<path>".
    let pid = 0;
    for (const line of (await run(["lsof", "-a", "-d", "cwd", "-Fn", "-p", pids.join(",")], process.env)).stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid) directories.set(pid, line.slice(1));
    }
  }
  return directories;
}

// Label values may only hold letters, digits, "-", "." and "_"; "_" escapes the rest.
export function encodeLabel(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => {
    const character = String.fromCharCode(byte);
    return /[A-Za-z0-9.-]/.test(character) ? character : `_${byte.toString(16).padStart(2, "0")}`;
  }).join("");
}

export function decodeLabel(value: string) {
  try { return decodeURIComponent(value.replace(/_([0-9a-f]{2})/gi, "%$1")); }
  catch { return value; }
}

function filePath(url: string) {
  try { return decodeURIComponent(new URL(url).pathname); }
  catch { return url; }
}

async function run(command: string[], env: Record<string, string | undefined>) {
  try {
    const child = Bun.spawn(command, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  } catch (error) {
    return { code: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

type Size = { cols: number; rows: number };
type LinkHandlers = {
  /** The daemon's copy of the screen and scrollback, sized for this client; empty when it has none. */
  restore(snapshot: Uint8Array): void;
  output(data: Uint8Array): void;
  close(): void;
};
export type ZmxLink = { input(data: Uint8Array): void; resize(cols: number, rows: number): void; close(): void };

// zmx's wire protocol (src/ipc.zig, frozen upstream): an 8-byte header of a tag
// byte and a little-endian u32 payload length, then the payload.
const Tag = { Input: 0, Output: 1, Resize: 2, Init: 7, LabelGet: 14, LabelData: 17 } as const;

function frame(tag: number, payload: Uint8Array = new Uint8Array()) {
  const out = Buffer.alloc(8 + payload.byteLength);
  out[0] = tag;
  out.writeUInt32LE(payload.byteLength, 1);
  out.set(payload, 8);
  return out;
}

function sizeFrame(tag: number, { cols, rows }: Size) {
  const payload = Buffer.alloc(8);
  payload.writeUInt16LE(rows, 0);
  payload.writeUInt16LE(cols, 2);
  return frame(tag, payload);
}

// A snapshot writes the scrollback, erases the screen and then draws the
// visible rows. The erase (ED 2) would take the last screenful of scrollback
// with it, so ask for the one that scrolls it into history first (ED 22).
const eraseAfterScrollback = Buffer.from("\x1b[2J\x1b[H\x1b[0m", "latin1");
function keepScrollback(snapshot: Buffer) {
  const at = snapshot.indexOf(eraseAfterScrollback);
  return at === -1 ? snapshot : Buffer.concat([snapshot.subarray(0, at), Buffer.from("\x1b[22J", "latin1"), snapshot.subarray(at + 4)]);
}

// Speaking the protocol directly, rather than running `zmx attach` in a PTY,
// leaves no client in between to claim a detach key, and marks exactly which
// bytes are the restored state.
function attachSession(path: string, size: Size, handlers: LinkHandlers): ZmxLink {
  const socket = connect(path);
  let closed = false;
  // The daemon answers in order. Output before the first label reply predates
  // our Init and is already part of the snapshot; output between the two
  // replies is the snapshot; everything after is live.
  let replies = 0;
  let snapshot: Buffer[] = [];
  let sizing = false;
  let parts: Buffer[] = [];
  let have = 0;
  let need = 8;
  const close = () => {
    if (closed) return;
    closed = true;
    socket.destroy();
    handlers.close();
  };
  socket.on("data", (chunk: Buffer) => {
    parts.push(chunk);
    have += chunk.byteLength;
    if (closed || have < need) return;
    const buffer = parts.length === 1 ? parts[0]! : Buffer.concat(parts);
    let offset = 0;
    need = 8;
    while (!closed && buffer.byteLength - offset >= 8) {
      const total = 8 + buffer.readUInt32LE(offset + 1);
      if (buffer.byteLength - offset < total) { need = total; break; }
      const tag = buffer[offset]!;
      const payload = buffer.subarray(offset + 8, offset + total);
      offset += total;
      if (tag === Tag.Output) {
        if (replies === 1) snapshot.push(payload);
        else if (replies > 1) handlers.output(payload);
      } else if (tag === Tag.LabelData) {
        if (++replies === 2) {
          const state = snapshot.length === 1 ? snapshot[0]! : Buffer.concat(snapshot);
          snapshot = [];
          handlers.restore(keepScrollback(state));
          // zmx sizes a session by the client that typed last, so with another
          // client attached this one would keep the other's size until a key is
          // pressed. An empty paste counts as typing and changes nothing, but
          // only where the application has bracketed paste on.
          if (!sizing && state.includes("\x1b[?2004h")) socket.write(frame(Tag.Input, Buffer.from("\x1b[200~\x1b[201~", "latin1")));
        }
      } else if (tag === Tag.Resize) {
        // The daemon asks the client it now sizes the session by for its size.
        sizing = true;
        socket.write(sizeFrame(Tag.Resize, size));
      }
    }
    parts = offset < buffer.byteLength ? [buffer.subarray(offset)] : [];
    have = buffer.byteLength - offset;
  });
  socket.on("error", close);
  socket.on("close", close);
  socket.write(Buffer.concat([frame(Tag.LabelGet), sizeFrame(Tag.Init, size), frame(Tag.LabelGet)]));
  return {
    input(data) { if (!closed) socket.write(frame(Tag.Input, data)); },
    resize(cols, rows) {
      size = { cols, rows };
      if (!closed) socket.write(sizeFrame(Tag.Resize, size));
    },
    close() {
      if (closed) return;
      closed = true;
      socket.destroy();
    },
  };
}
