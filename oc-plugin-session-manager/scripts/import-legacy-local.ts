/** Recover legacy export/delete archives on the local V2 service without changing their recency. */
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFile, open, readFile, readdir, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { archiveDirectory, fileArchiveStore, type Archive } from "../src/archive"

const data = execFileSync("opencode", ["debug", "paths", "db"], { encoding: "utf8" }).trim()
const state = execFileSync("opencode", ["debug", "paths", "state"], { encoding: "utf8" }).trim()
const lifecyclePath = join(state, "latest", "tui", "plugin.claude.sessions.session-lifecycle.json")
const endpoint = await Service.discover()
assert.ok(endpoint, "Start the local OpenCode service first")
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
const info = await client.server.info()
assert.ok(info.pid && execFileSync("lsof", ["-p", String(info.pid)], { encoding: "utf8" }).includes(data),
  `The connected server must be the local process using ${data}`)

const names = (await readdir(archiveDirectory)).filter((name) => name.endsWith(".json"))
const requested = new Set(process.argv.slice(2))
assert.ok(requested.size && ([...requested].every((id) => id === "--all" || /^ses_[a-zA-Z0-9_-]+$/.test(id))),
  "Pass --all or one or more session IDs")
const archives: Archive[] = []
for (const name of names) {
  if (!requested.has("--all") && !requested.has(name.slice(0, -5))) continue
  const archive = JSON.parse(await readFile(join(archiveDirectory, name), "utf8")) as Archive
  assert.equal(archive.version, 1)
  assert.equal(name, `${archive.transcript.info.id}.json`)
  archives.push(archive)
}
assert.equal(archives.length, requested.has("--all") ? names.length : requested.size, "Requested archive missing")
archives.sort((a, b) => Number(!!a.transcript.info.parentID) - Number(!!b.transcript.info.parentID)
  || a.transcript.info.time.created - b.transcript.info.time.created)

// A consistent SQLite snapshot, including the live WAL, precedes any import.
const backup = `${data}.before-legacy-import-${Date.now()}.backup`
execFileSync("sqlite3", [data, `.backup ${backup}`])
const markerBackup = `${lifecyclePath}.before-legacy-import-${Date.now()}.backup`
await copyFile(lifecyclePath, markerBackup)
const db = new DatabaseSync(data)
db.exec("PRAGMA busy_timeout=30000")
const current = db.prepare("SELECT time_updated FROM session_v2 WHERE id = ?")
const restoreTime = db.prepare("UPDATE session_v2 SET time_updated = ? WHERE id = ? AND time_updated = ?")
const store = fileArchiveStore()
let completed = 0
try {
  for (const archive of archives) {
    const { info, messages } = archive.transcript
    const id = info.id
    try {
      // A previous attempt can have completed import but stopped before moving the file.
      let imported
      try { imported = await client.session.get({ sessionID: id }) } catch (error) {
        if ((error as { _tag?: string })._tag !== "SessionNotFoundError") throw error
        imported = await client.session.import({ ...archive.transcript, location: info.location })
      }
      assert.equal(imported.location.directory, info.location.directory)
      const exported = await client.session.export({ sessionID: id, sanitize: false })
      assert.deepEqual(exported.messages.map((message) => message.id), messages.map((message) => message.id),
        `Transcript mismatch for ${id}`)
      const row = current.get(id) as { time_updated: number } | undefined
      assert.ok(row, `Imported session ${id} is missing from the local database`)
      if (row.time_updated !== info.time.updated) {
        assert.ok(row.time_updated > info.time.updated, `Unexpected update time for ${id}`)
        const result = restoreTime.run(info.time.updated, id, row.time_updated)
        assert.equal(result.changes, 1, `Concurrent update to ${id}`)
      }
      assert.equal(current.get(id)?.time_updated, info.time.updated)

      // The parent owns the lifecycle marker. Preserve every other stored override.
      const lifecycle = JSON.parse(await readFile(lifecyclePath, "utf8")) as { inactive: Record<string, boolean> }
      assert.ok(lifecycle.inactive && typeof lifecycle.inactive === "object")
      if (info.parentID) delete lifecycle.inactive[id]
      else lifecycle.inactive[id] = true
      const temporary = `${lifecyclePath}.${randomUUID()}.tmp`
      try {
        const file = await open(temporary, "wx", 0o600)
        try { await file.writeFile(JSON.stringify(lifecycle)); await file.sync() } finally { await file.close() }
        await rename(temporary, lifecyclePath)
      } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error }) }
      await store.remove(id)
      completed++
      console.log(`Restored, archived, and preserved timestamp: ${id} (${messages.length} messages)`)
    } catch (error) {
      console.error(`Stopped at ${id} after ${completed} completed imports:`, error)
      throw error
    }
  }
} finally { db.close() }
console.log(`Done: ${completed} archives. Database backup: ${backup}; lifecycle backup: ${markerBackup}`)
