import type { ModelCost, ModelInfo, SessionMessageAssistant, TokenUsageInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import type { Stats } from "./usage"

type Client = Plugin.Context["client"]
type Response = Pick<SessionMessageAssistant, "id" | "time" | "model" | "tokens" | "cost">

export interface Spend {
  total: number
  quoted: number
  unpriced: number
  byModel: Record<string, number>
  byBucket: number[]
  byBucketModel: Record<string, number[]>
  zenEquivalent: boolean
}

function rateFor(rates: ModelCost[], tokens: TokenUsageInfo) {
  const context = tokens.input + tokens.cache.read + tokens.cache.write
  return rates.filter((rate) => !rate.tier || context > rate.tier.size)
    .sort((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
}

export function estimateSpend(responses: readonly Response[], models: readonly ModelInfo[], bins: readonly Pick<Stats, "range">[]): Spend {
  const inventory = new Map(models.map((model) => [`${model.providerID}/${model.id}`, model]))
  const byModel: Record<string, number> = {}
  const byBucket = bins.map(() => 0)
  const byBucketModel: Record<string, number[]> = {}
  let total = 0
  let quoted = 0
  let unpriced = 0
  let zenEquivalent = false
  for (const message of responses) {
    const key = `${message.model.providerID}/${message.model.id}`
    const model = inventory.get(key)
    const zen = inventory.get(`opencode/${model?.modelID ?? message.model.id}`)
    let cost = message.cost ?? 0
    if (cost <= 0) {
      if (!message.tokens) { unpriced++; continue }
      const rates = model?.cost.length ? model.cost : zen?.cost
      const rate = rates && rateFor(rates, message.tokens)
      if (!rate) { unpriced++; continue }
      zenEquivalent ||= rates === zen?.cost && model?.providerID !== "opencode"
      quoted++
      cost = (
        message.tokens.input * rate.input
        + (message.tokens.output + message.tokens.reasoning) * rate.output
        + message.tokens.cache.read * rate.cache.read
        + message.tokens.cache.write * rate.cache.write
      ) / 1_000_000
    }
    total += cost
    const variantKey = `${key}:${message.model.variant ?? "default"}`
    byModel[variantKey] = (byModel[variantKey] ?? 0) + cost
    const time = message.time.completed ?? message.time.created
    const index = bins.findIndex((bin) => time >= bin.range.from && time < bin.range.to)
    if (index >= 0) {
      byBucket[index]! += cost
      const values = byBucketModel[variantKey] ??= bins.map(() => 0)
      values[index]! += cost
    }
  }
  return { total, quoted, unpriced, byModel, byBucket, byBucketModel, zenEquivalent }
}

export async function loadResponses(client: Client, from: number, to: number, project: string | undefined, signal: AbortSignal) {
  const sessions: Array<{ id: string; updated: number }> = []
  let cursor: string | undefined
  do {
    signal.throwIfAborted()
    const page = await client.session.list({ limit: 100, project, ...(cursor ? { cursor } : { order: "desc" as const }) }, { signal })
    sessions.push(...page.data.filter((session) => session.time.updated >= from).map((session) => ({
      id: session.id, updated: session.time.updated,
    })))
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  const responses: Response[] = []
  let index = 0
  await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, async () => {
    while (index < sessions.length) {
      signal.throwIfAborted()
      const session = sessions[index++]!
      let next: string | undefined
      do {
        const page = await client.message.list({ sessionID: session.id, limit: 100, ...(next ? { cursor: next } : { order: "desc" as const }) }, { signal })
        for (const message of page.data) {
          if (message.type !== "assistant") continue
          const time = message.time.completed ?? message.time.created
          if (time >= from && time <= to) responses.push({
            id: message.id, time: message.time, model: message.model, tokens: message.tokens, cost: message.cost,
          })
        }
        next = page.cursor.next ?? undefined
      } while (next)
    }
  }))
  return responses
}
