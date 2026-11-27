import { apiFetch, embedded, wsUrl } from "./endpoint";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReadView, type Pending } from "./read-view";
import { ModelPicker } from "./model-picker";
import { CloseToMap } from "./walks-panel";
import { ALargeSmall, Archive, Camera, ChevronDown, ChevronLeft, ClipboardPaste, EllipsisVertical, Loader, MessageSquareText, RefreshCcw, RotateCw, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HARNESS_LABEL, STATUS_LABEL, tokens } from "./format.ts";
import type { useLive } from "./live.ts";
import { goBack } from "./router.ts";
import { MachineChip, StatusIcon } from "./session-card.tsx";
import { mountTerminal, type MountedTerminal } from "./terminal.ts";

type Conn = "starting" | "connecting" | "open" | "waiting" | "offline";

const FONT_KEY = "faplex-web.fontSize";
const NOT_LISTED = "is not a session this watch lists";
const VIEW_KEY = "faplex.view";

export function SessionScreen({ sessionKey, live }: { sessionKey: string; live: ReturnType<typeof useLive> }) {
  const session = live.state?.sessions.find((s) => s.key === sessionKey);
  const machine = live.state?.machines.find((m) => m.id === session?.machine);
  const screenRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const term = useRef<MountedTerminal>(undefined);
  const [conn, setConn] = useState<Conn>("starting");
  const [keyboard, setKeyboard] = useState(false); // the terminal itself has the keyboard
  const [composing, setComposing] = useState(false); // the Message box has it
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const keyboardUp = keyboard || composing;
  // The keyboard button: down → into the Message box (never the terminal: user, 11-25); up → closed,
  // wherever it is. Decided by focus alone: inside the Walks app the keyboard shrinks the whole page
  // (innerHeight == visualViewport.height), so a viewport check can't tell whether it's up.
  const toggleKeyboard = () => {
    const compose = composeRef.current;
    if (document.activeElement === compose || term.current?.rawFocused()) (document.activeElement as HTMLElement).blur();
    else compose?.focus({ preventScroll: true });
  };
  const listed = !!session?.openable;

  // Inside Walks: the reading view by default (read-view.tsx), the terminal one tap away, and
  // switched to by itself while the session needs an answer (menus, questions, permissions).
  // faplex's own site keeps the terminal only.
  const readable = embedded() && !!session && (session.harness === "claude" || session.harness.startsWith("opencode"));
  const [view, setView] = useState<"read" | "term">(() => (localStorage.getItem(VIEW_KEY) === "term" ? "term" : "read"));
  const choose = (v: "read" | "term") => { autoTerm.current = false; setView(v); localStorage.setItem(VIEW_KEY, v); };
  const autoTerm = useRef(false);
  useEffect(() => {
    if (!readable) return;
    if (session?.status === "needs" && view === "read") { autoTerm.current = true; setView("term"); }
    else if (session?.status !== "needs" && autoTerm.current) { autoTerm.current = false; setView("read"); }
  }, [readable, session?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const showRead = readable && view === "read";
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (showRead) Object.assign(el.style, { width: `${el.clientWidth}px`, height: `${el.clientHeight}px`, right: "auto", bottom: "auto" });
    else Object.assign(el.style, { width: "", height: "", right: "", bottom: "" });
  }, [showRead]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [picking, setPicking] = useState(false);
  const seen = useCallback((p: Pending) => setPending((all) => all.filter((x) => x !== p)), []);
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
  const barButton = cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "size-10 rounded-full text-muted-foreground");

  // A tap on the messages or the terminal closes the keyboard of the Message box (the terminal's own
  // keyboard, raised for raw keys, stays: taps there are clicks into the session).
  useEffect(() => {
    const onTouch = (e: TouchEvent) => {
      const compose = composeRef.current;
      if (!compose || document.activeElement !== compose) return;
      const target = e.target as Element | null;
      if (target?.closest?.(".read-view, .terminal-host")) compose.blur();
    };
    window.addEventListener("touchstart", onTouch, { capture: true, passive: true });
    return () => window.removeEventListener("touchstart", onTouch, { capture: true });
  }, []);

  const redrawRef = useRef<() => void>(() => {});

  // Stop (if running) and archive, as x in faplex; back to the list once it's done.
  const archive = async () => {
    const id = toast.loading(session?.stoppable ? "Stopping and archiving…" : "Archiving…");
    try {
      const r = await apiFetch("/api/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: sessionKey }) });
      const b = (await r.json()) as { ok: boolean; error?: string; note?: string };
      if (!b.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      toast.success("Archived", { id, description: b.note, duration: 2000 });
      goBack();
    } catch (e) {
      toast.error("Couldn't archive", { id, description: e instanceof Error ? e.message : String(e) });
    }
  };

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
            {session?.harness.startsWith("opencode") && (
              <button type="button" className="inline-flex max-w-32 items-center gap-0.5 truncate rounded border border-border px-1 text-foreground" onClick={() => setPicking(true)}>
                <span className="truncate">{session.model || "model"}</span><ChevronDown className="size-3 shrink-0" />
              </button>
            )}
            {session && <span>{STATUS_LABEL[session.status]}</span>}
            {session?.context && <span className="tabular-nums">{tokens(session.context.usedTokens)}{session.context.limitTokens ? ` / ${tokens(session.context.limitTokens)}` : ""} tok</span>}
            {conn !== "open" && (
              <span className={cn(conn === "offline" ? "text-red-400" : "text-amber-400")}>
                {conn === "waiting" ? "waiting for faplex to list it…" : conn === "offline" ? "disconnected · retrying" : "connecting…"}
              </span>
            )}
          </div>
        </div>
        {readable && (
          <Button variant="ghost" size="icon-lg" aria-label={showRead ? "Show the terminal" : "Show the messages"} onClick={() => choose(showRead ? "term" : "read")}>
            {showRead ? <SquareTerminal className="size-5" /> : <MessageSquareText className="size-5" />}
          </Button>
        )}
        <CloseToMap />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label="More" />}>
            <EllipsisVertical className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {/* Fallback for a picture iOS won't paste into the box: one clipboard read. */}
            <DropdownMenuItem onClick={() => void term.current?.pasteClipboard()}>
              <ClipboardPaste /> Paste from clipboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={archive}>
              <Archive /> {session?.stoppable ? "Stop and archive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        {/* Invisible (not unmounted) under the reading view, its size frozen: the keyboard coming
            and going doesn't resize the session, and switching back doesn't make it redraw. */}
        <div ref={hostRef} className={cn("terminal-host absolute inset-0 overflow-hidden", showRead && "invisible")} />
        {showRead && <ReadView sessionKey={sessionKey} session={session} pending={pending} onSeen={seen} />}
        {!showRead && conn !== "open" && conn !== "offline" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      {session?.harness.startsWith("opencode") && <ModelPicker sessionKey={sessionKey} open={picking} onOpenChange={setPicking} />}
      <ComposeBar ref={composeRef} onSend={(text) => { term.current?.sendText(text); if (showRead) setPending((all) => [...all, { text, at: Date.now() }]); }} raw={keyboardUp} onFocusChange={setComposing}
        onPasteFiles={(files) => void term.current?.pasteFiles(files)}
        leading={
          // Only the camera beside the box (Camera, Paste and the keyboard floated over the screen
          // until 11-27; a picture now pastes into the box, and Paste is in ⋮). Pressing it keeps
          // focus where it is, so the keyboard doesn't drop.
          <div className="flex shrink-0 items-center gap-1 pb-0.5" onPointerDown={(e) => e.preventDefault()}>
            {/* Camera: take a photo and hand it to the session like a pasted screenshot (uploaded to the
                session's machine, its path typed in, which Claude reads as an image). */}
            <label aria-label="Take a photo" className={cn(barButton, "cursor-pointer")}>
              <Camera className="size-5" />
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; if (files.length) void term.current?.pasteFiles(files); }} />
            </label>
          </div>
        }
        trailing={keyboardUp && (
          // The app hides iOS's bar above the keyboard (and its Done), so closing it is here, or a tap
          // on the messages / terminal.
          <button type="button" aria-label="Hide keyboard" className={cn(barButton, "mb-0.5")} onPointerDown={(e) => e.preventDefault()} onClick={toggleKeyboard}>
            <ChevronDown className="size-5" />
          </button>
        )}
      />
    </div>
  );
}

