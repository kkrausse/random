#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

interface Account {
  name: string;
  codexHome: string;
}

interface Config {
  accounts: Account[];
  useOpenCode?: boolean;
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

interface RateLimit {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string } | null;
}

interface UsageResponse {
  accountId?: string | null;
  email?: string | null;
  planType?: string | null;
  rateLimits: RateLimit;
  rateLimitsByLimitId?: Record<string, RateLimit> | null;
  rateLimitResetCredits?: { availableCount?: number } | null;
}

interface AccountIdentity {
  email?: string;
  plan?: string;
}

interface AccountResult {
  account: { name: string; source: "codex" | "opencode"; location: string };
  identity: AccountIdentity;
  usage?: UsageResponse;
  error?: string;
}

const home = homedir();
const usageHome = expandHome(process.env.CODEX_USAGE_HOME ?? "~/.config/codex-usage");
const configPath = join(usageHome, "accounts.json");
const codexBin = process.env.CODEX_BIN ?? "codex";
const openCodeBin = process.env.OPENCODE_BIN ?? "opencode";

interface OpenCodeCredential {
  id: string;
  label: string;
  access: string;
  accountId: string;
}

function expandHome(path: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return resolve(path);
}

async function loadConfig(fallbackToCurrent = true): Promise<Config> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Config;
    return { accounts: parsed.accounts ?? [], useOpenCode: parsed.useOpenCode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return fallbackToCurrent
      ? {
          accounts: [
            {
              name: "current",
              codexHome: expandHome(process.env.CODEX_HOME ?? "~/.codex"),
            },
          ],
        }
      : { accounts: [] };
  }
}

async function saveConfig(config: Config): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
}

