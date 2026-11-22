import { useEffect, useRef, useState } from "react";
import { ALargeSmall, ChevronLeft, ClipboardPaste, EllipsisVertical, Keyboard, KeyboardOff, Loader, RefreshCcw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
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
  const [pasteBox, setPasteBox] = useState(false);
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
    const unscroll = () => {
      if (window.scrollY !== 0 && document.activeElement === document.body) window.scrollTo(0, 0);
      settle();
    };
    layout();
    vv?.addEventListener("resize", settle);
    vv?.addEventListener("scroll", settle);
    window.addEventListener("resize", settle);
    window.addEventListener("scroll", unscroll);
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    return () => {
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
      setTimeout(() => resizeTo(t.terminal.cols, t.terminal.rows), 120);
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
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/term?key=${encodeURIComponent(sessionKey)}&cols=${cols}&rows=${rows}`);
      socket.binaryType = "arraybuffer";
      ws = socket;
      let head = "";
      socket.onopen = () => {
        retry = 0;
        setConn("open");
        lastOutput = Date.now();
        nudgeTimer = setTimeout(() => nudgeWhenQuiet(), 300);
      };
      socket.onmessage = (e) => {
        const bytes = new Uint8Array(e.data as ArrayBuffer);
        lastOutput = Date.now();
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
          resize: resizeTo,
          rawFocus: setKeyboard,
          upload: async (file) => {
            const r = await fetch(`/api/attach?key=${encodeURIComponent(sessionKey)}`, {
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

    const wake = () => {
      if (document.hidden) return;
      retry = 0;
      // Still connected after the phone slept: the screen may be stale, so redraw it.
      if (ws?.readyState === WebSocket.OPEN) nudgeWhenQuiet();
      else connect();
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
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(nudgeTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      ws?.close(1000);
      term.current?.dispose();
      term.current = undefined;
    };
  }, [sessionKey]);

  const reconnectRef = useRef<() => void>(() => {});
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
          <Button
            variant="secondary"
            size="icon-lg"
            aria-label="Paste"
            className="size-11 rounded-full bg-secondary/70 shadow-lg ring-1 ring-foreground/10 backdrop-blur"
            onClick={async () => {
              const t = term.current;
              if (!t) return;
              // As in bun-web-terminal, where paste works on iOS: the read happens with the
              // terminal's input focused, so iOS has somewhere to show its Paste confirmation.
              const wasUp = keyboard;
              if (!wasUp) t.focusInput();
              let gaveUp = false;
              const read = t.pasteClipboard(() => gaveUp);
              // Refused, empty, or no confirmation within 8 s: iOS's own Paste menu in a text box.
              const ok = await Promise.race([read, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 8000))]);
              if (ok !== true) {
                gaveUp = true;
                setPasteBox(true);
              } else if (!wasUp) t.blurInput();
            }}
          >
            <ClipboardPaste className="size-5" />
          </Button>
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
      <PasteBox
        open={pasteBox}
        onOpenChange={setPasteBox}
        onText={(text) => term.current?.pasteText(text)}
        onFiles={(files) => void term.current?.pasteFiles(files)}
      />
    </div>
  );
}

/** Long-press → Paste lands here: text goes to the session, images and files are uploaded. */
function PasteBox({ open, onOpenChange, onText, onFiles }: { open: boolean; onOpenChange: (open: boolean) => void; onText: (text: string) => void; onFiles: (files: File[]) => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  const done = () => onOpenChange(false);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg">
          <DrawerHeader>
            <DrawerTitle>Paste</DrawerTitle>
            <DrawerDescription>Press and hold in the box, then tap Paste.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <Textarea
              autoFocus
              value={text}
              rows={4}
              className="text-base"
              placeholder="Hold here → Paste"
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (files.length) {
                  e.preventDefault();
                  onFiles(files);
                  done();
                  return;
                }
                const pasted = e.clipboardData.getData("text/plain");
                if (pasted && !text) {
                  e.preventDefault();
                  onText(pasted);
                  done();
                }
              }}
            />
          </div>
          <DrawerFooter>
            <Button
              size="lg"
              disabled={!text}
              onClick={() => {
                onText(text);
                done();
              }}
            >
              Paste into session
            </Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
