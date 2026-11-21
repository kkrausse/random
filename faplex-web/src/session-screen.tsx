import { useEffect, useRef, useState } from "react";
import { ALargeSmall, ChevronLeft, CornerDownLeft, EllipsisVertical, Keyboard, Loader, RotateCw, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HARNESS_LABEL, STATUS_LABEL } from "./format.ts";
import type { useLive } from "./live.ts";
import { goBack } from "./router.ts";
import { MachineChip, StatusIcon } from "./session-card.tsx";
import { mountTerminal, type MountedTerminal } from "./terminal.ts";

type Conn = "starting" | "connecting" | "open" | "waiting" | "offline";

const KEYS: { label: string; title: string; key?: string; shift?: boolean; bytes?: string }[] = [
  { label: "esc", title: "Escape", key: "Escape" },
  { label: "⇥", title: "Tab", key: "Tab" },
  { label: "⇧⇥", title: "Shift+Tab", key: "Tab", shift: true },
  { label: "↑", title: "Up", key: "ArrowUp" },
  { label: "↓", title: "Down", key: "ArrowDown" },
  { label: "←", title: "Left", key: "ArrowLeft" },
  { label: "→", title: "Right", key: "ArrowRight" },
  { label: "^C", title: "Ctrl+C", bytes: "\x03" },
  { label: "⏎", title: "Enter", key: "Enter" },
];

const FONT_KEY = "faplex-web.fontSize";
const NOT_LISTED = "is not a session this watch lists";

