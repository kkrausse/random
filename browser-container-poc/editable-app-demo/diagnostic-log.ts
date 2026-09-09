import { appendFile, mkdir, rename, stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { safeData } from "./src/diagnostic-data";

/** Two 2 MiB generations, one serialized writer. Logging never rejects callers. */
export function diagnosticLog(directory: string, limit = 2 * 1024 * 1024) {
  const file = resolve(directory, "events.jsonl");
  let queue = Promise.resolve(), queued = 0;
  return {
    file,
    write(event: unknown) {
      if (queued >= 200) return Promise.resolve();
      queued++;
      queue = queue.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const json = JSON.stringify(safeData(event));
        const line = (json.length <= 24000 ? json : JSON.stringify({ event: "diagnostic.oversized", preview: json.slice(0, 20000) })) + "\n";
        if ((await stat(file).catch(() => ({ size: 0 }))).size + Buffer.byteLength(line) > limit) await rename(file, `${file}.1`).catch(() => {});
        await appendFile(file, line, { mode: 0o600 });
      }).catch(() => {}).finally(() => { queued--; });
      return queue;
    },
    async text() { await queue; return (await readFile(`${file}.1`, "utf8").catch(() => "")) + (await readFile(file, "utf8").catch(() => "")); },
  };
}
