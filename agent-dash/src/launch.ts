// Starting a new session: each harness opens its own native new chat, so model, mode and other
// config stay in the harness's UI.
import type { Provider, Session } from "./session.ts";

/** What to run in the pane, and how to recognize the new session once the poller sees it. */
export type Launch = { cmd: string[]; cwd: string; claim: (s: Session) => boolean };

export async function launch(h: Provider, dir: string, known: ReadonlySet<string>): Promise<Launch> {
  // Codex and OpenCode create the session on the first prompt; the first new one in this dir is ours.
  const firstNew = (s: Session) => s.provider === h && s.cwd === dir && !known.has(s.key);
  if (h === "codex") return { cmd: ["codex", "-C", dir], cwd: dir, claim: firstNew };
  if (h === "opencode") return { cmd: ["opencode", dir], cwd: dir, claim: firstNew };

  // Claude: an idle background session ("send a prompt to start"), so it stays attachable.
  const p = Bun.spawn(["claude", "--bg"], { cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  const id = out.replace(/\x1b\[[0-9;]*m/g, "").match(/backgrounded · (\w+)/)?.[1];
  if (!id) throw new Error(out.trim().split("\n")[0] || "claude --bg printed no id");
  return { cmd: ["claude", "attach", id], cwd: dir, claim: (s) => s.provider === "claude" && s.id === id };
}
