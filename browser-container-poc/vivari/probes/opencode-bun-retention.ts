import { combinedSteps } from './opencode-bun-fixtures'
import type { CombinedEvent } from './opencode-bun-combined'

export const combinedTitle = 'Combined tools probe'
export const retentionCleanup = 'runtime.stop + workspace.flush + workspace.close completed'
export const retentionScope = 'same-page full workspace/runtime reopen; no page reload'
export const retentionCheckpoints = {
  captured: 'completed combined session ID/title and stable history captured',
  before: 'edited combined file retained before second Runtime.start; no reseed',
  after: 'original session ID/title/history and edited file retained after fresh health',
  endpoint: 'old endpoint rejected after runtime.stop',
  posts: 'provider POST count unchanged after first completed phase',
} as const
export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stableJSON(v)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
type Hash = (bytes: Uint8Array) => Promise<string>
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v)

// Pinned protocol groups/session.ts:496-505 returns { data: SessionMessage.Info[] }.
// schema/session-message.ts:104-206: tools are nested assistant.content entries,
// completion is assistant.time.completed and tool.state.status === 'completed'.
// Deliberately exclude timestamps, provider state, metadata, costs and tokens.
// All prose (including reasoning), inputs and tool content leave this boundary only as hashes.
export async function projectHistory(data: unknown, events: CombinedEvent[], hash: Hash) {
  try {
    if (!Array.isArray(data) || !data.length) throw Error()
    const digest = (v: unknown) => hash(new TextEncoder().encode(stableJSON(v)))
    const ids = new Set<string>(), tools = new Set<string>()
    let toolIndex = 0, assistants = 0, users = 0
    const messages = []
    for (const message of data) {
      if (!identifier(message?.id) || !message.id.startsWith('msg_') || ids.has(message.id)) throw Error()
      ids.add(message.id)
      if (message.type === 'assistant') {
        if (message.time?.completed == null || message.error || !Array.isArray(message.content) || !message.content.length) throw Error()
        assistants++
        const content = []
        for (const part of message.content) {
          if (part.type === 'tool') {
            const step = combinedSteps[toolIndex], event = events[toolIndex * 3]
            if (!step || !event || !identifier(part.id) || tools.has(part.id) || part.id !== event.data.id ||
              message.id !== event.data.assistantMessageID || part.name !== step.name || part.executed !== false ||
              part.state?.status !== 'completed' || stableJSON(part.state.input) !== stableJSON(step.input) ||
              !Array.isArray(part.state.content) || !part.state.content.length) throw Error()
            if ('content' in step && stableJSON(part.state.content) !== stableJSON([{ type: 'text', text: step.content }])) throw Error()
            tools.add(part.id); toolIndex++
            content.push({ type: 'tool', id: part.id, name: step.name, status: 'completed', executed: false,
              inputSha256: await digest(part.state.input), contentSha256: await digest(part.state.content) })
          } else {
            if (!['text', 'reasoning'].includes(part.type) || typeof part.text !== 'string') throw Error()
            content.push({ type: part.type, sha256: await digest(part.text) })
          }
        }
        messages.push({ id: message.id, type: 'assistant', status: 'completed', finishSha256: await digest(message.finish), content })
      } else {
        if (!['user', 'system', 'synthetic', 'agent-switched', 'model-switched'].includes(message.type)) throw Error()
        if (message.type === 'user') users++
        const { time, metadata, ...stable } = message
        messages.push({ id: message.id, type: message.type, sha256: await digest(stable) })
      }
    }
    if (!assistants || users !== 1 || toolIndex !== combinedSteps.length) throw Error()
    return { messages, assistants, tools: toolIndex, sha256: await digest(messages) }
  } catch { throw Error('Combined retention history rejected') }
}

export type HistoryProjection = Awaited<ReturnType<typeof projectHistory>>
export function sameHistory(before: HistoryProjection, after: HistoryProjection) {
  if (stableJSON(before) !== stableJSON(after)) throw Error('Combined retention history changed')
}
