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
