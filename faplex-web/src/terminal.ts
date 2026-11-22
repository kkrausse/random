// The session's terminal: ghostty-web (WebGL) with the web terminal's touch, wheel and link
// handling. A tap never raises the keyboard; typing goes through the composer, or straight into
// the terminal with the keyboard button.
import { init, Terminal, WebglRenderer, type ITheme } from "@random/ghostty-web";
import { installTerminalTouchControls } from "../../bun-web-terminal/src/touch.ts";
import { forwardWheelSteps, installScrolling } from "../../bun-web-terminal/src/scroll.ts";
import { installLinkClicks, terminalLinkAt } from "../../bun-web-terminal/src/links.ts";
import { toast } from "sonner";

type Theme = { terminal: ITheme; fontFamily: string; fontSize: number; scrollSensitivity?: number };

let ready: Promise<Theme> | undefined;
const prepare = () =>
  (ready ??= Promise.all([
    fetch("/api/theme").then((r) => {
      if (!r.ok) throw new Error(`theme: HTTP ${r.status}`);
      return r.json() as Promise<Theme>;
    }),
    init({ wasmUrl: "/ghostty-vt.wasm" }),
  ]).then(([theme]) => {
    document.documentElement.style.setProperty("--terminal-bg", theme.terminal.background ?? "#0c0c0c");
    return theme;
  }));

/** Paste attempts go to the server's log, so a failure on a phone can be read off diesel2. */
const report = (event: Record<string, unknown>) =>
  void fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...event, ua: navigator.userAgent }) }).catch(() => {});

export type MountedTerminal = Awaited<ReturnType<typeof mountTerminal>>;

const coarse = () => matchMedia("(any-pointer: coarse)").matches;

