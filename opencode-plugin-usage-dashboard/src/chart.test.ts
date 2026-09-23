import { expect, test } from "bun:test"
import { chart } from "./chart"

function days(year: number, month: number, first: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    from: new Date(year, month, first + index).getTime(),
    to: new Date(year, month, first + index + 1).getTime(),
  }))
}

test("week chart labels every bar's calendar day and keeps bars aligned", () => {
  const periods = days(2026, 8, 17, 7)
  const lines = chart([0, 1, 2, 3, 4, 5, 6], periods, 90, false, "7d")
  expect(lines).toHaveLength(11)
  expect(lines[0]).toContain("█")
  expect(lines[8]).toContain("└")
  expect(lines[9]!.slice(11).match(/17|18|19|20|21|22|23/g)).toEqual(["17", "18", "19", "20", "21", "22", "23"])
  expect(lines[10]).toContain("Sep")
  expect(lines.slice(0, 8).every((line) => line.slice(10, 20).trim() === "")).toBe(true)
})

test("hourly chart shows the precise start and end of each two-hour bar", () => {
  const start = new Date(2026, 8, 22, 7, 21).getTime()
  const periods = Array.from({ length: 12 }, (_, index) => ({ from: start + index * 7_200_000, to: start + (index + 1) * 7_200_000 }))
  const lines = chart(Array.from({ length: 12 }, () => 1), periods, 90, false, "24h")
  expect(lines[9]).toContain("7:21a")
  expect(lines[9]).toContain("9:21a")
  expect(lines[10]).toContain("9:21a")
  expect(lines[9]!.slice(11).match(/\d{1,2}:21[ap]/g)).toHaveLength(11)
  expect(lines[10]!.slice(11).match(/\d{1,2}:21[ap]/g)).toHaveLength(11)
})

test("month chart labels every date and marks the month change; narrow chart marks grouped ranges", () => {
  const periods = days(2026, 7, 25, 30)
  const values = periods.map((_, index) => index)
  const full = chart(values, periods, 90, false, "30d")
  expect(full[9]!.slice(11).match(/\d+/g)).toHaveLength(26)
  expect(full[11]).toContain("Aug")
  expect(full[11]).toContain("Sep")
  const narrow = chart(values, periods, 50, false, "30d")
  expect(narrow[10]!.slice(11).match(/\d+/g)!.length).toBeGreaterThan(0)
})
