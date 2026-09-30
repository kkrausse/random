import { execFile } from "node:child_process"

interface Window {
  usedPercent?: number | null
  windowDurationMins?: number | null
  resetsAt?: number | null
}

interface Limit {
  limitId?: string | null
  limitName?: string | null
  primary?: Window | null
  secondary?: Window | null
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string | null } | null
}

export interface CodexAccount {
  account: { name: string; source: string }
  identity?: { plan?: string; email?: string }
  usage?: {
    planType?: string | null
    rateLimits?: Limit | null
    rateLimitsByLimitId?: Record<string, Limit> | null
    rateLimitResetCredits?: { availableCount?: number } | null
  }
  error?: string
}

export function accountLimits(account: CodexAccount) {
  const byId = account.usage?.rateLimitsByLimitId
  if (byId && Object.keys(byId).length) return Object.entries(byId).map(([id, limit]) => ({ id, ...limit }))
  const limit = account.usage?.rateLimits
  return limit ? [{ id: limit.limitId ?? "codex", ...limit }] : []
}

export function windowLabel(window: Window) {
  const minutes = window.windowDurationMins
  if (!minutes || minutes <= 0) return "Usage"
  if (minutes === 7 * 24 * 60) return "Weekly"
  if (minutes === 24 * 60) return "Daily"
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day`
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

export function limitWindowLabel(limit: { id: string; limitName?: string | null }, window: Window) {
  const name = limit.limitName ?? (limit.id === "code_review" ? "Code review" : limit.id)
  return `${name === "codex" ? "Codex" : name} ${windowLabel(window)}`
}

export function accountCredits(account: CodexAccount) {
  const credits = account.usage?.rateLimits?.credits
    ?? accountLimits(account).find((limit) => limit.id === "codex")?.credits
  if (credits?.unlimited) return "Unlimited"
  if (credits?.balance != null && credits.balance.trim()) return credits.balance
  if (credits?.hasCredits) return "Available"
  if (credits?.hasCredits === false) return "None"
  return "–"
}

export function loadCodexUsage(): Promise<CodexAccount[]> {
  return new Promise((resolve, reject) => {
    execFile("codex-usage", ["--json"], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return reject(new Error(error.code === "ENOENT" ? "codex-usage is not installed" : "codex-usage could not load accounts"))
      try {
        const value: unknown = JSON.parse(stdout)
        if (!Array.isArray(value)) throw new Error("Unexpected codex-usage output")
        resolve(value as CodexAccount[])
      } catch {
        reject(new Error("Unexpected codex-usage output"))
      }
    })
  })
}
