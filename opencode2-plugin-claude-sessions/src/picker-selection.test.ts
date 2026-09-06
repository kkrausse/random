import { strict as assert } from "node:assert"
import { test } from "node:test"
import { sectionNeighbor } from "./picker-selection"

test("lifecycle navigation stays in the displayed section, preferring down", () => {
  const options = [
    { value: "new", state: "new" },
    { value: "p", state: "permission" },
    { value: "q", state: "question" },
    { value: "a", state: "idle" },
    { value: "b", state: "idle" },
    { value: "c", state: "idle" },
    { value: "i", state: "inactive" },
  ] as const
  assert.equal(sectionNeighbor(options, "a"), "b")
  assert.equal(sectionNeighbor(options, "b"), "c")
  assert.equal(sectionNeighbor(options, "c"), "b")
  assert.equal(sectionNeighbor(options, "p"), "q")
  assert.equal(sectionNeighbor(options, "q"), "a")
  assert.equal(sectionNeighbor(options, "i"), undefined)
  assert.equal(sectionNeighbor(options, "missing"), undefined)
})
