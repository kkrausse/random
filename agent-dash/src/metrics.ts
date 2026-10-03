import type { ContextUsage, Subagents } from "./session.ts";

export type AgentNode = { id: string; parentId?: string | null; active: boolean };

/** All descendants, like the session-manager picker; IDs are counted once, even in bad graphs. */
export function subagentSummary(nodes: readonly AgentNode[], rootId: string, complete: boolean): Subagents {
  const children = new Map<string, AgentNode[]>();
  for (const node of nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const seen = new Set([rootId]);
  const todo = [...(children.get(rootId) ?? [])];
  let total = 0, active = 0;
  while (todo.length) {
    const node = todo.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    total++;
    if (node.active) active++;
    todo.push(...(children.get(node.id) ?? []));
  }
  return { total, active, complete };
}

export const contextPercent = (usage: ContextUsage) =>
  usage.limitTokens && usage.limitTokens > 0 ? Math.round(usage.usedTokens / usage.limitTokens * 100) : undefined;

export function subagentLabel(s: Subagents) {
  if (!s.total) return "";
  return `${s.complete ? "" : "≥"}${s.total} subagent${s.total === 1 ? "" : "s"}${s.active ? ` (${s.active} active)` : ""}`;
}

export function contextLabel(usage: ContextUsage) {
  const percent = contextPercent(usage);
  const tokens = usage.usedTokens >= 1000 ? `${(usage.usedTokens / 1000).toFixed(1)}k` : `${Math.round(usage.usedTokens)}`;
  return percent !== undefined ? `${percent}% ctx` : `${tokens} ctx`;
}

export type UsageMessage = {
  id: string;
  type: string;
  status?: string;
  time?: { created: number; completed?: number };
  model?: { id: string; providerID: string };
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
};

/** Newest-first messages. Never reuse pre-compaction or reverted usage. */
export function latestContext(messages: readonly UsageMessage[], boundary?: string) {
  let beforeBoundary = !boundary;
  for (const message of messages) {
    if (!beforeBoundary) {
      if (message.id === boundary) beforeBoundary = true;
      continue;
    }
    if (message.type === "compaction" && message.status === "completed") return undefined;
    if (message.type !== "assistant" || !message.tokens || !message.model || !message.time) continue;
    const t = message.tokens;
    const usedTokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write;
    if (!Number.isFinite(usedTokens) || usedTokens <= 0) continue;
    return { usedTokens, measuredAt: message.time.completed ?? message.time.created, model: message.model };
  }
  return undefined;
}
