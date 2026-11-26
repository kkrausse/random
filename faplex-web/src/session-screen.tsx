import { apiFetch, wsUrl } from "./endpoint";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseToMap } from "./walks-panel";
import { ALargeSmall, ArrowUp, Camera, ChevronLeft, ClipboardPaste, EllipsisVertical, Keyboard, KeyboardOff, Loader, RefreshCcw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HARNESS_LABEL, STATUS_LABEL } from "./format.ts";
import type { useLive } from "./live.ts";
import { goBack } from "./router.ts";
import { MachineChip, StatusIcon } from "./session-card.tsx";
import { mountTerminal, type MountedTerminal } from "./terminal.ts";

type Conn = "starting" | "connecting" | "open" | "waiting" | "offline";

const FONT_KEY = "faplex-web.fontSize";
const NOT_LISTED = "is not a session this watch lists";

export function SessionScreen({ sessionKey, live }: { sessionKey: string; live: ReturnType<typeof useLive> }) {
  const session = live.state?.sessions.find((s) => s.key === sessionKey);
  const machine = live.state?.machines.find((m) => m.id === session?.machine);
  const screenRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const term = useRef<MountedTerminal>(undefined);
  const [conn, setConn] = useState<Conn>("starting");
  const [keyboard, setKeyboard] = useState(false);
  const listed = !!session?.openable;
  const listedRef = useRef(listed);
  listedRef.current = listed;

  // Size the screen to the visual viewport, so the terminal ends where the keyboard begins.
  // Keyboards (third-party ones especially) settle over several frames and iOS may pan the page
  // to the focused input, so re-measure for a while after any focus change and keep the page
  // itself unscrolled.
  useEffect(() => {
    const vv = window.visualViewport;
    const layout = () => {
      const el = screenRef.current;
      if (!el) return;
      const zoomed = vv ? Math.abs(vv.scale - 1) > 0.01 : false;
      el.style.height = `${vv && !zoomed ? vv.height : window.innerHeight}px`;
      el.style.top = `${vv && !zoomed ? vv.offsetTop : 0}px`;
    };
    let settleUntil = 0;
    let frame = 0;
    const settle = () => {
      settleUntil = performance.now() + 1200;
      if (frame) return;
      const tick = () => {
        layout();
        frame = performance.now() < settleUntil ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    };
    // The screen is fixed and sized to the visual viewport: the page itself should never be
    // scrolled. iOS still does it around keyboards, so undo it.
    const unscroll = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      settle();
    };
    // Keyboards can change height (switching keyboards) without every event firing, so while
    // one may be up, re-check now and then. Anything off is logged for diagnosis.
    let lastReport = "";
    const check = setInterval(() => {
      if (document.hidden) return;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      layout();
      const el = screenRef.current;
      const header = el?.querySelector("header")?.getBoundingClientRect();
      const state = {
        vvHeight: Math.round(vv?.height ?? 0),
        vvTop: Math.round(vv?.offsetTop ?? 0),
        vvPageTop: Math.round(vv?.pageTop ?? 0),
        scale: vv?.scale,
        innerHeight: window.innerHeight,
        scrollY: Math.round(window.scrollY),
        headerTop: Math.round(header?.top ?? 0),
        screenTop: el?.style.top,
        screenHeight: el?.style.height,
        focused: document.activeElement?.tagName,
      };
      // Off: the header isn't at the top of what's visible, or the page is scrolled.
      const off = Math.abs((header?.top ?? 0) - (vv?.offsetTop ?? 0)) > 2 || state.scrollY !== 0;
      const line = JSON.stringify(state);
      if (off && line !== lastReport) {
        lastReport = line;
        void apiFetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: "off", ...state }) }).catch(() => {});
      }
    }, 400);
    layout();
    vv?.addEventListener("resize", settle);
    vv?.addEventListener("scroll", settle);
    window.addEventListener("resize", settle);
    window.addEventListener("scroll", unscroll);
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    return () => {
      clearInterval(check);
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", settle);
      vv?.removeEventListener("scroll", settle);
      window.removeEventListener("resize", settle);
      window.removeEventListener("scroll", unscroll);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      window.scrollTo(0, 0);
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

    // A size change one row down and back makes the harness redraw its whole screen. Done once
    // its output has gone quiet after attaching (faplex holds Claude's output until its input box
    // is drawn), and on coming back to the page.
    let lastOutput = 0;
    let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
    const resizeTo = (cols: number, rows: number) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ resize: { cols, rows } }));
    const nudge = () => {
      const t = term.current;
      if (!t || ws?.readyState !== WebSocket.OPEN) return;
      const { cols, rows } = t.terminal;
      resizeTo(cols, rows - 1);
      // Far enough apart that a harness debouncing its resize handling sees two changes.
      setTimeout(() => resizeTo(t.terminal.cols, t.terminal.rows), 350);
    };
    const nudgeWhenQuiet = (deadline = Date.now() + 5000) => {
      clearTimeout(nudgeTimer);
      if (Date.now() - lastOutput >= 500 || Date.now() > deadline) return nudge();
      nudgeTimer = setTimeout(() => nudgeWhenQuiet(deadline), 150);
    };
    redrawRef.current = nudge;

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
      const socket = new WebSocket(wsUrl(`/api/term?key=${encodeURIComponent(sessionKey)}&cols=${cols}&rows=${rows}`));
      socket.binaryType = "arraybuffer";
      ws = socket;
      let head = "";
      socket.onopen = () => {
        retry = 0;
        setConn("open");
        lastOutput = Date.now();
        // Redraw at once on opening, and again once the attach output has settled.
        setTimeout(nudge, 150);
        nudgeTimer = setTimeout(() => nudgeWhenQuiet(), 1200);
      };
      socket.onmessage = (e) => {
        if (ws !== socket) return;
        const bytes = new Uint8Array(e.data as ArrayBuffer);
        lastOutput = Date.now();
        if (head.length < 200) head += decoder.decode(bytes, { stream: true });
        t.terminal.write(bytes);
      };
      socket.onclose = (e) => {
        // A socket already replaced (by a fresh reattach) says nothing about the current one.
        const current = ws === socket;
        if (current) ws = undefined;
        if (disposed || !current) return;
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
          resize: resizeTo,
          rawFocus: setKeyboard,
          upload: async (file) => {
            const r = await apiFetch(`/api/attach?key=${encodeURIComponent(sessionKey)}`, {
              method: "POST",
              headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
              body: file,
            });
            if (!r.ok) throw new Error(await r.text());
            return ((await r.json()) as { path: string }).path;
          },
        });
        if (disposed) return t.dispose();
        term.current = t;
        connect();
      } catch (e) {
        toast.error("Terminal failed to start", { description: e instanceof Error ? e.message : String(e) });
      }
    })();

    // Back from the background (app switcher, lock screen, bfcache): iOS may have dropped the
    // socket without it looking closed, so always reattach fresh. faplex repaints on attach.
    let hiddenAt = 0;
    const fresh = () => {
      ws?.close();
      ws = undefined;
      retry = 0;
      term.current?.terminal.write("\x1bc");
      connect();
    };
    const wake = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 1000) fresh();
      else if (ws?.readyState === WebSocket.OPEN) nudgeWhenQuiet();
      else connect();
      hiddenAt = 0;
    };
    const onShow = (e: PageTransitionEvent) => e.persisted && fresh();
    const onOnline = () => fresh();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("online", onOnline);
    reconnectRef.current = fresh;
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(nudgeTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("online", onOnline);
      ws?.close(1000);
      term.current?.dispose();
      term.current = undefined;
    };
  }, [sessionKey]);

  const reconnectRef = useRef<() => void>(() => {});
  const pasteRef = useRef<HTMLButtonElement>(null);
  const floating = cn(buttonVariants({ variant: "secondary", size: "icon-lg" }), "size-11 rounded-full bg-secondary/70 shadow-lg ring-1 ring-foreground/10 backdrop-blur");

  // Paste as in bun-web-terminal: a native click listener and one clipboard read.
  useEffect(() => {
    const paste = pasteRef.current!;
    const onPaste = () => void term.current?.pasteClipboard();
    paste.addEventListener("click", onPaste);
    return () => paste.removeEventListener("click", onPaste);
  }, []);
  const redrawRef = useRef<() => void>(() => {});

  const fontStep = (d: number) => {
    const t = term.current;
    if (!t) return;
    const next = Math.max(8, Math.min(24, t.fontSize() + d));
    t.setFontSize(next);
    localStorage.setItem(FONT_KEY, String(next));
  };

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
        <CloseToMap />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label="More" />}>
            <EllipsisVertical className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => redrawRef.current()}>
              <RefreshCcw /> Redraw
            </DropdownMenuItem>
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
        {/* Paste, and raise or lower the keyboard (which types straight into the terminal). */}
        <div
          className={cn("absolute right-2 flex flex-col gap-2", keyboard ? "bottom-2" : "bottom-[max(env(safe-area-inset-bottom),0.5rem)]")}
          // Keep focus where it is, so a tap toggles rather than blurring first.
          onPointerDown={(e) => e.preventDefault()}
        >
          {/* Camera: take a photo and hand it to the session like a pasted screenshot (uploaded to the
              session's machine, its path typed in, which Claude reads as an image). */}
          <label aria-label="Take a photo" className={cn(floating, "cursor-pointer")}>
            <Camera className="size-5" />
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; if (files.length) void term.current?.pasteFiles(files); }} />
          </label>
          {/* Plain buttons with native listeners, exactly as bun-web-terminal's toolbar. */}
          <button ref={pasteRef} type="button" aria-label="Paste" className={floating}>
            <ClipboardPaste className="size-5" />
          </button>
          <Button
            variant="secondary"
            size="icon-lg"
            aria-label={keyboard ? "Hide keyboard" : "Show keyboard"}
            className={cn(
              "size-11 rounded-full shadow-lg ring-1 ring-foreground/10 backdrop-blur",
              keyboard ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary/70",
            )}
            onClick={() => term.current?.toggleRawFocus()}
          >
            {keyboard ? <KeyboardOff className="size-5" /> : <Keyboard className="size-5" />}
          </Button>
        </div>
      </div>
      <ComposeBar onSend={(text) => term.current?.sendText(text)} raw={keyboard} />
    </div>
  );
}

