// A collector for agent-studio's opt-in live diagnostics (`?diag=1` on the page): the page
// posts what its run is doing, as it happens, so that a run in a browser somewhere on the
// tailnet can be read on this machine, including after the tab froze and its console is
// of no use.
//
//   POST /<run id>     newline-delimited JSON (any content type: a `fetch` with text/plain and
//                      `navigator.sendBeacon` both send without a preflight). Each line is
//                      appended to <DIAG_DIR>/<date>-<run id>.jsonl with `at`, the time it
//                      arrived here, put first.
//   OPTIONS /<run id>  the preflight, for a page that sends another content type
//   GET /              one line saying what this is. Nothing is read back over HTTP:
//                      reading is `latest.ts`, or `tail -f`, on this machine.
//
// What it refuses:
//   - loopback only; `tailscale serve` puts the tailnet's https in front (setup.sh);
//   - a browser has to come from an allowed page origin (DIAG_ORIGINS), or it gets 403 and
//     no CORS headers. A client that sends no Origin (curl on a tailnet device) is let in;
//   - a body over DIAG_MAX_BODY (413), a run whose file has reached DIAG_MAX_RUN (413, and
//     one last line in the file saying so), a directory that has reached DIAG_MAX_TOTAL (507):
//     a page that runs away cannot fill the disk;
//   - a run id that is not 1 to 64 of `A-Za-z0-9_.-` after everything else is dropped (400).
//
//   HOST, PORT        where to listen. Default 127.0.0.1:4806.
//   DIAG_ORIGINS      allowed page origins: `https://host[:port]` exactly, or a bare host name
//                     (`localhost`, `*.example.ts.net`) on any scheme and port. Required.
//   DIAG_DIR          where the runs are written. Default ~/devfs/cache/agent-studio-diag.
//   DIAG_MAX_BODY     bytes of one POST. Default 1 MiB.
//   DIAG_MAX_RUN      bytes of one run's file. Default 64 MiB.
//   DIAG_MAX_TOTAL    bytes of the whole directory. Default 4 GiB.
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const list = (value: string | undefined) => (value ?? "").split(/[\s,]+/).filter(Boolean);

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  const url = URL.parse(origin);
  if (!url) return false;
  return allowed.some((entry) => {
    if (entry.includes("://")) return entry.replace(/\/$/, "") === url.origin;
    return entry.startsWith("*.") ? url.hostname.endsWith(entry.slice(1)) : url.hostname === entry;
  });
}

const origins = list(process.env.DIAG_ORIGINS);
if (!origins.length) {
  console.error("DIAG_ORIGINS is required: the page origins allowed to post here, e.g. DIAG_ORIGINS='https://app.example localhost'");
  process.exit(2);
}
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT) || 4806;
const dir = process.env.DIAG_DIR ?? join(homedir(), "devfs/cache/agent-studio-diag");
const maxBody = Number(process.env.DIAG_MAX_BODY) || 2 ** 20;
const maxRun = Number(process.env.DIAG_MAX_RUN) || 64 * 2 ** 20;
const maxTotal = Number(process.env.DIAG_MAX_TOTAL) || 4 * 2 ** 30;
/** One line of a run, however long the page made it. */
const maxLine = 64 * 1024;

await mkdir(dir, { recursive: true });
/** Each run's file and its size so far; and the directory's. Read from the disk at start, kept here after. */
const runs = new Map<string, { file: string; bytes: number; capped: boolean }>();
let total = 0;
for (const name of await readdir(dir)) {
  const found = /^\d{4}-\d{2}-\d{2}-(.+)\.jsonl$/.exec(name);
  const size = (await stat(join(dir, name)).catch(() => undefined))?.size ?? 0;
  total += size;
  if (found) runs.set(found[1]!, { file: join(dir, name), bytes: size, capped: size >= maxRun });
}

