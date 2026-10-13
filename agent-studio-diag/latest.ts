#!/usr/bin/env bun
// Print a run of agent-studio's diagnostics readably: one line per record, the page's own
// time, the kind, and what it says.
//
//   bun latest.ts [--follow] [--all] [--list] [run id or part of a file name]
//
//   --follow   keep printing as lines arrive (and stay on that run)
//   --all      every heartbeat. Without it a heartbeat is printed only when it says something:
//              a stall, or one a minute as a sign of life with the memory numbers
//   --list     the runs there are, newest last, and stop
//
// The directory is DIAG_DIR, default ~/devfs/cache/agent-studio-diag (server.ts).
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const args = Bun.argv.slice(2);
const follow = args.includes("--follow") || args.includes("-f");
const all = args.includes("--all");
const wanted = args.find((each) => !each.startsWith("-"));
const dir = process.env.DIAG_DIR ?? join(homedir(), "devfs/cache/agent-studio-diag");

const files = (await Promise.all((await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".jsonl")).map(async (name) => ({ name, ...(await stat(join(dir, name))) })))).sort((a, b) => a.mtimeMs - b.mtimeMs);
if (args.includes("--list")) {
  for (const file of files) console.log(`${new Date(file.mtimeMs).toISOString()}  ${String(Math.round(file.size / 1024)).padStart(7)} KiB  ${file.name}`);
  process.exit(0);
}
const chosen = wanted ? files.findLast((file) => file.name.includes(wanted)) : files.at(-1);
if (!chosen) {
  console.error(wanted ? `no run matching ${wanted} in ${dir}` : `no runs in ${dir}`);
  process.exit(1);
}
const path = join(dir, chosen.name);
console.error(`# ${path}`);

type Row = Record<string, any>;
const clock = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toISOString().slice(11, 23) : "            ");
const mb = (bytes: unknown) => (typeof bytes === "number" ? `${Math.round(bytes / 2 ** 20)} MiB` : "?");
const seconds = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "?");
let beats = 0;

