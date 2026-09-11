import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { ModelInfo, SessionMessageInfo } from "@opencode-ai/client"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { createWeeklyUsageLoader, weeklyMessages, WEEK_MS } from "./weekly-usage"
import { estimateUsageCost } from "./tui"

function message(id: string, time: number, cost = 1): SessionMessageInfo {
  return {
    id, type: "assistant", model: { id: "test", providerID: "test" }, cost,
    time: { created: time, completed: time }, content: [], agent: "build",
    tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  } as SessionMessageInfo
}

test("weekly window uses response time, excludes future usage, and deduplicates shared messages", () => {
  const now = WEEK_MS * 2
  const included = message("new", now - 1)
  const spanning = { ...message("spanning", now - WEEK_MS - 1), time: { created: now - WEEK_MS - 1, completed: now } } as SessionMessageInfo
  const result = weeklyMessages([message("old", now - WEEK_MS), included, included, message("future", now + 1), spanning], now)
  assert.deepEqual(result.map((m) => m.id), ["new", "spanning"])
  assert.equal(estimateUsageCost(result, []).cost, 2)
})

test("weekly loader paginates sessions and messages, caches unchanged sessions, and expires usage", async () => {
  let now = WEEK_MS * 2
  let updated = now
  let calls = 0
  let active = false
  let removed = false
  const client = {
    session: { list: async ({ cursor }: { cursor?: string }) => cursor
      ? { data: removed ? [] : [{ id: "child", time: { updated } }], cursor: {} }
      : { data: [{ id: "old", time: { updated: 1 } }, { id: "parent", time: { updated } }], cursor: { next: "sessions-2" } } },
    message: { list: async ({ sessionID, cursor }: { sessionID: string; cursor?: string }) => {
      calls++
      assert.notEqual(sessionID, "old")
      return cursor
        ? { data: [message(`${sessionID}-old`, now - WEEK_MS - 100)], cursor: {} }
        : { data: [message("shared", WEEK_MS + 1), message(sessionID, WEEK_MS * 2)], cursor: { next: "messages-2" } }
    } },
  } as unknown as Plugin.Context["client"]
  const load = createWeeklyUsageLoader(client, () => active)
  const signal = new AbortController().signal
  const first = await load(now, signal)
  assert.equal(first.sessions, 2)
  assert.equal(first.messages.length, 3)
  assert.equal(calls, 4)
  now += 2
  assert.equal((await load(now, signal)).messages.length, 2, "cached responses age out of the rolling window")
  assert.equal(calls, 4)
  updated++
  await load(now, signal)
  assert.equal(calls, 8, "updated sessions are reread")
  active = true
  await load(now, signal)
  assert.equal(calls, 12, "running sessions are reread even with an unchanged timestamp")
  active = false
  removed = true
  assert.equal((await load(now, signal)).sessions, 1, "deleted sessions leave the cache")
})

test("weekly loader propagates failures and passes cancellation to every request", async () => {
  const controller = new AbortController()
  const client = {
    session: { list: async (_: unknown, options: { signal: AbortSignal }) => {
      assert.equal(options.signal, controller.signal)
      return { data: [{ id: "one", time: { updated: WEEK_MS * 2 } }], cursor: {} }
    } },
    message: { list: async (_: unknown, options: { signal: AbortSignal }) => {
      assert.equal(options.signal, controller.signal)
      throw new Error("unavailable")
    } },
  } as unknown as Plugin.Context["client"]
  await assert.rejects(createWeeklyUsageLoader(client)(WEEK_MS * 2, controller.signal), /unavailable/)
})

test("weekly prices apply context tiers per response rather than to summed weekly tokens", () => {
  const models = [{
    id: "test", providerID: "test", cost: [
      { input: 1, output: 0, cache: { read: 0, write: 0 } },
      { tier: { type: "context", size: 100 }, input: 2, output: 0, cache: { read: 0, write: 0 } },
    ],
  }] as unknown as ModelInfo[]
  const messages = ["one", "two"].map((id) => ({
    ...message(id, WEEK_MS, 0), tokens: { input: 80, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })) as SessionMessageInfo[]
  assert.equal(estimateUsageCost(weeklyMessages(messages, WEEK_MS + 1), models).cost, 0.00016)
})

test("responses completing during a fetch remain available for the next snapshot", async () => {
  const now = WEEK_MS * 2
  let calls = 0
  const client = {
    session: { list: async () => ({ data: [{ id: "one", time: { updated: now } }], cursor: {} }) },
    message: { list: async () => { calls++; return { data: [message("during-fetch", now + 1)], cursor: {} } } },
  } as unknown as Plugin.Context["client"]
  const load = createWeeklyUsageLoader(client)
  const signal = new AbortController().signal
  assert.equal((await load(now, signal)).messages.length, 0)
  assert.equal((await load(now + 2, signal)).messages.length, 1)
  assert.equal(calls, 1)
})
