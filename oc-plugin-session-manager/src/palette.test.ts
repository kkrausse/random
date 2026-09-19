import { strict as assert } from "node:assert"
import { test } from "node:test"
import { sessionManagerPalette } from "./palette"

test("adapts current OpenCode theme roles behind the plugin palette", () => {
  const palette = sessionManagerPalette({
    text: { base: "text", muted: "muted", feedback: { error: { base: "error" }, warning: { base: "warning" }, info: { base: "info" } } },
    background: { base: "background", raised: { base: "surface", high: "raised" } },
    border: { base: "border" },
  })

  assert.deepEqual(palette, {
    text: "text", muted: "muted", surface: "surface", surfaceRaised: "raised", border: "border",
    selected: "#fde047", selectedText: "background", error: "error", permission: "warning", question: "info",
  })
})

test("adapts the previous theme shape and safely falls back without a theme", () => {
  const previous = sessionManagerPalette({
    text: { default: "text", subdued: "muted", status: { permission: "permission", question: "question" }, feedback: { error: { default: "error" } } },
    contextual: { overlay: { background: { default: "surface", surface: { offset: "raised" } }, scrollbar: { default: "border" } } },
  })
  assert.equal(previous.surfaceRaised, "raised")
  assert.equal(previous.permission, "permission")
  assert.equal(previous.question, "question")
  assert.equal(previous.error, "error")

  const fallback = sessionManagerPalette(undefined)
  assert.equal(fallback.text, "#e4e4e7")
  assert.equal(fallback.surfaceRaised, "#3f3f46")
  assert.equal(fallback.selected, "#fde047")
})