/**
 * A normal text box under the terminal: type or dictate (dictation apps that rewrite their text
 * as they go, like Hex, work here; typed straight into the terminal every rewrite was appended),
 * edit freely, then Send pastes the whole message into the session and presses Enter. The keyboard
 * button above still types raw keys into the terminal (arrows, Esc, answers to prompts).
 */
function ComposeBar({ onSend, raw }: { onSend: (text: string) => void; raw: boolean }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const grow = () => { const el = area.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; };
  useLayoutEffect(grow, [text]);
  const send = () => {
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText("");
  };
  return (
    <form
      className={cn("flex shrink-0 items-end gap-2 border-t border-border bg-background/95 px-2 pt-2", raw ? "pb-2" : "pb-[max(env(safe-area-inset-bottom),0.5rem)]")}
      onSubmit={(e) => { e.preventDefault(); send(); }}
    >
      <textarea
        ref={area}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Desktop: Enter sends, Shift+Enter is a new line. Phone: the Send button sends.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); }
        }}
        placeholder="Message"
        className="min-h-10 flex-1 resize-none rounded-2xl border border-input bg-secondary/40 px-3 py-2 text-base leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <Button type="submit" size="icon-lg" className="size-10 shrink-0 rounded-full" disabled={!text.trim()} aria-label="Send">
        <ArrowUp className="size-5" />
      </Button>
    </form>
  );
}
