import { Database } from "bun:sqlite"
import { execFile, spawn } from "node:child_process"
import { createInterface } from "node:readline"

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

export function loadCodexCliUsage(): Promise<CodexAccount[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.OPENAI_API_KEY
    const child = spawn(process.env.CODEX_BIN ?? "codex", ["app-server", "--stdio"], {
      env, stdio: ["pipe", "pipe", "pipe"],
    })
    const lines = createInterface({ input: child.stdout })
    let settled = false
    let identity: CodexAccount["identity"] = {}
    const timer = setTimeout(() => finish(new Error("Codex usage timed out after 20s")), 20_000)
    function finish(error?: Error, usage?: CodexAccount["usage"]) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      lines.close()
      child.stdin.end()
      child.kill()
      if (error) reject(error)
      else resolve([{ account: { name: identity?.email ?? "Codex", source: "codex" }, identity, usage }])
    }
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
    // Drain diagnostics, but never surface potentially sensitive server logs.
    child.stderr.resume()
    child.stdin.on("error", () => finish(new Error("Codex app-server connection closed")))
    child.on("error", (error: NodeJS.ErrnoException) => finish(new Error(
      error.code === "ENOENT" ? "Codex CLI is not installed" : "Could not start Codex app-server",
    )))
    child.on("exit", () => finish(new Error("Codex app-server exited before returning usage")))
    lines.on("line", (line) => {
      let message: { id?: number; error?: { message?: string }; result?: unknown }
      try {
        message = JSON.parse(line)
      } catch { return }
      if (settled || ![1, 2, 3].includes(message.id ?? 0)) return
      if (message.error) return finish(new Error(message.error.message ?? "Could not read Codex usage"))
      if (message.id === 1) {
        send({ method: "initialized", params: {} })
        send({ method: "account/read", id: 2, params: { refreshToken: false } })
      } else if (message.id === 2) {
        const result = message.result as { account?: { type?: string; email?: string; planType?: string } | null } | undefined
        if (result?.account?.type !== "chatgpt") return finish(new Error("Run codex login with a ChatGPT account to show allowances"))
        identity = { email: result.account.email, plan: result.account.planType }
        send({ method: "account/rateLimits/read", id: 3, params: {} })
      } else {
        const usage = message.result as CodexAccount["usage"]
        if (!usage || (!usage.rateLimits && !usage.rateLimitsByLimitId)) return finish(new Error("Unexpected Codex usage response"))
        finish(undefined, usage)
      }
    })
    send({ method: "initialize", id: 1, params: {
      clientInfo: { name: "opencode_usage_dashboard", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    } })
  })
}

interface Credential {
  label: string
  access: string
  accountId: string
}

async function openCodeCredentials(): Promise<Credential[]> {
  const path = process.env.OPENCODE_DB ?? await new Promise<string>((resolve, reject) => {
    execFile(process.env.OPENCODE_BIN ?? "opencode", ["debug", "paths", "db"], {
      encoding: "utf8", timeout: 10_000,
    }, (error, stdout) => {
      const path = stdout.trim().split("\n").at(-1)
      if (error || !path) reject(new Error("Could not locate OpenCode accounts"))
      else resolve(path)
    })
  })
  // The CLI client exposes connection metadata, not tokens. Keep the existing
  // multi-account behavior using a read-only connection; never activate accounts.
  const db = new Database(path, { readonly: true })
  try {
    const rows = db.query("SELECT label, value FROM credential WHERE integration_id = ? ORDER BY label")
      .all("openai") as { label: string; value: string }[]
    return rows.flatMap((row) => {
      const value = JSON.parse(row.value)
      return typeof value.access === "string" && typeof value.metadata?.accountID === "string"
        ? [{ label: row.label, access: value.access, accountId: value.metadata.accountID }] : []
    })
  } finally { db.close() }
}

interface UsageBody {
  plan_type?: string
  email?: string
  rate_limit?: RawLimit
  code_review_rate_limit?: RawLimit
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string | null }
  additional_rate_limits?: { metered_feature?: string; limit_name?: string; rate_limit?: RawLimit }[]
  rate_limit_reset_credits?: { available_count?: number }
}

interface RawLimit {
  primary_window?: RawWindow | null
  secondary_window?: RawWindow | null
}

interface RawWindow {
  used_percent?: number
  limit_window_seconds?: number | null
  reset_at?: number | null
}

export function normalizeOpenCodeUsage(body: UsageBody): CodexAccount["usage"] {
  const window = (value?: RawWindow | null): Window | null => value ? {
    usedPercent: value.used_percent,
    windowDurationMins: value.limit_window_seconds ? value.limit_window_seconds / 60 : null,
    resetsAt: value.reset_at,
  } : null
  const limit = (value: RawLimit | undefined, id: string, name?: string): Limit => ({
    limitId: id, limitName: name,
    primary: window(value?.primary_window), secondary: window(value?.secondary_window),
  })
  const main = limit(body.rate_limit, "codex")
  if (body.credits) main.credits = {
    hasCredits: body.credits.has_credits, unlimited: body.credits.unlimited, balance: body.credits.balance,
  }
  const limits: Record<string, Limit> = { codex: main }
  if (body.code_review_rate_limit) limits.code_review = limit(body.code_review_rate_limit, "code_review", "Code review")
  for (const extra of body.additional_rate_limits ?? []) {
    const id = extra.metered_feature ?? extra.limit_name
    if (id) limits[id] = limit(extra.rate_limit, id, extra.limit_name)
  }
  return {
    planType: body.plan_type, rateLimits: main, rateLimitsByLimitId: limits,
    rateLimitResetCredits: body.rate_limit_reset_credits ? { availableCount: body.rate_limit_reset_credits.available_count } : null,
  }
}

export async function loadCodexUsage(): Promise<CodexAccount[]> {
  let credentials: Credential[]
  try { credentials = await openCodeCredentials() } catch { credentials = [] }
  // OpenCode accounts take precedence, preserving the previous use-opencode
  // setup. Without saved OAuth accounts (e.g. diesel2), use Codex's own login.
  if (!credentials.length) return loadCodexCliUsage()
  return Promise.all(credentials.map(async (credential): Promise<CodexAccount> => {
    const account = { name: credential.label, source: "opencode" }
    try {
      const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: { Authorization: `Bearer ${credential.access}`, "ChatGPT-Account-ID": credential.accountId },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`Usage request returned HTTP ${response.status}${response.status === 401 ? "; use this account in OpenCode to refresh it" : ""}`)
      const body = await response.json() as UsageBody
      return { account, identity: { email: body.email, plan: body.plan_type }, usage: normalizeOpenCodeUsage(body) }
    } catch (error) {
      return { account, error: error instanceof Error ? error.message : "Could not read usage" }
    }
  }))
}
