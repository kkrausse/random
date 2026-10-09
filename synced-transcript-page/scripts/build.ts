#!/usr/bin/env bun
// Turns YouTube json3 captions plus a hand-written translation into the synced page.
//   bun build.ts chunks <captions.json3>
//   bun build.ts page --captions c.json3 --en en.json --title T --byline B --url U --lang it --out <site dir>
import { parseArgs } from "node:util";

interface Chunk { start: number; words: [number, string][] }

const CHUNK_SECONDS = 20;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function readChunks(path: string): Promise<Chunk[]> {
  const { events } = await Bun.file(path).json();
  const chunks: Chunk[] = [];
  let last = -Infinity;
  for (const e of events) {
    if (!e.segs) continue;
    const words: [number, string][] = e.segs
      .map((s: any) => [(e.tStartMs + (s.tOffsetMs ?? 0)) / 1000, (s.utf8 ?? "").replace(/\n/g, " ").trim()])
      .filter((w: [number, string]) => w[1]);
    if (!words.length) continue;
    const start = Math.floor(e.tStartMs / 1000);
    if (start - last >= CHUNK_SECONDS) { chunks.push({ start, words: [] }); last = start; }
    chunks[chunks.length - 1].words.push(...words);
  }
  return chunks;
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === "chunks") {
  const chunks = await readChunks(rest[0]);
  chunks.forEach((c, i) => console.log(`[${i}] ${clock(c.start)} ${c.words.map((w) => w[1]).join(" ")}\n`));
  console.error(`${chunks.length} chunks: en.json must be an array of exactly ${chunks.length} strings`);
} else if (mode === "page") {
  const { values: v } = parseArgs({
    args: rest,
    options: { captions: { type: "string" }, en: { type: "string" }, title: { type: "string" }, byline: { type: "string" }, url: { type: "string" }, lang: { type: "string" }, out: { type: "string" } },
  });
  for (const k of ["captions", "en", "title", "byline", "url", "lang", "out"] as const) if (!v[k]) throw new Error(`missing --${k}`);
  const chunks = await readChunks(v.captions!);
  const en: string[] = await Bun.file(v.en!).json();
  if (en.length !== chunks.length) throw new Error(`en.json has ${en.length} entries, captions have ${chunks.length} chunks`);
  const rows = chunks.map((c, i) => {
    const orig = c.words.map(([t, w]) => `<span data-t="${t.toFixed(1)}">${esc(w)}</span>`).join(" ");
    const eng = en[i].split(/\s+/).filter(Boolean).map((w) => `<span>${esc(w)}</span>`).join(" ");
    return `<section data-t="${c.start}"><a class="ts" href="${esc(v.url!)}&t=${c.start}s">${clock(c.start)}</a><div><p class="en">${eng}</p><p class="it" lang="${esc(v.lang!)}">${orig}</p></div></section>`;
  });
  const lastWord = chunks[chunks.length - 1].words.at(-1)![0];
  const fill: Record<string, string> = { TITLE: esc(v.title!), BYLINE: esc(v.byline!), URL: esc(v.url!), LANG: esc(v.lang!), DUR: String(Math.ceil(lastWord) + 2), ROWS: rows.join("\n") };
  const tpl = await Bun.file(new URL("../template.html", import.meta.url)).text();
  await Bun.write(`${v.out}/index.html`, tpl.replace(/@@([A-Z]+)@@/g, (_, k) => fill[k] ?? `@@${k}@@`));
  console.log(`wrote ${v.out}/index.html (${chunks.length} passages)`);
} else {
  console.error("usage: build.ts chunks <captions.json3> | build.ts page --captions … --en … --title … --byline … --url … --lang … --out …");
  process.exit(1);
}
