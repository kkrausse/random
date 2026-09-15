import type { SessionInfo, SessionTransferData } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export type Archive = {
  version: 1
  archivedAt: number
  familyIDs: string[]
  transcript: SessionTransferData
}

export interface ArchiveStore {
  list(): Promise<Archive[]>
  save(archive: Archive): Promise<void>
  remove(id: string): Promise<void>
}

export const archiveDirectory = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "claude-sessions", "archives")

export function fileArchiveStore(directory = archiveDirectory): ArchiveStore {
  function path(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid archive session ID")
    return join(directory, `${id}.json`)
  }
  return {
    async list() {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const archives: Archive[] = []
      for (const name of await readdir(directory)) {
        if (!name.endsWith(".json")) continue
        const archive = JSON.parse(await readFile(join(directory, name), "utf8")) as Archive
        if (archive.version !== 1 || !archive.transcript?.info?.id || !Array.isArray(archive.transcript.messages)
          || !Array.isArray(archive.familyIDs) || name !== `${archive.transcript.info.id}.json`) {
          throw new Error(`Invalid session archive: ${name}`)
        }
        archives.push(archive)
      }
      return archives
    },
    async save(archive) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const target = path(archive.transcript.info.id)
      const temporary = `${target}.${randomUUID()}.tmp`
      const json = JSON.stringify(archive)
      try {
        const file = await open(temporary, "wx", 0o600)
        try { await file.writeFile(json); await file.sync() } finally { await file.close() }
        await rename(temporary, target)
        const dir = await open(directory, "r")
        try { await dir.sync() } finally { await dir.close() }
        if (await readFile(target, "utf8") !== json) throw new Error("Archive verification failed")
      } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error }) }
    },
    async remove(id) {
      // Retain a backup after import; only top-level JSON files appear as inactive.
      await mkdir(join(directory, "restored"), { recursive: true, mode: 0o700 })
      await rename(path(id), join(directory, "restored", `${id}-${randomUUID()}.json`))
    },
  }
}

type Client = Plugin.Context["client"]
function missing(error: unknown) {
  // A proxy's generic 404 is not evidence that the session was deleted.
  return (error as { _tag?: string })?._tag === "SessionNotFoundError"
}

export async function archiveSession(client: Client, store: ArchiveStore, root: SessionInfo): Promise<Archive> {
  const family = new Map([[root.id, root]])
  // Interrupt parents before enumerating children so they cannot keep spawning work.
  for (const session of family.values()) {
    await client.session.interrupt({ sessionID: session.id, continue: false })
    let cursor: string | undefined
    const cursors = new Set<string>()
    do {
      const page = await client.session.list({ parentID: session.id, limit: 100, cursor })
      for (const child of page.data) family.set(child.id, child)
      cursor = page.cursor.next ?? undefined
      if (cursor && cursors.has(cursor)) throw new Error("Archive session pagination repeated a cursor")
      if (cursor) cursors.add(cursor)
    } while (cursor)
  }
  const locations = new Map([...family.values()].map((session) => [
    `${session.location.workspaceID ?? ""}\0${session.location.directory}`,
    { directory: session.location.directory, workspace: session.location.workspaceID },
  ]))
  async function removeShells() {
    for (const location of locations.values()) {
      const owned = (await client.shell.list({ location })).data.filter((shell) =>
        typeof shell.metadata?.sessionID === "string" && family.has(shell.metadata.sessionID))
      for (const shell of owned) await client.shell.remove({ id: shell.id, location })
      const remaining = (await client.shell.list({ location })).data.filter((shell) =>
        typeof shell.metadata?.sessionID === "string" && family.has(shell.metadata.sessionID))
      if (remaining.length) throw new Error("Owned shells remain; archive cleanup is incomplete.")
    }
  }
  await removeShells()
  // Shell completion can deliver fresh input. Interrupt once more before exporting.
  for (const id of family.keys()) await client.session.interrupt({ sessionID: id, continue: false })
  const transcript = await client.session.export({ sessionID: root.id, sanitize: false })
  const archive: Archive = { version: 1, archivedAt: Date.now(), familyIDs: [...family.keys()], transcript }
  await store.save(archive)
  await client.session.remove({ sessionID: root.id })
  for (const sessionID of family.keys()) {
    try { await client.session.get({ sessionID }) } catch (error) { if (missing(error)) continue; throw error }
    throw new Error(`Session ${sessionID} still exists; archive retained. Retry archive.`)
  }
  // Catch shells created by late completion notifications before deletion finished.
  await removeShells()
  return archive
}

export async function restoreSession(client: Client, store: ArchiveStore, archive: Archive) {
  const parentID = archive.transcript.info.parentID
  if (parentID) {
    try { await client.session.get({ sessionID: parentID }) } catch (error) {
      if (missing(error)) throw new Error(`Restore parent session ${parentID} before restoring this child archive.`, { cause: error })
      throw error
    }
  }
  // Import defaults to the connected server's location, NOT info.location.
  const session = await client.session.import({ ...archive.transcript, location: archive.transcript.info.location })
  await store.remove(archive.transcript.info.id)
  return session
}
