import { compact, money } from "./usage"

export function chart(values: readonly number[], labels: readonly string[], width: number, cost: boolean): string[] {
  if (!values.length) return []
  const height = 8
  const max = Math.max(...values, 1)
  const available = Math.max(12, width - 12)
  const count = Math.min(values.length, Math.max(1, Math.floor(available / 2)))
  const columnWidth = Math.max(2, Math.min(12, Math.floor(available / count)))
  const bars = Array.from({ length: count }, (_, index) => {
    const from = Math.floor(index * values.length / count)
    const to = Math.floor((index + 1) * values.length / count)
    return values.slice(from, to).reduce((sum, value) => sum + value, 0)
  })
  const axis = (value: number) => (cost ? money(value) : compact(value)).padStart(8)
  const rows = Array.from({ length: height }, (_, row) => {
    const level = height - row
    const tick = row === 0 ? axis(max) : row === height - 1 ? axis(max / height) : " ".repeat(8)
    return `${tick} │${bars.map((value) => (value >= max * level / height ? "█" : " ").repeat(columnWidth - 1) + " ").join("")}`
  })
  rows.push(`${axis(0)} └${"─".repeat(count * columnWidth)}`)
  const first = labels[0] ?? ""
  const middle = labels[Math.floor(labels.length / 2)] ?? ""
  const last = labels.at(-1) ?? ""
  const space = count * columnWidth
  const mid = Math.max(first.length + 1, Math.floor(space / 2) - Math.floor(middle.length / 2))
  const end = Math.max(mid + middle.length + 1, space - last.length)
  rows.push(`           ${first.padEnd(mid)}${middle.padEnd(end - mid)}${last}`)
  return rows
}
