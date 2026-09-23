import { expect, test } from "bun:test"
import type { ModelInfo, SessionMessageAssistant } from "@opencode/client"
import { estimateSpend } from "./pricing"

test("prices each response at its context tier, keeps variants separate, and respects recorded charges", () => {
  const zen = {
    id: "example", modelID: "example", providerID: "opencode",
    cost: [
      { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
      { tier: { type: "context" as const, size: 272_000 }, input: 4, output: 15, cache: { read: 0.4, write: 5 } },
    ],
  } as ModelInfo
  const account = { id: "example", modelID: "example", providerID: "openai", cost: [] } as unknown as ModelInfo
  const response = (id: string, time: number, variant: string, input: number, output: number, reasoning: number, cacheRead: number, cost = 0) => ({
    id, type: "assistant" as const, model: { providerID: "openai", id: "example", variant },
    time: { created: time, completed: time }, tokens: { input, output, reasoning, cache: { read: cacheRead, write: 0 } }, cost,
  }) as SessionMessageAssistant
  const result = estimateSpend([
    response("one", 10, "default", 100_000, 10_000, 2_000, 0),
    response("two", 20, "medium", 200_000, 10_000, 0, 100_000),
    response("three", 30, "medium", 1_000, 0, 0, 0, 0.5),
    { id: "missing", model: { providerID: "openai", id: "example" }, time: { created: 31 } } as SessionMessageAssistant,
  ], [account, zen], [{ range: { from: 0, to: 21 } }, { range: { from: 21, to: 40 } }])
  expect(result.total).toBeCloseTo(1.81)
  expect(result.byModel["openai/example:default"]).toBeCloseTo(0.32)
  expect(result.byModel["openai/example:medium"]).toBeCloseTo(1.49)
  expect(result.byBucket[0]).toBeCloseTo(1.31)
  expect(result.byBucket[1]).toBeCloseTo(0.5)
  expect(result.byBucketModel["openai/example:medium"]).toEqual([expect.any(Number), 0.5])
  expect(result.byBucketModel["openai/example:medium"]![0]).toBeCloseTo(0.99)
  expect(result.quoted).toBe(2)
  expect(result.unpriced).toBe(1)
  expect(result.zenEquivalent).toBe(true)
})