export async function mountTerminal(
  host: HTMLElement,
  opts: {
    fontSize?: number;
    input: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    rawFocus: (focused: boolean) => void;
    /** Puts a file on the session's machine; resolves to its path there. */
    upload: (file: File) => Promise<string>;
  },
) {
  const theme = await prepare();
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: theme.fontFamily,
    // Phones get a smaller default so a harness has room to lay out.
    fontSize: opts.fontSize ?? (coarse() ? 12 : theme.fontSize),
    scrollback: 10_000,
    selectOnDrag: false,
    copyOnSelect: false,
    smoothScrollDuration: 0,
    theme: theme.terminal,
    rendererType: "webgl",
    onClipboardWrite: (ok) => (ok ? toast.success("Copied") : toast.error("Copy failed")),
  });
  await terminal.open(host);
  // instanceof, not constructor.name: the bundle is minified.
  if (!(terminal.renderer instanceof WebglRenderer)) {
    terminal.dispose();
    throw new Error("WebGL2 is unavailable; the terminal needs it.");
  }
  // An editable container makes iOS treat a long press as text editing.
  if (coarse()) host.removeAttribute("contenteditable");
  const canvas = () => host.querySelector("canvas") ?? host;

  installScrolling(host, () => ({
    lineHeight: terminal.renderer?.getMetrics().height ?? 20,
    rows: terminal.rows,
    mode: terminal.wasmTerm?.hasMouseTracking() ? "mouse" : terminal.wasmTerm?.isAlternateScreen() ? "alternate" : "history",
  }), theme.scrollSensitivity ?? 0.5);
  installLinkClicks(host, terminal);
  installTerminalTouchControls(
    host,
    terminal,
    () => false,
    (message) => toast(message, { duration: 1500 }),
    (lines, x, y) => {
      // Harnesses take wheel steps (one per line); plain scrollback moves by lines here.
      if (terminal.wasmTerm?.hasMouseTracking() || terminal.wasmTerm?.isAlternateScreen()) forwardWheelSteps(canvas(), lines, { clientX: x, clientY: y });
      else terminal.scrollLines(lines);
    },
    (x, y) => {
      const url = terminalLinkAt(terminal, x, y);
      if (!url) return false;
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
  );

  terminal.onData(opts.input);
  terminal.onResize(({ cols, rows }) => opts.resize(cols, rows));
  // Ctrl+V belongs to the terminal app; paste stays Cmd+V / Ctrl+Shift+V.
  host.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyV") {
      e.preventDefault();
      e.stopImmediatePropagation();
      opts.input("\x16");
    }
  }, { capture: true });
  const textarea = terminal.textarea;
  const onFocus = () => opts.rawFocus(true);
  const onBlur = () => opts.rawFocus(false);
  textarea?.addEventListener("focus", onFocus);
  textarea?.addEventListener("blur", onBlur);
  // Ghostty focuses its input on open. On a phone the keyboard waits for the button.
  if (coarse()) textarea?.blur();
  opts.rawFocus(document.activeElement === textarea);

  // Files are uploaded and their paths pasted, as a terminal does with a dropped file.
  const pasteFiles = async (files: File[]) => {
    const id = toast.loading(files.length === 1 ? `Uploading ${files[0]!.name}…` : `Uploading ${files.length} files…`);
    try {
      const paths = await Promise.all(files.map(opts.upload));
      terminal.paste(paths.join(" "));
      toast.success("Pasted", { id, duration: 1500 });
    } catch (e) {
      toast.error("Upload failed", { id, description: e instanceof Error ? e.message : String(e) });
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    // A paste into another field (the paste box) is that field's.
    const target = event.target as Node | null;
    if (target && target !== document.body && !host.contains(target)) return;
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void pasteFiles(files);
  };
  // On the document: a touch device can paste without the terminal's input focused.
  document.addEventListener("paste", onPaste, { capture: true });

  // Fit the grid to the host: whole cells, at most one pixel clipped on the right.
  const fit = () => {
    const m = terminal.renderer?.getMetrics();
    if (!m?.width || !m.height || !host.clientWidth || !host.clientHeight) return;
    const cols = Math.max(20, Math.min(400, Math.floor((host.clientWidth + 1) / m.width)));
    const rows = Math.max(5, Math.min(200, Math.floor(host.clientHeight / m.height)));
    if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
  };
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  const observer = new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fit, 100);
  });
  observer.observe(host);
  fit();
  void document.fonts?.ready.then(fit);
  if (!coarse()) terminal.focus();

  return {
    terminal,
    /** A key as if typed, so Ghostty encodes it for the app's current modes. */
    key(key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
      (textarea ?? host).dispatchEvent(new KeyboardEvent("keydown", { key, code: key, ...mods, bubbles: true, cancelable: true }));
    },
    toggleRawFocus() {
      if (document.activeElement === textarea) textarea?.blur();
      else textarea?.focus({ preventScroll: true });
    },
    /**
     * The paste button: one clipboard read (a second would prompt again on iOS). Resolves false
     * when the browser wouldn't hand the clipboard over, so the caller can offer a paste box.
     */
    async pasteClipboard(cancelled: () => boolean = () => false): Promise<boolean> {
      report({ paste: "start", read: !!navigator.clipboard?.read, focused: document.activeElement?.tagName });
      try {
        if (!navigator.clipboard?.read) {
          const text = await navigator.clipboard.readText();
          if (!text) return false;
          terminal.paste(text);
          return true;
        }
        const files: File[] = [];
        let text = "";
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => !t.startsWith("text/"));
          if (type) files.push(new File([await item.getType(type)], `pasted.${type.split("/")[1]!.split(/[+;]/)[0]}`, { type }));
          else if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text();
        }
        report({ paste: "read", files: files.map((f) => f.type), textLength: text.length, late: cancelled() });
        // The paste box already took over (the confirmation came too late): don't paste twice.
        if (cancelled()) return false;
        if (files.length) await pasteFiles(files);
        else if (text) terminal.paste(text);
        else return false;
        return true;
      } catch (e) {
        report({ paste: "error", name: (e as Error)?.name, message: (e as Error)?.message });
        return false;
      }
    },
    pasteText: (text: string) => terminal.paste(text),
    focusInput: () => textarea?.focus({ preventScroll: true }),
    blurInput: () => textarea?.blur(),
    pasteFiles,
    fontSize: () => terminal.options.fontSize ?? 12,
    setFontSize(size: number) {
      terminal.options.fontSize = size;
      setTimeout(fit, 50);
    },
    dispose() {
      observer.disconnect();
      document.removeEventListener("paste", onPaste, { capture: true });
      clearTimeout(fitTimer);
      textarea?.removeEventListener("focus", onFocus);
      textarea?.removeEventListener("blur", onBlur);
      terminal.dispose();
      host.replaceChildren();
    },
  };
}
