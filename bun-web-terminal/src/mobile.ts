import type { Terminal } from "@random/ghostty-web";
import { DictationController } from "./dictation";
import type { TerminalConnection } from "./connection";
import { installTerminalTouchControls } from "./touch";
import { terminalViewport } from "./viewport";

// Leave key encoding, composition, bracketed paste, and mouse reporting to Ghostty.
export function installMobileControls(container: HTMLElement, terminal: Terminal, notice: (message: string) => void, connection: TerminalConnection) {
  const toolbar = document.createElement("div");
  toolbar.className = "terminal-keys";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Terminal extra keys");
  const rows = [document.createElement("div"), document.createElement("div")];
  for (const row of rows) {
    row.className = "terminal-key-row";
    toolbar.append(row);
  }
  const keys = [
    ["Keyboard", "Keyboard"],
    ["Microphone", "Start dictation"],
    ["Escape", "Esc"], ["Control", "Ctrl"], ["ArrowUp", "↑"], ["Enter", "Enter"],
    ["Paste", "Paste"], ["Select", "Select"], ["Copy", "Copy"],
    ["ArrowLeft", "←"], ["ArrowDown", "↓"], ["ArrowRight", "→"],
  ];
  for (const [index, [key, label]] of keys.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = key;
    button.textContent = label!;
    button.setAttribute("aria-label", key!.replace("Arrow", "Arrow "));
    button.title = label!;
    if (key === "Keyboard" || key === "Microphone" || key === "Enter" || key === "Copy" || key === "Paste") {
      // Lucide icons (ISC license; see docs/third-party-notices.md).
      button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${key === "Keyboard"
        ? '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 17h8"/>'
        : key === "Microphone"
          ? '<path d="M12 19v3m-5 0h10M5 10v2a7 7 0 0 0 14 0v-2"/><rect x="9" y="2" width="6" height="12" rx="3"/>'
          : key === "Copy"
            ? '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
            : key === "Paste"
              ? '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'
              : '<path d="m9 10-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>'}</svg>`;
    }
    if (key === "Control" || key === "Select") button.setAttribute("aria-pressed", "false");
    rows[Math.floor(index / 6)]!.append(button);
  }
  container.after(toolbar);
  let control = false;
  let selecting = false;
  const setControl = (value: boolean) => {
    control = value;
    toolbar.querySelector('[data-key="Control"]')!.setAttribute("aria-pressed", String(value));
  };
  const preview = document.createElement("div");
  preview.className = "dictation-preview";
  preview.setAttribute("role", "status");
  toolbar.before(preview);
  const microphone = toolbar.querySelector<HTMLButtonElement>('[data-key="Microphone"]')!;
  let warm = false;
  const dictation = new DictationController(connection, {
    clearControl: () => setControl(false), paste: text => terminal.paste(text), notice,
    preview: text => { preview.textContent = text; },
    startup: text => { if (microphone.dataset.state === "loading") microphone.querySelector("span")!.textContent = text; },
    warm(active) {
      warm = active;
      microphone.dataset.warm = String(active);
      if (microphone.dataset.state === "idle") microphone.setAttribute("aria-label", active ? "Start dictation · microphone on and muted" : "Start dictation");
    },
    state(state) {
      microphone.dataset.state = state;
      microphone.setAttribute("aria-pressed", String(["loading", "recording", "waiting", "finishing"].includes(state)));
      microphone.setAttribute("aria-label", { idle: warm ? "Start dictation · microphone on and muted" : "Start dictation", loading: "Stop dictation · starting microphone", recording: "Stop dictation", waiting: "Stop dictation · buffering audio", finishing: "Finishing dictation", error: "Retry dictation", unavailable: "Dictation unavailable" }[state]);
      microphone.title = microphone.getAttribute("aria-label")!;
      microphone.disabled = state === "finishing";
      const label = microphone.querySelector("span") ?? microphone.appendChild(document.createElement("span"));
      label.textContent = { idle: "", loading: "Starting…", recording: "Stop", waiting: "Stop · Buffering", finishing: "Finishing…", error: "!", unavailable: "!" }[state];
    },
  });
  const focus = () => terminal.textarea?.focus({ preventScroll: true });

  // Prevent pointer focus from dismissing the keyboard before the click handler.
  toolbar.addEventListener("pointerdown", (event) => event.preventDefault());
  toolbar.addEventListener("click", async (event) => {
    const key = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.key;
    if (!key) return;
    if (key === "Microphone") { dictation.toggle(); return; }
    if (key === "Keyboard") {
      if (document.activeElement === terminal.textarea) terminal.textarea?.blur();
      else focus();
      return;
    }
    if (key === "Select") {
      selecting = !selecting;
      toolbar.querySelector('[data-key="Select"]')!.setAttribute("aria-pressed", String(selecting));
      if (selecting) { terminal.textarea?.blur(); notice("Drag to select · then tap Copy"); }
      else terminal.clearSelection();
      return;
    }
    if (key === "Copy") {
      const text = terminal.getSelection();
      if (!text) { notice("Select text first"); return; }
      try { await navigator.clipboard.writeText(text); notice("Copied"); }
      catch { notice("Copy failed · check clipboard permission"); }
      return;
    }
    if (key === "Control") { setControl(!control); return; }
    if (key === "Paste") {
      setControl(false);
      try { terminal.paste(await navigator.clipboard.readText()); }
      catch { notice("Paste unavailable · use your keyboard’s Paste action"); }
      return;
    }
    const ctrlKey = control;
    setControl(false);
    terminal.textarea?.dispatchEvent(new KeyboardEvent("keydown", {
      key, code: key, ctrlKey, bubbles: true, cancelable: true,
    }));
  });

  installTerminalTouchControls(container, terminal, () => selecting, notice);

  // visualViewport shrinks with the software keyboard even when 100dvh does not.
  const viewport = window.visualViewport;
  const layout = () => {
    const { height, top } = terminalViewport(viewport, window.innerHeight);
    document.body.style.height = `${height}px`;
    document.body.style.top = `${top}px`;
  };
  let layoutFrame = 0;
  const scheduleLayout = () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; layout(); });
  };
  viewport?.addEventListener("resize", scheduleLayout);
  viewport?.addEventListener("scroll", scheduleLayout);
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("pageshow", scheduleLayout);
  container.addEventListener("focusin", scheduleLayout);
  container.addEventListener("focusout", scheduleLayout);
  window.addEventListener("blur", () => { setControl(false); });
  layout();

  return {
    input(data: string) {
      if (!control) return data;
      setControl(false);
      if (data.length !== 1) return data;
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) return String.fromCharCode(code & 31);
      if (data === " ") return "\x00";
      if (data === "?") return "\x7f";
      return data;
    },
  };
}
