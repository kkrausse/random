import { strict as assert } from "node:assert"
import { test } from "node:test"
import { sessionTokenBreakdown, showSessionPicker } from "./tui"

test("formats cumulative session token details for the preview", () => {
  const session = {
    tokens: { input: 12_400, output: 3_100, reasoning: 900, cache: { read: 84_200, write: 1_200 } },
  }

  assert.equal(
    sessionTokenBreakdown(session),
    "Input 12.4k · Cache read 84.2k · Cache write 1.2k · Output 3.1k · Reasoning 900",
  )
  assert.equal(sessionTokenBreakdown(session, true), "In 12.4k · CR 84.2k · CW 1.2k · Out 3.1k · Think 900")
})

test("opens the session picker as a centered, width-capped dialog", () => {
  const calls: string[] = []
  let render: (() => unknown) | undefined
  const context = {
    ui: {
      router: { current: () => ({ type: "session", sessionID: "current" }) },
      dialog: {
        set: (options: unknown) => {
          calls.push("set")
          assert.deepEqual(options, { size: "xlarge", centered: true })
        },
        show: (next: () => unknown) => {
          calls.push("show")
          render = next
        },
      },
    },
  }

  assert.equal(showSessionPicker(context as never), undefined)
  assert.deepEqual(calls, ["show", "set"])
  assert.equal(typeof render, "function")
})

test("does not cover routes where the picker is unavailable", () => {
  let shown = false
  const context = {
    ui: {
      router: { current: () => ({ type: "plugin", name: "other" }) },
      dialog: { set: () => { shown = true }, show: () => { shown = true } },
    },
  }

  assert.equal(showSessionPicker(context as never), false)
  assert.equal(shown, false)
})
