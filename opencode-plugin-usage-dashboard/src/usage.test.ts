import { expect, test } from "bun:test"
import { bounds, groupModels, totalTokens, type Stats } from "./usage"
import { accountLimits } from "./codex"

test("today starts at local midnight; rolling 24h starts exactly one day back", () => {
  const now = new Date(2026, 8, 23, 13, 12).getTime()
  expect(bounds("today", now).from).toBe(new Date(2026, 8, 23).getTime())
  expect(bounds("24h", now).from).toBe(now - 86_400_000)
  expect(bounds("7d", now).from).toBe(new Date(2026, 8, 17).getTime())
  expect(bounds("14d", now).from).toBe(new Date(2026, 8, 10).getTime())
  expect(bounds("7d", now).width).toBe(86_400_000)
})

test("Codex named limits do not duplicate the default rateLimits entry", () => {
  const account = {
    account: { name: "main", source: "opencode" },
    usage: {
      rateLimits: { limitId: "codex", primary: { usedPercent: 20 } },
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 20 } },
        other: { primary: { usedPercent: 60 } },
      },
    },
  }
  expect(accountLimits(account).map((limit) => limit.id)).toEqual(["codex", "other"])
})

test("total tokens includes both cache paths and reasoning", () => {
  expect(totalTokens({ input: 10, output: 20, reasoning: 3, cache: { read: 70, write: 2 } })).toBe(105)
})

test("model totals merge variants without merging providers or mutating the source", () => {
  const usage = (providerID: string, variant: string, steps: number): Stats["models"][number] => ({
    model: { providerID, id: "sol", variant }, steps, cost: steps / 10,
    tokens: { input: steps, output: steps * 2, reasoning: steps * 3, cache: { read: steps * 4, write: steps * 5 } },
  })
  const entries = [usage("openai", "medium", 2), usage("openai", "default", 3), usage("opencode", "default", 7)]
  const grouped = groupModels(entries)
  expect(grouped).toHaveLength(2)
  expect(grouped[0]).toEqual({
    model: { providerID: "openai", id: "sol" }, steps: 5, cost: 0.5,
    tokens: { input: 5, output: 10, reasoning: 15, cache: { read: 20, write: 25 } },
  })
  expect(grouped[1]!.steps).toBe(7)
  expect(entries[0]!.tokens.input).toBe(2)
})
