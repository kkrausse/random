import { expect, test } from "bun:test"
import { chart } from "./chart"

test("a week chart uses the available width, includes an axis and labels, and distinguishes zero", () => {
  const lines = chart([0, 1, 2, 3, 4, 5, 6], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], 90, false)
  expect(lines).toHaveLength(10)
  expect(lines[0]).toContain("█")
  expect(lines[0]!.length).toBeGreaterThan(70)
  expect(lines[8]).toContain("└")
  expect(lines[9]).toContain("Sun")
  expect(lines.slice(0, 8).every((line) => line.slice(10, 20).trim() === "")).toBe(true)
})
