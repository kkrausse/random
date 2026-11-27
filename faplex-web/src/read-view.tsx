// The reading view (inside Walks only; faplex's own site keeps the terminal): a session's messages
// as plain page text, from `faplex tail --json` via /api/messages. Scrolling and selecting are the
// phone's own, so far from diesel2 they cost no round trips, and text can be copied. Fetched again
// whenever the session changes. Prompts, menus and questions still need the terminal: the session
// screen switches there when the session needs input.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Loader } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "./clipboard";
import { apiFetch } from "./endpoint";
import { cn } from "@/lib/utils";
import type { Session } from "./types.ts";

type Message = { role: "user" | "agent"; at: number; text: string };
export type Pending = { text: string; at: number };

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export function ReadView({ sessionKey, session, pending, onSeen }: {
  sessionKey: string; session: Session | undefined; pending: Pending[]; onSeen: (p: Pending) => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // at the bottom: stay there as messages arrive
  const loading = useRef(false);
  const again = useRef(false);

  const load = async () => {
    if (loading.current) { again.current = true; return; }
    loading.current = true;
    try {
      const r = await apiFetch(`/api/messages?key=${encodeURIComponent(sessionKey)}`);
      const body = (await r.json()) as { messages: Message[]; error?: string };
      if (!r.ok || body.error) setError(body.error ?? `HTTP ${r.status}`);
      else { setError(null); setMessages(body.messages); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      loading.current = false;
      if (again.current) { again.current = false; void load(); }
    }
  };
  useEffect(() => { void load(); }, [sessionKey, session?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sent message shows at once; it goes when the transcript has it.
  useEffect(() => {
    for (const p of pending) if (messages?.some((m) => m.role === "user" && m.at >= p.at - 10_000 && same(m.text, p.text))) onSeen(p);
  }, [messages, pending, onSeen]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending.length, session?.status, session?.detail]);

  // The keyboard coming up shrinks the view: stay on the newest message if that's where you were.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const working = session?.status === "working";
  return (
    <div ref={scroller} className="read-view absolute inset-0 overflow-y-auto overscroll-contain bg-background px-3 pt-3 pb-4 select-text"
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {messages === null && !error && <div className="grid h-full place-items-center"><Loader className="size-5 animate-spin text-muted-foreground" /></div>}
      {error && <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">Can't read the messages: {error}. The terminal (top right) still works.</p>}
      {messages && !messages.length && !error && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      <div className="flex flex-col gap-4">
        {messages?.map((m, i) => <MessageBlock key={`${m.at}-${i}`} m={m} />)}
        {pending.map((p) => <MessageBlock key={`p-${p.at}`} m={{ role: "user", at: p.at, text: p.text }} sending />)}
      </div>
      {working && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 shrink-0 animate-spin" /><span className="truncate">{session?.detail || "Working…"}</span>
        </div>
      )}
    </div>
  );
}

const time = (ms: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

function MessageBlock({ m, sending }: { m: Message; sending?: boolean }) {
  if (m.role === "user") return (
    <div className="flex flex-col items-end">
      <div className={cn("max-w-[88%] rounded-2xl rounded-br-md bg-primary/15 px-3 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words", sending && "opacity-60")}>{m.text}</div>
      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">{!sending && <CopyButton text={m.text} />}{sending ? "sending…" : time(m.at)}</span>
    </div>
  );
  return (
    <div className="text-[15px] leading-relaxed break-words">
      <Markdown text={m.text} />
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{time(m.at)}<CopyButton text={m.text} /></span>
    </div>
  );
}

// The whole message, as written (Markdown and all): selecting a long reply by hand is fiddly.
function CopyButton({ text }: { text: string }) {
  return (
    <button type="button" aria-label="Copy message" className="-my-1 rounded p-1.5 text-muted-foreground active:bg-muted"
      onClick={() => copyText(text).then(() => toast.success("Copied", { duration: 1200 }), (e) => toast.error("Copy failed", { description: String(e) }))}>
      <Copy className="size-3.5" />
    </button>
  );
}

// A small Markdown subset, built as React nodes (no HTML strings): paragraphs, headings, lists,
// fenced code, tables (as monospace), and inline bold, code and links.
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) out.push(<p key={out.length} className="mb-2">{inline(para.join(" "))}</p>); para.length = 0; };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) body.push(lines[i]!);
      i++;
      out.push(<pre key={out.length} className="mb-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-snug">{body.join("\n")}</pre>);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      const rows: string[] = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]!); i++) rows.push(lines[i]!);
      out.push(<Table key={out.length} rows={rows} />);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(<p key={out.length} className="mt-1 mb-1.5 font-semibold">{inline(h[2]!)}</p>); i++; continue; }
    const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const items: { depth: number; mark: string; text: string }[] = [];
      for (let m; i < lines.length && (m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i]!)); i++) items.push({ depth: Math.min(3, Math.floor(m[1]!.length / 2)), mark: /\d/.test(m[2]!) ? m[2]! : "•", text: m[3]! });
      out.push(
        <div key={out.length} className="mb-2 flex flex-col gap-1">
          {items.map((it, k) => (
            <div key={k} className="flex gap-1.5" style={{ paddingLeft: `${it.depth * 1}rem` }}>
              <span className="shrink-0 text-muted-foreground">{it.mark}</span><span className="min-w-0">{inline(it.text)}</span>
            </div>
          ))}
        </div>,
      );
      continue;
    }
    if (!line.trim()) flush(); else para.push(line.trim());
    i++;
  }
  flush();
  return <>{out}</>;
}

function Table({ rows }: { rows: string[] }) {
  const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  return (
    <div className="mb-2 overflow-x-auto">
      <table className="text-sm">
        <tbody>
          {cells.map((r, k) => (
            <tr key={k} className={cn("border-b border-border/60 align-top", k === 0 && "font-semibold")}>
              {r.map((c, j) => <td key={j} className="py-1 pr-3">{inline(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)<>]+)/g;
  let last = 0;
  for (let m; (m = re.exec(s)); ) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const k = parts.length;
    if (m[1]) parts.push(<code key={k} className="rounded bg-muted px-1 font-mono text-[0.85em]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) parts.push(<a key={k} href={m[4]} target="_blank" rel="noreferrer" className="text-sky-400 underline">{m[3].slice(1, m[3].indexOf("]"))}</a>);
    else if (m[5]) parts.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer" className="break-all text-sky-400 underline">{m[5]}</a>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <Fragment>{parts}</Fragment>;
}
