import type { SessionInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { setTimeout as settle } from "node:timers/promises"

type Client = Plugin.Context["client"]

// Resolve ancestry through the API, not just the picker's loaded pages.
async function rootSession(client: Client, selected: SessionInfo): Promise<SessionInfo> {
  let root = await client.session.get({ sessionID: selected.id })
  const ancestors = new Set([root.id])
  while (root.parentID) {
    if (ancestors.has(root.parentID)) throw new Error("Session ancestry contains a cycle")
    ancestors.add(root.parentID)
    root = await client.session.get({ sessionID: root.parentID })
  }
  return root
}

export async function sessionFamily(client: Client, selected: SessionInfo): Promise<SessionInfo[]> {
  const root = await rootSession(client, selected)
  const family = new Map([[root.id, root]])
  await discover(client, family)
  return [...family.values()]
}

async function discover(client: Client, family: Map<string, SessionInfo>, stop?: (sessionID: string) => Promise<void>) {
  for (const known of family.values()) {
    // Moves can finish during cleanup; refresh locations before sweeping shells.
    const session = await client.session.get({ sessionID: known.id })
    family.set(session.id, session)
    await stop?.(session.id)
    let cursor: string | undefined
    const cursors = new Set<string>()
    do {
      const page = await client.session.list({ parentID: session.id, limit: 100, cursor })
      for (const child of page.data) family.set(child.id, child)
      cursor = page.cursor.next ?? undefined
      if (cursor && cursors.has(cursor)) throw new Error("Soft archive pagination repeated a cursor")
      if (cursor) cursors.add(cursor)
    } while (cursor)
  }
}

/** Stop existing work without exporting/deleting history. This is not an admission lock. */
export async function softArchiveSession(client: Client, selected: SessionInfo): Promise<SessionInfo[]> {
  const root = await rootSession(client, selected)
  const family = new Map([[root.id, root]])
  const stop = async (sessionID: string) => {
    await client.session.interrupt({ sessionID, resume: false })
  }
  const interrupt = async () => {
    for (const sessionID of family.keys()) {
      await stop(sessionID)
    }
  }
  const locations = () => new Map([...family.values()].map((session) => [
    session.location.directory,
    { directory: session.location.directory },
  ])).values()
  const ownedShells = async () => {
    const result = []
    for (const location of locations()) {
      const shells = (await client.shell.list({ location })).data
      for (const shell of shells) {
        if (typeof shell.metadata?.sessionID === "string" && family.has(shell.metadata.sessionID)) {
          result.push({ id: shell.id, location })
        }
      }
    }
    return result
  }
  const clearInboxes = async () => {
    for (const sessionID of family.keys()) {
      for (const item of await client.session.inbox.list({ sessionID })) {
        await client.session.inbox.cancel({ sessionID, inboxID: item.id })
      }
    }
  }

  let cleanSweeps = 0
  let remaining: string[] = []
  for (let sweep = 0; sweep < 4; sweep++) {
    // Stop each parent before listing children so discovery itself doesn't
    // leave a spawning session running until the entire tree has been read.
    const size = family.size
    await discover(client, family, stop)
    if (family.size !== size) cleanSweeps = 0
    for (const shell of await ownedShells()) await client.shell.remove(shell)
    await clearInboxes()
    // Completion notifications can enqueue input or restart execution during cleanup.
    await interrupt()
    await clearInboxes()
    await settle(100)

    const before = new Map(family)
    await discover(client, family)
    remaining = []
    for (const session of family.values()) {
      const previous = before.get(session.id)
      if (!previous || JSON.stringify(previous.location) !== JSON.stringify(session.location)) remaining.push(`changed family: ${session.id}`)
      const inbox = await client.session.inbox.list({ sessionID: session.id })
      if (inbox.length) remaining.push(`pending inbox: ${session.id}`)
    }
    for (const shell of await ownedShells()) remaining.push(`owned shell: ${shell.id}`)
    const active = await client.session.active()
    for (const id of family.keys()) if (active[id]) remaining.push(`active session: ${id}`)
    cleanSweeps = remaining.length ? 0 : cleanSweeps + 1
    // Two consecutive clean sweeps, including a second full stop/drain pass.
    if (cleanSweeps === 2) return [...family.values()]
  }
  throw new Error(`Soft archive did not settle; retry cleanup (${remaining.join(", ") || "family has not stayed inactive for two sweeps"})`)
}