/** What a page of `origin` may read of the answer, which is nothing but that it arrived. */
function headers(origin: string | null): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    // The page is cross-origin isolated (COEP require-corp): an answer without this is an error in its console.
    "Cross-Origin-Resource-Policy": "cross-origin",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  };
}
const say = (status: number, text: string, origin: string | null, more: Record<string, string> = {}) =>
  new Response(text ? `agent-studio-diag: ${text}\n` : null, { status, headers: { ...headers(origin), ...(text ? { "Content-Type": "text/plain" } : {}), ...more } });

// Appends are queued: two posts of one run must not interleave their lines.
let writing: Promise<unknown> = Promise.resolve();
const append = (file: string, text: string) => (writing = writing.then(() => appendFile(file, text)).catch((error) => console.error(`could not write ${file}: ${error}`)));

const server = Bun.serve({
  hostname: host,
  port,
  maxRequestBodySize: maxBody,
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (!originAllowed(origin, origins)) {
      console.warn(`refused a request from origin ${origin}`);
      return say(403, "this page's origin is not allowed", null);
    }
    if (request.method === "OPTIONS") {
      return say(204, "", origin, {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "600",
        // A public page asking a tailnet address is, to Chrome, a request to a private network.
        ...(request.headers.get("access-control-request-private-network") ? { "Access-Control-Allow-Private-Network": "true" } : {}),
      });
    }
    if (request.method !== "POST") return say(url.pathname === "/" && request.method === "GET" ? 200 : 405, "POST /<run id> with newline-delimited JSON", origin);
    const id = url.pathname.slice(1);
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id) || id.startsWith(".")) return say(400, "the run id is 1 to 64 of A-Z a-z 0-9 _ . - and does not start with a dot", origin);
    if (Number(request.headers.get("content-length") ?? 0) > maxBody) return say(413, `a body is at most ${maxBody} bytes`, origin);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length > maxBody) return say(413, `a body is at most ${maxBody} bytes`, origin);
    const now = new Date();
    let run = runs.get(id);
    if (!run) {
      // The date is this machine's, as `ls` shows it.
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      run = { file: join(dir, `${day}-${id}.jsonl`), bytes: 0, capped: false };
      runs.set(id, run);
      console.log(`run ${id} from ${origin ?? "no origin"} -> ${run.file}`);
    }
    if (run.capped) return say(413, `this run has its ${maxRun} bytes`, origin);
    if (total >= maxTotal) return say(507, `${dir} has its ${maxTotal} bytes: remove old runs`, origin);
    const at = now.toISOString();
    let out = "";
    for (const line of new TextDecoder().decode(body).split("\n")) {
      if (!line.trim()) continue;
      let record: Record<string, unknown> | undefined;
      if (line.length <= maxLine) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) record = parsed;
        } catch {
          // not JSON: kept as text
        }
      }
      out += `${JSON.stringify(record ? { at, ...record, ...("at" in record ? { at, sentAt: record.at } : {}) } : { at, kind: "raw", text: line.slice(0, maxLine) })}\n`;
    }
    let bytes = Buffer.byteLength(out);
    if (run.bytes + bytes >= maxRun) {
      run.capped = true;
      out = `${JSON.stringify({ at, kind: "capped", text: `this run reached ${maxRun} bytes: nothing more of it is kept` })}\n`;
      bytes = Buffer.byteLength(out);
      console.warn(`run ${id} reached ${maxRun} bytes`);
    }
    run.bytes += bytes;
    total += bytes;
    await append(run.file, out);
    return run.capped ? say(413, `this run has its ${maxRun} bytes`, origin) : say(204, "", origin);
  },
  error(error) {
    // Bun answers a body over maxRequestBodySize itself (413); anything else is ours.
    console.error(`request failed: ${error.message}`);
    return say(500, "the collector failed", null);
  },
});
console.log(`agent-studio-diag on ${server.hostname}:${server.port} for ${origins.join(", ")} -> ${dir} (${runs.size} runs, ${Math.round(total / 1e6)} MB; a body ${maxBody}, a run ${maxRun}, in all ${maxTotal} bytes)`);