function openCodeDatabasePath(): string {
  if (process.env.OPENCODE_DB) return expandHome(process.env.OPENCODE_DB);
  const result = spawnSync(openCodeBin, ["debug", "paths", "db"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not locate the OpenCode database");
  const path = result.stdout.trim().split("\n").at(-1);
  if (!path) throw new Error("OpenCode returned an empty database path");
  return path;
}

export function readOpenCodeCredentials(): OpenCodeCredential[] {
  const databasePath = openCodeDatabasePath();
  const database = new Database(databasePath, { readonly: true });
  try {
    const rows = database
      .query("SELECT id, label, value FROM credential WHERE integration_id = ? ORDER BY label")
      .all("openai") as Array<{ id: string; label: string; value: string }>;
    return rows.flatMap((row) => {
      const value = JSON.parse(row.value);
      const access = value.access;
      const accountId = value.metadata?.accountID;
      return typeof access === "string" && typeof accountId === "string"
        ? [{ id: row.id, label: row.label, access, accountId }]
        : [];
    });
  } finally {
    database.close();
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function readIdentity(codexHome: string): Promise<AccountIdentity> {
  try {
    const auth = JSON.parse(await readFile(join(codexHome, "auth.json"), "utf8"));
    const claims = decodeJwtPayload(auth.tokens?.id_token ?? "");
    const openAiClaims = claims["https://api.openai.com/auth"] as
      | Record<string, unknown>
      | undefined;
    return {
      email: typeof claims.email === "string" ? claims.email : undefined,
      plan:
        typeof openAiClaims?.chatgpt_plan_type === "string"
          ? openAiClaims.chatgpt_plan_type
          : undefined,
    };
  } catch {
    return {};
  }
}

export async function fetchUsage(
  codexHome: string,
  timeoutMs = 20_000,
): Promise<UsageResponse> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
    delete env.OPENAI_API_KEY;

    const child = spawn(codexBin, ["app-server", "--stdio"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;

    const finish = (error?: Error, usage?: UsageResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.close();
      child.stdin.end();
      child.kill();
      if (error) rejectPromise(error);
      else resolvePromise(usage!);
    };

    const send = (message: object) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timer = setTimeout(
      () => finish(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) {
        finish(
          new Error(
            `Codex app-server exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      }
    });

    stdout.on("line", (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish(new Error(message.error.message ?? "Codex initialization failed"));
          return;
        }
        send({ method: "notifications/initialized", params: {} });
        send({
          method: "account/rateLimits/read",
          id: 2,
          params: { excludeResetCreditDetails: true },
        });
      } else if (message.id === 2) {
        if (message.error) {
          finish(new Error(message.error.message ?? "Could not read Codex usage"));
          return;
        }
        finish(undefined, message.result as UsageResponse);
      }
    });

    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "codex-usage", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function normalizeWindow(value: any): RateLimitWindow | null {
  if (!value) return null;
  return {
    usedPercent: value.used_percent,
    windowDurationMins: value.limit_window_seconds
      ? value.limit_window_seconds / 60
      : null,
    resetsAt: value.reset_at,
  };
}

function normalizeOpenCodeUsage(body: any): UsageResponse {
  const toLimit = (rateLimit: any, limitId: string, limitName?: string): RateLimit => ({
    limitId,
    limitName,
    planType: body.plan_type,
    primary: normalizeWindow(rateLimit?.primary_window),
    secondary: normalizeWindow(rateLimit?.secondary_window),
    credits:
      limitId === "codex" && body.credits
        ? {
            hasCredits: body.credits.has_credits,
            unlimited: body.credits.unlimited,
            balance: body.credits.balance,
          }
        : null,
  });
  const main = toLimit(body.rate_limit, "codex");
  const limits: Record<string, RateLimit> = { codex: main };
  if (body.code_review_rate_limit) {
    limits.code_review = toLimit(body.code_review_rate_limit, "code_review", "Code review");
  }
  for (const additional of body.additional_rate_limits ?? []) {
    const id = additional.metered_feature ?? additional.limit_name;
    if (id) limits[id] = toLimit(additional.rate_limit, id, additional.limit_name);
  }
  return {
    accountId: body.account_id,
    email: body.email,
    planType: body.plan_type,
    rateLimits: main,
    rateLimitsByLimitId: limits,
    rateLimitResetCredits: body.rate_limit_reset_credits
      ? { availableCount: body.rate_limit_reset_credits.available_count }
      : null,
  };
}

export async function fetchOpenCodeUsage(credential: OpenCodeCredential): Promise<UsageResponse> {
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${credential.access}`,
      "ChatGPT-Account-ID": credential.accountId,
    },
  });
  if (!response.ok) {
    const suffix = response.status === 401 ? "; use this account in OpenCode to refresh it" : "";
    throw new Error(`usage request returned HTTP ${response.status}${suffix}`);
  }
  return normalizeOpenCodeUsage(await response.json());
}

function durationLabel(minutes?: number | null): string {
  if (!minutes) return "limit";
  if (minutes % 10_080 === 0) return `${minutes / 10_080} week`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} day`;
  if (minutes % 60 === 0) return `${minutes / 60} hour`;
  return `${minutes} min`;
}

function timeUntil(timestamp?: number | null, now = Date.now()): string {
  if (!timestamp) return "reset unknown";
  const milliseconds = timestamp * 1000 - now;
  if (milliseconds <= 0) return "reset due";
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [days && `${days}d`, hours && `${hours}h`, !days && minutes && `${minutes}m`].filter(
    Boolean,
  );
  return `resets in ${parts.join(" ")}`;
}

export function formatWindow(window: RateLimitWindow): string {
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
  return `${durationLabel(window.windowDurationMins).padEnd(8)} ${String(remaining).padStart(3)}% left  ${timeUntil(window.resetsAt)}`;
}

function orderedLimits(usage: UsageResponse): RateLimit[] {
  const byId = usage.rateLimitsByLimitId;
  if (!byId || Object.keys(byId).length === 0) return [usage.rateLimits];
  return Object.entries(byId)
    .sort(([a], [b]) => (a === "codex" ? -1 : b === "codex" ? 1 : a.localeCompare(b)))
    .map(([, limit]) => limit);
}

function prettyLimitName(limit: RateLimit): string {
  const value = limit.limitName ?? limit.limitId ?? "Codex";
  if (value === "codex") return "Codex";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function printResult(result: AccountResult): void {
  const details = [result.identity.email, result.identity.plan].filter(Boolean).join(" · ");
  console.log(`\n${result.account.name}${details ? ` (${details})` : ""}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
    return;
  }

  const usage = result.usage!;
  for (const limit of orderedLimits(usage)) {
    const windows = [limit.primary, limit.secondary].filter(Boolean) as RateLimitWindow[];
    if (orderedLimits(usage).length > 1) console.log(`  ${prettyLimitName(limit)}`);
    for (const window of windows) console.log(`    ${formatWindow(window)}`);
    if (limit.credits?.unlimited) console.log("    Credits  unlimited");
    else if (limit.credits?.balance) console.log(`    Credits  ${limit.credits.balance}`);
  }
  const resets = usage.rateLimitResetCredits?.availableCount;
  if (resets !== undefined) console.log(`    Banked full resets: ${resets}`);
}

function printHelp(): void {
  console.log(`Usage:
  codex-usage [--json]                    Check every account
  codex-usage add <name> [codex-home]     Add an account (creates a dedicated home by default)
  codex-usage login <name>                Log into a configured account
  codex-usage use-opencode                Use every OpenAI account saved in OpenCode
  codex-usage list                        List configured accounts
  codex-usage remove <name>               Forget an account (does not delete its files)

First-time setup:
  codex-usage add main ~/.codex
  codex-usage add second
  codex-usage login second

Or reuse existing OpenCode logins:
  codex-usage use-opencode`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "add") {
    const name = args[1];
    if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error("Account name is required and may only contain letters, numbers, ., _, and -");
    }
    const config = await loadConfig(false);
    if (config.accounts.some((account) => account.name === name)) {
      throw new Error(`Account '${name}' already exists`);
    }
    const codexHome = expandHome(args[2] ?? join(usageHome, "accounts", name));
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    config.accounts.push({ name, codexHome });
    config.useOpenCode = false;
    await saveConfig(config);
    console.log(`Added ${name}: ${codexHome}`);
    try {
      await readFile(join(codexHome, "auth.json"));
    } catch {
      console.log(`Next: codex-usage login ${name}`);
    }
    return;
  }

  if (command === "remove") {
    const name = args[1];
    const config = await loadConfig(false);
    const next = config.accounts.filter((account) => account.name !== name);
    if (next.length === config.accounts.length) throw new Error(`Unknown account '${name}'`);
    await saveConfig({ accounts: next });
    console.log(`Removed ${name} from the list (its files were not deleted).`);
    return;
  }

  if (command === "list") {
    const config = await loadConfig();
    if (config.useOpenCode) {
      for (const credential of readOpenCodeCredentials()) {
        console.log(`${credential.label}\tOpenCode (${credential.id})`);
      }
      return;
    }
    for (const account of config.accounts) console.log(`${account.name}\t${account.codexHome}`);
    return;
  }

  if (command === "use-opencode") {
    const credentials = readOpenCodeCredentials();
    if (credentials.length === 0) throw new Error("No OpenAI accounts are saved in OpenCode");
    await saveConfig({ accounts: [], useOpenCode: true });
    console.log(`Using ${credentials.length} OpenCode OpenAI account${credentials.length === 1 ? "" : "s"}.`);
    return;
  }

  if (command === "login") {
    const name = args[1];
    const config = await loadConfig();
    const account = config.accounts.find((candidate) => candidate.name === name);
    if (!account) throw new Error(`Unknown account '${name}'`);
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: account.codexHome };
    delete env.OPENAI_API_KEY;
    const result = spawnSync(codexBin, ["login"], { env, stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command && command !== "--json") {
    throw new Error(`Unknown command '${command}'`);
  }

  const config = await loadConfig();
  let results: AccountResult[];
  if (config.useOpenCode) {
    const credentials = readOpenCodeCredentials();
    if (credentials.length === 0) throw new Error("No OpenAI accounts are saved in OpenCode");
    results = await Promise.all(
      credentials.map(async (credential): Promise<AccountResult> => {
        const account = {
          name: credential.label,
          source: "opencode" as const,
          location: credential.id,
        };
        try {
          const usage = await fetchOpenCodeUsage(credential);
          return {
            account,
            identity: { email: usage.email ?? undefined, plan: usage.planType ?? undefined },
            usage,
          };
        } catch (error) {
          return { account, identity: {}, error: (error as Error).message };
        }
      }),
    );
  } else {
    if (config.accounts.length === 0) {
      throw new Error("No accounts configured. Run codex-usage add <name>.");
    }
    results = await Promise.all(
      config.accounts.map(async (configured): Promise<AccountResult> => {
        const account = {
          name: configured.name,
          source: "codex" as const,
          location: configured.codexHome,
        };
        const identity = await readIdentity(configured.codexHome);
        try {
          return { account, identity, usage: await fetchUsage(configured.codexHome) };
        } catch (error) {
          return { account, identity, error: (error as Error).message };
        }
      }),
    );
  }

  if (command === "--json") console.log(JSON.stringify(results, null, 2));
  else for (const result of results) printResult(result);
  if (results.some((result) => result.error)) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`codex-usage: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
