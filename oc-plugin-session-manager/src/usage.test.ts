import { strict as assert } from "node:assert"
import { describe, test } from "node:test"
import type { ModelInfo, SessionMessageInfo } from "@opencode-ai/client"
import { estimateUsageCost } from "./tui"

const sol = {
  id: "gpt-5.6-sol",
  modelID: "gpt-5.6-sol",
  providerID: "openai",
  cost: [],
} as unknown as ModelInfo

const zen = {
  ...sol,
  providerID: "opencode",
  cost: [
    { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
    { tier: { type: "context", size: 272_000 }, input: 4, output: 15, cache: { read: 0.4, write: 5 } },
  ],
} as ModelInfo

function assistant(input: {
  id: string
  cost?: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}) {
  return {
    id: input.id,
    type: "assistant",
    model: { id: sol.id, providerID: sol.providerID },
    cost: input.cost,
    tokens: input.tokens,
    content: [],
    agent: "build",
    time: { created: 1, completed: 2 },
  } as SessionMessageInfo
}

describe("estimateUsageCost", () => {
  test("uses Zen fallback rates for an unpriced Sol response", () => {
    const result = estimateUsageCost([
      assistant({
        id: "one",
        tokens: { input: 1_000_000, output: 100_000, reasoning: 10_000, cache: { read: 500_000, write: 20_000 } },
      }),
    ], [sol, zen])

    assert.deepEqual(result, { cost: 5.95, estimated: true, unpriced: 0, zenEquivalent: true })
  })

  test("keeps provider-calculated cost and reports unknown models", () => {
    const priced = assistant({
      id: "priced",
      cost: 0.25,
      tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const unknown = {
      ...assistant({
        id: "unknown",
        tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
      model: { id: "unknown", providerID: "custom" },
    } as SessionMessageInfo

    assert.deepEqual(estimateUsageCost([priced, unknown], [sol]), { cost: 0.25, estimated: false, unpriced: 1, zenEquivalent: false })
  })

  test("matches Astra and fast variants by underlying model ID and follows catalog prices", () => {
    const astra = { ...sol, id: "gpt-6-astra-fast", modelID: "gpt-6-astra" }
    const catalog = { ...zen, id: "gpt-6-astra", modelID: "gpt-6-astra", cost: [{ input: 10, output: 50, cache: { read: 1, write: 12.5 } }] }
    const message = { ...assistant({ id: "astra", tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }), model: { id: astra.id, providerID: astra.providerID } } as SessionMessageInfo
    assert.deepEqual(estimateUsageCost([message], [astra, catalog]), { cost: 0.001, estimated: true, unpriced: 0, zenEquivalent: true })
  })

  test("prefers provider rates, preserves free pricing, and uses manual rates only without a catalog match", () => {
    const message = assistant({ id: "one", tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
    const rates = [{ input: 3, output: 0, cache: { read: 0, write: 0 } }]
    assert.equal(estimateUsageCost([message], [{ ...sol, cost: rates }, zen]).cost, 0.0003)
    assert.equal(estimateUsageCost([message], [{ ...sol, cost: [{ ...rates[0]!, input: 0 }] }, zen]).cost, 0)
    assert.equal(estimateUsageCost([message], [sol], { "openai/gpt-5.6-sol": rates }).cost, 0.0003)
    assert.equal(estimateUsageCost([message], [sol, zen], { "openai/gpt-5.6-sol": rates }).cost, 0.0002)
    assert.equal(estimateUsageCost([message], [sol]).unpriced, 1)
  })
})