/**
 * A normal text box under the terminal: type or dictate (dictation apps that rewrite their text
 * as they go, like Hex, work here; typed straight into the terminal every rewrite was appended),
 * edit freely, then Return pastes the whole message into the session and presses Enter. The keyboard
 * button above still types raw keys into the terminal (arrows, Esc, answers to prompts).
 */
function ComposeBar({ ref: area, onSend, onPasteFiles, raw, onFocusChange, leading, trailing }: { ref: React.RefObject<HTMLTextAreaElement | null>; onSend: (text: string) => void; onPasteFiles?: (files: File[]) => void; raw: boolean; onFocusChange: (on: boolean) => void; leading?: React.ReactNode; trailing?: React.ReactNode }) {
  const [text, setText] = useState("");
  const grow = () => { const el = area.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; };
  useLayoutEffect(grow, [text]);
  const newline = useRef(false); // Shift+Enter on a hardware keyboard: a real new line
  const send = (value = text) => {
    const body = value.trim();
    setText("");
    if (body) onSend(body);
  };
  return (
    <form
      className={cn("flex shrink-0 items-end gap-2 border-t border-border bg-background/95 px-2 pt-2", raw ? "pb-2" : "pb-[max(env(safe-area-inset-bottom),0.5rem)]")}
      onSubmit={(e) => { e.preventDefault(); send(); }}
    >
      {leading}
      <textarea
        ref={area}
        rows={1}
        value={text}
        // Return sends (no Send button: user, 11-25). iOS keyboards and dictation don't always send a
        // keydown for Return, they just insert a line break: so any new line sends, however it came.
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes("\n") && !newline.current) send(v.replace(/\n/g, " "));
          else setText(v);
          newline.current = false;
        }}
        enterKeyHint="send"
        // A picture pasted into the box (iOS's Paste on a tap) goes to the session like the Paste
        // button's: uploaded, its path typed in. Text pastes into the box as usual.
        onPaste={(e) => {
          const files = [...(e.clipboardData?.files ?? [])];
          if (!files.length || !onPasteFiles) return;
          e.preventDefault();
          onPasteFiles(files);
        }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Shift+Enter = new line only on a hardware keyboard. iOS reports shiftKey whenever its
          // auto-capital Shift is on (start of a sentence), so on a touch screen Return always sends.
          if (e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) { newline.current = true; return; }
          if (e.keyCode === 229) return; // an input method is confirming text, not Return
          e.preventDefault();
          send();
        }}
        placeholder="Message"
        className="min-h-10 flex-1 resize-none rounded-2xl border border-input bg-secondary/40 px-3 py-2 text-base leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {trailing}
    </form>
  );
}
