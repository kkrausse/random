#!/usr/bin/env bun
// Fetch a YouTube video's captions as a plain, timestamped transcript.
//
//   yt-transcript.ts <url> [out.txt] [--lang en-orig,en] [--every 30]
//
// Uses `uvx yt-dlp`, so nothing is installed and no audio is downloaded. The
// default language order prefers `en-orig` (YouTube's own speech recognition)
// over `en`, which for some videos is a machine re-translation with missing
// spaces. Without out.txt it writes output/transcripts/<video-id>.txt next to
// this script and prints that path.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface Json3Event {
  tStartMs?: number;
  segs?: { utf8?: string }[];
}

interface Options {
  url: string;
  out?: string;
  langs: string[];
  every: number;
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let langs = ["en-orig", "en"];
  let every = 30;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lang") langs = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--every") every = Number(argv[++i]);
    else positional.push(arg);
  }
  if (positional.length < 1 || positional.length > 2 || !langs.length || !(every > 0)) {
    console.error("Usage: yt-transcript.ts <url> [out.txt] [--lang en-orig,en] [--every 30]");
    process.exit(1);
  }
  return { url: positional[0], out: positional[1], langs, every };
}

async function ytDlp(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["uvx", "yt-dlp", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { ok: (await proc.exited) === 0, stdout, stderr };
}

// YouTube rate-limits the caption endpoint per client (HTTP 429); asking as
// several clients is what gets past it.
const CLIENTS = "youtube:player_client=tv,web_safari,android";

async function fetchCaptions(url: string, lang: string, dir: string): Promise<Json3Event[] | undefined> {
  const result = await ytDlp([
    "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", lang, "--sub-format", "json3",
    "--extractor-args", CLIENTS, "-o", join(dir, `${lang}.%(ext)s`), url,
  ]);
  const file = readdirSync(dir).find((name) => name.startsWith(`${lang}.`) && name.endsWith(".json3"));
  if (!file) {
    const reason = result.stderr.split("\n").filter((line) => line.startsWith("ERROR")).join("; ");
    console.error(`  no ${lang} captions${reason ? `: ${reason}` : ""}`);
    return undefined;
  }
  return (await Bun.file(join(dir, file)).json()).events as Json3Event[];
}

function stamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(whole / 3600);
  return `${h ? `${h}:` : ""}${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
}

function toText(events: Json3Event[], every: number): string {
  const paragraphs: string[] = [];
  let last = -Infinity;
  for (const event of events) {
    const text = (event.segs ?? []).map((seg) => seg.utf8 ?? "").join("").replace(/\s+/g, " ");
    if (!text.trim()) continue;
    const at = (event.tStartMs ?? 0) / 1000;
    if (at - last >= every) {
      paragraphs.push(`[${stamp(at)}]`);
      last = at;
    }
    paragraphs[paragraphs.length - 1] += ` ${text.trim()}`;
  }
  return paragraphs.join("\n\n") + "\n";
}

const options = parseArgs(process.argv.slice(2));
const meta = await ytDlp([
  "--skip-download", "--extractor-args", CLIENTS,
  "--print", "%(id)s\t%(title)s\t%(uploader)s\t%(upload_date)s\t%(duration)s", options.url,
]);
if (!meta.ok) {
  console.error(meta.stderr.trim());
  process.exit(1);
}
const [id, title, uploader, date, duration] = meta.stdout.trim().split("\t");

const work = mkdtempSync(join(tmpdir(), "yt-transcript-"));
let events: Json3Event[] | undefined;
let used = "";
try {
  for (const lang of options.langs) {
    events = await fetchCaptions(options.url, lang, work);
    if (events) {
      used = lang;
      break;
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (!events) {
  console.error(`No captions in ${options.langs.join(", ")} for ${options.url}`);
  process.exit(1);
}

const out = resolve(options.out ?? join(import.meta.dir, "output", "transcripts", `${id}.txt`));
mkdirSync(dirname(out), { recursive: true });
const header = [
  title,
  `${uploader} · ${date.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")} · ${stamp(Number(duration))}`,
  `https://www.youtube.com/watch?v=${id}`,
  `captions: ${used} (machine-generated; expect misheard names and numbers)`,
].join("\n");
const body = toText(events, options.every);
await Bun.write(out, `${header}\n\n${body}`);
console.error(`${body.split(/\s+/).length} words, ${used} captions`);
console.log(out);
