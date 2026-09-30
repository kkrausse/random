import { expect, test } from "bun:test"
import { accountCredits, accountLimits, limitWindowLabel, windowLabel, type CodexAccount } from "./codex"

test("allowance labels use readable window durations", () => {
  expect(windowLabel({ windowDurationMins: 10080 })).toBe("Weekly")
  expect(windowLabel({ windowDurationMins: 300 })).toBe("5-hour")
  expect(windowLabel({ windowDurationMins: 1440 })).toBe("Daily")
  expect(windowLabel({ windowDurationMins: 2880 })).toBe("2-day")
  expect(windowLabel({ windowDurationMins: 30 })).toBe("30-minute")
  expect(windowLabel({})).toBe("Usage")
  expect(limitWindowLabel({ id: "codex" }, { windowDurationMins: 10080 })).toBe("Codex Weekly")
  expect(limitWindowLabel({ id: "code_review" }, { windowDurationMins: 10080 })).toBe("Code review Weekly")
  expect(limitWindowLabel({ id: "other", limitName: "Model" }, { windowDurationMins: 300 })).toBe("Model 5-hour")
})

const account: CodexAccount = { account: { name: "test", source: "codex" } }

test("regular credits are separate from reset credits", () => {
  expect(accountCredits({ ...account, usage: { rateLimitResetCredits: { availableCount: 3 } } })).toBe("–")
  expect(accountCredits({ ...account, usage: { rateLimits: { credits: { balance: "42.5" } }, rateLimitResetCredits: { availableCount: 3 } } })).toBe("42.5")
  expect(accountCredits({ ...account, usage: { rateLimits: { credits: { unlimited: true } } } })).toBe("Unlimited")
  expect(accountCredits({ ...account, usage: { rateLimits: { credits: { hasCredits: true } } } })).toBe("Available")
  expect(accountCredits({ ...account, usage: { rateLimits: { credits: { hasCredits: false } } } })).toBe("None")
  expect(accountCredits({ ...account, usage: { rateLimits: { credits: { balance: "0" } } } })).toBe("0")
  expect(accountCredits({ ...account, usage: { rateLimitsByLimitId: { codex: { credits: { balance: "12" } } } } })).toBe("12")
})

test("weekly-only accounts do not gain a primary allowance window", () => {
  const limits = accountLimits({ ...account, usage: { rateLimits: { secondary: { windowDurationMins: 10080, usedPercent: 20 } } } })
  expect(limits).toHaveLength(1)
  expect(limits[0]!.primary).toBeUndefined()
  expect(limitWindowLabel(limits[0]!, limits[0]!.secondary!)).toBe("Codex Weekly")
})
