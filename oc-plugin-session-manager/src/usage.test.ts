import { strict as assert } from "node:assert"
import { describe, test } from "node:test"
import type { ModelInfo, SessionMessageInfo } from "@opencode-ai/client"
import { estimateUsageCost } from "./tui"

const sol = {
  id: "gpt-5.6-sol",
  providerID: "openai",
  cost: [],
} as unknown as ModelInfo

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
    ], [sol])

    assert.deepEqual(result, { cost: 5.95, estimated: true, unpriced: 0 })
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

    assert.deepEqual(estimateUsageCost([priced, unknown], [sol]), { cost: 0.25, estimated: false, unpriced: 1 })
  })
})
