// Imports the Palma reading chats from the 1.18 database into the running v2 server through
// POST /api/experimental/session/import. v2 would not upgrade the Pi's database in place (it was the
// retired beta's database before 1.18 used it), so the deploy moved it to pre-v2/ and v2 started fresh.
//
//   bun import-v1-history.ts <old opencode.db> <server url> [--limit N] [--dry-run]
//
// Needs OPENCODE_SERVER_PASSWORD. Chats that already exist on the server are skipped, so it can be
// rerun. Only user and assistant text is carried over; tool calls and reasoning are left out.
import { Database } from "bun:sqlite"

const [dbPath, baseUrl] = process.argv.slice(2)
if (!dbPath || !baseUrl) throw new Error("usage: bun import-v1-history.ts <opencode.db> <server url> [--limit N] [--dry-run]")
const limitIndex = process.argv.indexOf("--limit")
const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : Infinity
const dryRun = process.argv.includes("--dry-run")
const authorization = "Basic " + btoa("opencode:" + (process.env.OPENCODE_SERVER_PASSWORD ?? ""))

interface V1Session {
  id: string
  project_id: string
  directory: string
  title: string | null
  agent: string | null
  model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  time_created: number
  time_updated: number
}

const finishes = new Set(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
const db = new Database(dbPath, { readonly: true })
const sessions = db
  .query("SELECT * FROM session WHERE parent_id IS NULL ORDER BY time_created")
  .all() as V1Session[]

const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(baseUrl.replace(/\/+$/, "") + path, {
    method,
    headers: { authorization, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, text: await response.text() }
}

const tokens = (value: any) => ({
  input: value?.input ?? 0,
  output: value?.output ?? 0,
  reasoning: value?.reasoning ?? 0,
  cache: { read: value?.cache?.read ?? 0, write: value?.cache?.write ?? 0 },
})

const transcript = (session: V1Session) => {
  const rows = db
    .query("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id")
    .all(session.id) as { id: string; data: string }[]
  const messages: unknown[] = []
  for (const row of rows) {
    const info = JSON.parse(row.data)
    const text = (db.query("SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id").all(row.id) as { data: string }[])
      .map((part) => JSON.parse(part.data))
      .filter((part) => part.type === "text" && !part.synthetic && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
    const created = info.time?.created ?? session.time_created
    if (info.role === "user") {
      messages.push({ id: row.id, type: "user", time: { created }, text })
    } else if (info.role === "assistant") {
      const model = { id: info.modelID ?? info.model?.modelID ?? "unknown", providerID: info.providerID ?? info.model?.providerID ?? "unknown" }
      messages.push({
        id: row.id,
        type: "assistant",
        time: info.time?.completed ? { created, completed: info.time.completed } : { created },
        agent: info.agent ?? info.mode ?? "build",
        model: info.variant ? { ...model, variant: info.variant } : model,
        content: text ? [{ type: "text", text }] : [],
        cost: info.cost ?? 0,
        tokens: tokens(info.tokens),
        ...(finishes.has(info.finish) ? { finish: info.finish } : {}),
      })
    }
  }
  return messages
}

let imported = 0
let skipped = 0
let failed = 0
for (const session of sessions.slice(0, limit)) {
  if ((await api("GET", `/api/session/${session.id}`)).status === 200) {
    skipped++
    continue
  }
  let model: unknown
  try {
    model = session.model ? JSON.parse(session.model) : undefined
  } catch {}
  const body = {
    info: {
      id: session.id,
      projectID: session.project_id,
      title: session.title ?? "Untitled reading chat",
      ...(session.agent ? { agent: session.agent } : {}),
      ...(model ? { model } : {}),
      cost: session.cost,
      tokens: {
        input: session.tokens_input,
        output: session.tokens_output,
        reasoning: session.tokens_reasoning,
        cache: { read: session.tokens_cache_read, write: session.tokens_cache_write },
      },
      time: { created: session.time_created, updated: session.time_updated },
      location: { directory: session.directory },
    },
    messages: transcript(session),
    location: { directory: session.directory },
  }
  if (dryRun) {
    console.log(JSON.stringify(body).slice(0, 1500))
    continue
  }
  const result = await api("POST", "/api/experimental/session/import", body)
  if (result.status >= 200 && result.status < 300) imported++
  else {
    failed++
    console.error(`${session.id}: ${result.status} ${result.text.slice(0, 400)}`)
  }
}
console.log(`Imported ${imported}, already present ${skipped}, failed ${failed}, of ${Math.min(sessions.length, limit)} chats.`)
