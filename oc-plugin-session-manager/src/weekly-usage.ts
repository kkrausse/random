import type { SessionMessageInfo, TokenUsageInfo } from "@opencode-ai/client"
import type { Plugin } from "@opencode-ai/plugin/tui"

export const WEEK_MS = 7 * 24 * 60 * 60 * 1_000

export function sumUsageTokens(messages: ReadonlyArray<SessionMessageInfo>) {
  const tokens: TokenUsageInfo = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    tokens.input += message.tokens.input
    tokens.output += message.tokens.output
    tokens.reasoning += message.tokens.reasoning
    tokens.cache.read += message.tokens.cache.read
    tokens.cache.write += message.tokens.cache.write
  }
  const input = tokens.input + tokens.cache.read + tokens.cache.write
  return {
    tokens,
    processed: input + tokens.output + tokens.reasoning,
    cacheReadPercent: input > 0 ? tokens.cache.read / input * 100 : 0,
  }
}

export function weeklyMessages(messages: ReadonlyArray<SessionMessageInfo>, now: number) {
  const unique = new Map<string, SessionMessageInfo>()
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    const time = message.time.completed ?? message.time.created
    if (time > now - WEEK_MS && time <= now) unique.set(message.id, message)
  }
  return [...unique.values()]
}

// Read per-response usage: applying a context tier to a week's summed tokens
// would incorrectly price every model at its long-context rate.
export function createWeeklyUsageLoader(client: Plugin.Context["client"], isActive: (id: string) => boolean = () => false) {
  const cache = new Map<string, { updated: number; messages: SessionMessageInfo[] }>()
  return async (now: number, signal: AbortSignal) => {
    const sessions = new Map<string, { id: string; time: { updated: number } }>()
    let cursor: string | undefined
    do {
      const page = await client.session.list({ limit: 100, ...(cursor ? { cursor } : { order: "desc" as const }) }, { signal })
      for (const session of page.data) {
        if (session.time.updated > now - WEEK_MS) sessions.set(session.id, session)
      }
      cursor = page.cursor.next ?? undefined
    } while (cursor)

    for (const id of cache.keys()) if (!sessions.has(id)) cache.delete(id)
    const queue = [...sessions.values()]
    let index = 0
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (index < queue.length) {
        signal.throwIfAborted()
        const session = queue[index++]!
        const saved = cache.get(session.id)
        const unfinished = saved?.messages.some((message) => message.type === "assistant" && !message.time.completed)
        if (saved?.updated === session.time.updated && !isActive(session.id) && !unfinished) continue
        const messages: SessionMessageInfo[] = []
        let cursor: string | undefined
        do {
          const page = await client.message.list({
            sessionID: session.id, limit: 100,
            ...(cursor ? { cursor } : { order: "desc" as const }),
          }, { signal })
          // Retain responses finishing during the fetch for the next snapshot.
          // Only the displayed snapshot applies the upper time bound.
          for (const message of page.data) {
            if (message.type === "assistant" && message.tokens
              && (message.time.completed ?? message.time.created) > now - WEEK_MS) {
              messages.push({ ...message, content: [] })
            }
          }
          cursor = page.cursor.next ?? undefined
        } while (cursor)
        cache.set(session.id, { updated: session.time.updated, messages })
      }
    }))
    const messages = weeklyMessages([...cache.values()].flatMap((entry) => entry.messages), now)
    const usedSessions = [...cache.values()].filter((entry) => weeklyMessages(entry.messages, now).length > 0).length
    return { messages, sessions: usedSessions, updated: now }
  }
}
