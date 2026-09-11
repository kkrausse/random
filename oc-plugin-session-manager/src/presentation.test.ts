import { strict as assert } from "node:assert"
import { test } from "node:test"
import { showSessionPicker } from "./tui"

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