/** What a record says, in a line; undefined for one that is not worth a line. */
function text(row: Row): string | undefined {
  switch (row.kind) {
    case "beat": {
      // The page's own heartbeat: late when its main thread was held.
      const stalled = row.late > 1000;
      const stuck = row.storage?.waiting > 5;
      if (!all && !stalled && !stuck && beats++ % 30 !== 0) return undefined;
      return `${stalled ? `MAIN THREAD HELD ${seconds(row.late)} (heartbeat ${seconds(row.gap)} after the one before)` : "alive"}${row.hidden ? ", tab hidden" : ""}; heap ${mb(row.heap?.used)} of ${mb(row.heap?.limit)}; ${row.fetches ?? "?"} fetch(es) pending; ${row.workers ?? "?"} worker(s) started; ${row.queued ?? 0} queued${row.kernel ? `; guest kernel ${mb(row.kernel.inUse)} in use of ${mb(row.kernel.size)}` : ""}${row.storage ? `; guest storage ${row.storage.waiting !== undefined ? `FLUSH WAITING ${row.storage.waiting} s` : row.storage.stored !== undefined ? `stored ${row.storage.stored} s ago (${row.storage.took} ms)` : "not confirmed yet"}${Object.entries(row.storage.files ?? {}).map(([name, file]: [string, any]) => `, ${name.split("/").pop()} ${mb(file.bytes)} written ${file.age} s ago`).join("")}` : ""}${row.step ? `; step: ${row.step}` : ""}${row.agent ? `; agent ${row.agent}` : ""}`;
    }
    case "wbeat": {
      // The worker's: it goes on when the main thread does not.
      const stalled = row.sincePing > 3000;
      if (!all && !stalled) return undefined;
      return `${stalled ? `WORKER: no ping from the page for ${seconds(row.sincePing)}` : "worker alive"}${row.late > 1000 ? `; the worker itself was late by ${seconds(row.late)}` : ""}${row.last?.step ? `; last step: ${row.last.step}` : ""}${row.last?.agent ? `; agent ${row.last.agent}` : ""}`;
    }
    case "facts":
      return Object.entries(row)
        .filter(([key]) => !["at", "t", "n", "kind", "ms"].includes(key))
        .map(([key, value]) => `\n    ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("");
    case "sessions":
      return `${row.text}${(row.sessions ?? []).map((each: Row) => `\n    ${each.id}  ${each.updated ?? "?"}  ${each.running ? "RUNNING " : ""}${each.page ? "(the page's) " : ""}${each.outcome ?? ""}  ${each.title ?? "(no title)"}`).join("")}`;
    case "file":
      return `${row.text} ${row.gone ? "gone" : `${row.bytes} bytes`}${row.progress ? ` (${row.progress.done} of ${row.progress.total ?? "?"} downloaded${row.progress.finished ? ", finished" : ""})` : ""}`;
    case "tool":
      return `${row.name} ${row.input ?? ""} -> ${row.status}${row.error ? ` ERROR ${typeof row.error === "string" ? row.error : JSON.stringify(row.error)}` : ""}${row.exit !== undefined ? ` exit ${row.exit}` : ""}${row.took !== undefined ? ` (${seconds(row.took)})` : ""}${row.printed ? `, printed ${row.printed} characters` : ""}${row.output ? `\n    ${String(row.output).replaceAll("\n", "\n    ")}` : ""}`;
    case "message":
      return `${row.role}${row.model ? ` (${row.model})` : ""}${row.tokens ? ` [${row.tokens.input ?? 0} in, ${row.tokens.output ?? 0} out, ${row.tokens.reasoning ?? 0} reasoning]` : ""}${row.error ? ` ERROR ${typeof row.error === "string" ? row.error : JSON.stringify(row.error)}` : ""}${row.text ? `: ${row.text}` : ""}`;
    case "longtask":
      return `the main thread was busy ${seconds(row.duration)}${row.name ? ` (${row.name})` : ""}`;
    case "fetch":
      return `${row.method ?? "GET"} ${row.url} -> ${row.status ?? row.error ?? "pending"} after ${seconds(row.took)}${row.pending ? " (still pending)" : ""}`;
    default:
      return `${row.text ?? ""}${Object.keys(row).some((key) => !["at", "t", "n", "kind", "ms", "text", "session", "title", "backfill", "id", "when"].includes(key)) ? ` ${JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !["at", "t", "n", "kind", "ms", "text", "session", "title", "backfill", "id", "when"].includes(key))))}` : ""}`;
  }
}

let last = 0;
const titled = new Set<string>();
function print(line: string) {
  if (!line.trim()) return;
  let row: Row;
  try {
    row = JSON.parse(line);
  } catch {
    return void console.log(line);
  }
  // A sequence number missing between two records of the page is a batch that never arrived.
  const lost = row.kind !== "wbeat" && typeof row.n === "number" && last && row.n > last + 1 ? ` (${row.n - last - 1} record(s) before this never arrived)` : "";
  if (row.kind !== "wbeat" && typeof row.n === "number") last = Math.max(last, row.n);
  const said = text(row) ?? (lost ? "" : undefined);
  if (said === undefined) return;
  // Which session a line is of: the end of its id, and its title once.
  const session = typeof row.session === "string" && row.kind !== "sessions" ? `[${row.session.slice(-6)}${row.backfill ? " earlier" : ""}${row.title && !titled.has(row.session) ? ` "${row.title}"` : ""}] ` : "";
  if (session && row.title) titled.add(row.session);
  // A line of an earlier visit has the time its message was made, not the time it was sent again.
  console.log(`${clock(row.backfill && typeof row.when === "number" ? row.when : (row.t ?? Date.parse(row.at)))} ${String(row.kind ?? "?").padEnd(8)} ${session}${said}${lost}`);
}

const handle = await open(path, "r");
let rest = "";
const decoder = new TextDecoder();
let offset = 0;
for (;;) {
  const { size } = await handle.stat();
  while (offset < size) {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(Math.min(1 << 20, size - offset)), 0, Math.min(1 << 20, size - offset), offset);
    if (!bytesRead) break;
    offset += bytesRead;
    const lines = (rest + decoder.decode(buffer.subarray(0, bytesRead), { stream: true })).split("\n");
    rest = lines.pop()!;
    for (const line of lines) print(line);
  }
  if (!follow) break;
  await Bun.sleep(300);
}
await handle.close();
