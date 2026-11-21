import type { TailMessage } from "./types.ts";

// `faplex tail` prints each message as "── <role> · <MM-DD HH:MM>\n<text>\n\n".
export function parseTail(out: string): TailMessage[] {
  const messages: TailMessage[] = [];
  for (const block of out.split(/^── /m).slice(1)) {
    const nl = block.indexOf("\n");
    const head = nl === -1 ? block : block.slice(0, nl);
    const [role, at] = head.split(" · ");
    messages.push({ role: role === "user" ? "user" : "agent", at: at?.trim() ?? "", text: (nl === -1 ? "" : block.slice(nl + 1)).trim() });
  }
  return messages;
}