export function SessionScreen({ sessionKey, live }: { sessionKey: string; live: ReturnType<typeof useLive> }) {
  const session = live.state?.sessions.find((s) => s.key === sessionKey);
  const machine = live.state?.machines.find((m) => m.id === session?.machine);
  const screenRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const term = useRef<MountedTerminal>(undefined);
  const [conn, setConn] = useState<Conn>("starting");
  const [typing, setTyping] = useState<"none" | "compose" | "raw">("none");
  const [text, setText] = useState("");
  const listed = !!session?.openable;
  const listedRef = useRef(listed);
  listedRef.current = listed;

  // Size the screen to the visual viewport, so the composer rides on top of the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const layout = () => {
      const el = screenRef.current;
      if (!el) return;
      el.style.height = `${vv ? vv.height : window.innerHeight}px`;
      el.style.top = `${vv && Math.abs(vv.scale - 1) < 0.01 ? vv.offsetTop : 0}px`;
    };
    layout();
    vv?.addEventListener("resize", layout);
    vv?.addEventListener("scroll", layout);
    window.addEventListener("resize", layout);
    return () => {
      vv?.removeEventListener("resize", layout);
      vv?.removeEventListener("scroll", layout);
      window.removeEventListener("resize", layout);
    };
  }, []);

  // The terminal, and its connection to the client faplex keeps for this session.
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | undefined;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitingSince = 0;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const send = (data: string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    };

    const connect = () => {
      clearTimeout(timer);
      const t = term.current;
      if (disposed || !t || (ws && ws.readyState <= WebSocket.OPEN)) return;
      // A session just started may not be in watch's list yet.
      if (!listedRef.current) {
        setConn("waiting");
        timer = setTimeout(connect, 500);
        return;
      }
      setConn("connecting");
      const { cols, rows } = t.terminal;
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/term?key=${encodeURIComponent(sessionKey)}&cols=${cols}&rows=${rows}`);
      socket.binaryType = "arraybuffer";
      ws = socket;
      let head = "";
      socket.onopen = () => {
        retry = 0;
        setConn("open");
      };
      socket.onmessage = (e) => {
        const bytes = new Uint8Array(e.data as ArrayBuffer);
        if (head.length < 200) head += decoder.decode(bytes, { stream: true });
        t.terminal.write(bytes);
      };
      socket.onclose = (e) => {
        if (ws === socket) ws = undefined;
        if (disposed) return;
        if (e.code === 4000) {
          // faplex ended it. Either the session isn't listed yet (retry a while), or it was left:
          // ctrl+], ← at an empty prompt, or opened on another screen.
          if (head.includes(NOT_LISTED) && (waitingSince ||= Date.now()) > Date.now() - 20_000) {
            setConn("waiting");
            t.terminal.write("\x1bc");
            timer = setTimeout(connect, 1000);
            return;
          }
          goBack();
          return;
        }
        setConn("offline");
        if (!document.hidden) timer = setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
      };
    };

    void (async () => {
      const host = hostRef.current!;
      const saved = Number(localStorage.getItem(FONT_KEY)) || undefined;
      try {
        const t = await mountTerminal(host, {
          fontSize: saved,
          input: send,
          resize: (cols, rows) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ resize: { cols, rows } })),
          rawFocus: (focused) => setTyping((v) => (focused ? "raw" : v === "raw" ? "none" : v)),
        });
        if (disposed) return t.dispose();
        term.current = t;
        connect();
      } catch (e) {
        toast.error("Terminal failed to start", { description: e instanceof Error ? e.message : String(e) });
      }
    })();

    const wake = () => {
      if (document.hidden) return;
      retry = 0;
      connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    reconnectRef.current = () => {
      ws?.close();
      ws = undefined;
      retry = 0;
      term.current?.terminal.write("\x1bc");
      connect();
    };
    sendRef.current = send;
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      ws?.close(1000);
      term.current?.dispose();
      term.current = undefined;
    };
  }, [sessionKey]);

  const reconnectRef = useRef<() => void>(() => {});
  const sendRef = useRef<(d: string) => void>(() => {});

  const pressKey = (k: (typeof KEYS)[number]) => {
    const t = term.current;
    if (!t) return;
    if (k.bytes) return sendRef.current(k.bytes);
    t.key(k.key!, { shiftKey: k.shift });
  };

  const submit = () => {
    const t = term.current;
    if (!t) return;
    const body = text.replace(/\s+$/, "");
    if (body) {
      // Pasted, so the harness takes newlines as text; then Enter once it has drawn it.
      t.terminal.paste(body);
      setTimeout(() => sendRef.current("\r"), 120);
      setText("");
      composerRef.current?.blur();
    } else sendRef.current("\r");
  };

  const fontStep = (d: number) => {
    const t = term.current;
    if (!t) return;
    const next = Math.max(8, Math.min(24, t.fontSize() + d));
    t.setFontSize(next);
    localStorage.setItem(FONT_KEY, String(next));
  };

  const keysShown = typing !== "none";

  return (
    <div ref={screenRef} className="session-screen flex flex-col bg-terminal">
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-background/90 px-1 pt-[env(safe-area-inset-top)] backdrop-blur">
        <Button variant="ghost" size="icon-lg" aria-label="Back to the list" onClick={goBack}>
          <ChevronLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 py-1.5">
          <div className="flex items-center gap-1.5">
            {session && <StatusIcon status={session.status} className="size-3.5" />}
            <span className="truncate text-sm font-medium">{session?.title || sessionKey}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {session && <MachineChip machine={machine} id={session.machine} />}
            {session && <span>{HARNESS_LABEL[session.harness]}</span>}
            {session && <span>{STATUS_LABEL[session.status]}</span>}
            {conn !== "open" && (
              <span className={cn(conn === "offline" ? "text-red-400" : "text-amber-400")}>
                {conn === "waiting" ? "waiting for faplex to list it…" : conn === "offline" ? "disconnected · retrying" : "connecting…"}
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label="More" />}>
            <EllipsisVertical className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => reconnectRef.current()}>
              <RotateCw /> Reconnect
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem closeOnClick={false} onClick={() => fontStep(1)}>
              <ALargeSmall /> Larger text
            </DropdownMenuItem>
            <DropdownMenuItem closeOnClick={false} onClick={() => fontStep(-1)}>
              <ALargeSmall className="scale-75" /> Smaller text
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="terminal-host absolute inset-0 overflow-hidden" />
        {conn !== "open" && conn !== "offline" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-background/95 pb-[max(env(safe-area-inset-bottom),0.375rem)]" onPointerDown={(e) => {
        // Buttons here must not take focus from the composer or the terminal (that drops the keyboard).
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}>
        {keysShown && (
          <div className="flex gap-1 overflow-x-auto px-1.5 pt-1.5 [scrollbar-width:none]">
            {KEYS.map((k) => (
              <Button key={k.title} variant="secondary" size="sm" className="h-8 min-w-10 shrink-0 font-mono" aria-label={k.title} onClick={() => pressKey(k)}>
                {k.label}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 px-1.5 pt-1.5">
          <Button
            variant={typing === "raw" ? "secondary" : "ghost"}
            size="icon-lg"
            aria-label={typing === "raw" ? "Hide keyboard" : "Type into the terminal"}
            onClick={() => term.current?.toggleRawFocus()}
          >
            <Keyboard />
          </Button>
          <Textarea
            ref={composerRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setTyping("compose")}
            onBlur={() => setTyping((v) => (v === "compose" ? "none" : v))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !matchMedia("(any-pointer: coarse)").matches) && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={session?.status === "working" ? "Queue a message…" : "Message…"}
            className="max-h-36 min-h-9 flex-1 resize-none py-1.5 text-base field-sizing-content"
          />
          <Button size="icon-lg" aria-label={text.trim() ? "Send" : "Enter"} onClick={submit} disabled={conn !== "open"}>
            {text.trim() ? <SendHorizontal /> : <CornerDownLeft />}
          </Button>
        </div>
      </div>
    </div>
  );
}
