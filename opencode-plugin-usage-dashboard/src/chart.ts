import { compact, money, type Range } from "./usage"

interface Period { from: number; to: number }

function hour(time: number, width: number) {
  const date = new Date(time)
  const hours = date.getHours() % 12 || 12
  const suffix = date.getHours() < 12 ? "a" : "p"
  const precise = `${hours}:${String(date.getMinutes()).padStart(2, "0")}${suffix}`
  return precise.length <= width ? precise : `${hours}${suffix}`
}

export function chart(values: readonly number[], periods: readonly Period[], width: number, cost: boolean, range: Range): string[] {
  if (!values.length) return []
  const height = 8
  const max = Math.max(...values, 1)
  const available = Math.max(12, width - 12)
  const hourly = range === "24h" || range === "today"
  const count = Math.min(values.length, Math.max(1, Math.floor(available / (hourly ? 7 : 3))))
  const columnWidth = Math.max(hourly ? 7 : 3, Math.min(12, Math.floor(available / count)))
  const bins = Array.from({ length: count }, (_, index) => {
    const from = Math.floor(index * values.length / count)
    const to = Math.floor((index + 1) * values.length / count)
    return {
      value: values.slice(from, to).reduce((sum, value) => sum + value, 0),
      from: periods[from]!.from,
      to: periods[to - 1]!.to,
    }
  })
  const axis = (value: number) => (cost ? money(value) : compact(value)).padStart(8)
  const rows = Array.from({ length: height }, (_, row) => {
    const level = height - row
    const tick = row === 0 ? axis(max) : row === height - 1 ? axis(max / height) : " ".repeat(8)
    return `${tick} │${bins.map((bin) => (bin.value >= max * level / height ? "█" : " ").repeat(columnWidth - 1) + " ").join("")}`
  })
  rows.push(`${axis(0)} └${"─".repeat(count * columnWidth)}`)

  const label = (value: string) => value.slice(0, columnWidth).padEnd(columnWidth)
  if (hourly) {
    rows.push(`     from  ${bins.map((bin) => label(hour(bin.from, columnWidth))).join("")}`)
    rows.push(`       to  ${bins.map((bin) => label(hour(bin.to, columnWidth))).join("")}`)
  } else {
    rows.push(`      day  ${bins.map((bin) => label(String(new Date(bin.from).getDate()))).join("")}`)
    const through = bins.map((bin) => {
      const end = new Date(bin.to - 1)
      const start = new Date(bin.from)
      return end.getDate() === start.getDate() && end.getMonth() === start.getMonth() ? "" : String(end.getDate())
    })
    if (through.some(Boolean)) rows.push(`  through  ${through.map(label).join("")}`)
    const months = Array.from({ length: count * columnWidth }, () => " ")
    bins.forEach((bin, index) => {
      const current = new Date(bin.from)
      const previous = index ? new Date(bins[index - 1]!.from) : undefined
      if (previous && current.getMonth() === previous.getMonth()) return
      const name = current.toLocaleString([], { month: "short" })
      for (let offset = 0; offset < name.length; offset++) months[index * columnWidth + offset] = name[offset]!
    })
    rows.push(`    month  ${months.join("")}`)
  }
  return rows
}
