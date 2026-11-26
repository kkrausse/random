import { apiFetch } from "./endpoint";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleDashed, CirclePause, CircleX, GitFork, Loader, MessageCircleQuestion, MessageSquareReply, SendHorizontal, SquareTerminal, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { age, canSend, HARNESS_LABEL, shortDir, STATUS_COLOR, STATUS_LABEL, tokens } from "./format.ts";
import { openSession } from "./router.ts";
import { loadTail, useTail } from "./tail-cache.ts";
import type { Machine, Session, Status } from "./types.ts";

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const Icon = { needs: MessageCircleQuestion, working: Loader, done: CircleCheck, failed: CircleX, interrupted: CirclePause, idle: CircleDashed }[status];
  return <Icon aria-label={STATUS_LABEL[status]} className={cn("size-4 shrink-0", STATUS_COLOR[status], status === "working" && "animate-spin [animation-duration:2.5s]", className)} />;
}

export function MachineChip({ machine, id }: { machine?: Machine; id: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium" style={{ color: machine?.color }}>
      <span className="size-1.5 rounded-full" style={{ background: machine?.color ?? "currentColor" }} />
      {machine?.short ?? id}
    </span>
  );
}

/** Markdown down to readable plain text for a preview. */
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "· ")
    .replace(/\s+/g, " ")
    .trim();

export function SessionCard({ session: s, machine, now, warm }: { session: Session; machine?: Machine; now: number; warm: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tail = useTail(s.key);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const archived = s.archived;

  // Previews load when the card comes into view, and again whenever the session changes.
  useEffect(() => {
    if (archived || !canSend(s) || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadTail(s), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [s.key, s.updatedAt, archived]);

  const lastAgent = tail?.messages?.findLast((m) => m.role === "agent");
  const lastUser = tail?.messages?.findLast((m) => m.role === "user");
  const preview = lastAgent ? plain(lastAgent.text) : undefined;

  const open = () => s.openable && openSession(s.key);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await apiFetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: s.key, text: body }) });
      const res = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as { ok: boolean; error?: string };
      if (res.ok) {
        toast.success(s.status === "working" ? "Queued after the current turn" : "Sent", { description: s.title });
        setText("");
        setReplying(false);
      } else {
        toast.error("Not sent", {
          description: res.error,
          action: s.openable ? { label: "Open", onClick: () => openSession(s.key) } : undefined,
          duration: 8000,
        });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        "group/card relative rounded-xl bg-card ring-1 ring-foreground/10 transition-colors",
        s.status === "needs" && !archived && "ring-amber-400/40",
        s.status === "failed" && !archived && "ring-red-400/30",
        archived && "bg-card/50",
      )}
    >
      <button
        type="button"
        className="block w-full p-3 pb-2 text-left active:bg-foreground/5 rounded-xl disabled:opacity-60"
        disabled={!s.openable}
        onPointerDown={() => s.openable && warm(s.key)}
        onClick={open}
      >
        <div className="flex items-start gap-2">
          <StatusIcon status={s.status} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={cn("min-w-0 flex-1 truncate font-medium", archived && "text-muted-foreground")}>{s.title || "(untitled)"}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{age(s.updatedAt, now)}</span>
            </div>
            {s.detail && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{s.detail}</p>}
            {!archived && preview && (
              <p className="mt-1.5 line-clamp-3 border-l-2 border-foreground/10 pl-2 text-[13px] leading-snug text-foreground/70">{preview}</p>
            )}
            {!archived && s.status === "working" && lastUser && !preview && (
              <p className="mt-1.5 line-clamp-2 text-[13px] text-foreground/60">“{plain(lastUser.text)}”</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 pr-8 text-xs text-muted-foreground">
              <MachineChip machine={machine} id={s.machine} />
              <span>{HARNESS_LABEL[s.harness]}</span>
              <span className="truncate max-w-[12rem]">{shortDir(s.cwd)}</span>
              {s.context && <span className="tabular-nums">{tokens(s.context.usedTokens)} tok</span>}
              {s.subagents && s.subagents.total > 0 && (
                <span className={cn("inline-flex items-center gap-0.5 tabular-nums", s.subagents.active > 0 && "text-sky-400")}>
                  <GitFork className="size-3" />
                  {s.subagents.active}/{s.subagents.total}
                </span>
              )}
              {s.background && (
                <span className="inline-flex items-center gap-0.5 text-sky-400/80" title={s.background.label}>
                  <SquareTerminal className="size-3" />
                  {s.background.count}
                </span>
              )}
              {s.tags.map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-px text-[11px]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </button>
      {!archived && canSend(s) && !replying && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-2 bottom-1.5 text-muted-foreground"
          aria-label="Reply"
          onClick={() => setReplying(true)}
        >
          <MessageSquareReply />
        </Button>
      )}
      {replying && (
        <div className="flex items-end gap-2 border-t border-border p-2">
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              if (e.key === "Escape") setReplying(false);
            }}
            placeholder={s.status === "working" ? "Queue a message…" : "Reply…"}
            rows={2}
            className="min-h-10 flex-1 resize-none text-base"
          />
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setReplying(false)}>
              <X />
            </Button>
            <Button size="icon" aria-label="Send" disabled={!text.trim() || sending} onClick={() => void send()}>
              {sending ? <Loader className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
