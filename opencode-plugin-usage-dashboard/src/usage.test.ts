import { expect, test } from "bun:test"
import { bounds, totalTokens } from "./usage"
import { accountLimits } from "./codex"

test("today starts at local midnight; rolling 24h starts exactly one day back", () => {
  const now = new Date(2026, 8, 23, 13, 12).getTime()
  expect(bounds("today", now).from).toBe(new Date(2026, 8, 23).getTime())
  expect(bounds("24h", now).from).toBe(now - 86_400_000)
  expect(bounds("7d", now).from).toBe(new Date(2026, 8, 17).getTime())
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
