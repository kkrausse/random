import type { Terminal } from "../vendor/ghostty-web/lib/index";

// Leave key encoding, composition, bracketed paste, and mouse reporting to Ghostty.
export function installMobileControls(container: HTMLElement, terminal: Terminal, notice: (message: string) => void) {
  const toolbar = document.createElement("div");
  toolbar.className = "terminal-keys";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Terminal extra keys");
  const keys = [
    ["Keyboard", "Keyboard"],
    ["Escape", "Esc"], ["Tab", "Tab"], ["Control", "Ctrl"],
    ["ArrowUp", "↑"], ["ArrowDown", "↓"], ["ArrowLeft", "←"], ["ArrowRight", "→"],
    ["Paste", "Paste"], ["Select", "Select"], ["Copy", "Copy"],
  ];
  for (const [key, label] of keys) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = key;
    button.textContent = label!;
    button.setAttribute("aria-label", key!.replace("Arrow", "Arrow "));
    if (key === "Control" || key === "Select") button.setAttribute("aria-pressed", "false");
    toolbar.append(button);
  }
  container.after(toolbar);
  let control = false;
  let selecting = false;
  const setControl = (value: boolean) => {
    control = value;
    toolbar.querySelector('[data-key="Control"]')!.setAttribute("aria-pressed", String(value));
  };
  const focus = () => terminal.textarea?.focus({ preventScroll: true });
  if (terminal.textarea) terminal.textarea.style.fontSize = "16px"; // Avoid iOS focus zoom.

  // Prevent pointer focus from dismissing the keyboard before the click handler.
  toolbar.addEventListener("pointerdown", (event) => event.preventDefault());
  toolbar.addEventListener("click", async (event) => {
    const key = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.key;
    if (!key) return;
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

  let gesture: { id: number; x: number; y: number; lastY: number; moved: boolean; anchor: number } | undefined;
  const cellAt = (x: number, y: number) => {
    const canvas = container.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    const metrics = terminal.renderer!.getMetrics();
    const col = Math.max(0, Math.min(terminal.cols - 1, Math.floor((x - rect.left) / metrics.width)));
    const row = Math.max(0, Math.min(terminal.rows - 1, Math.floor((y - rect.top) / metrics.height)));
    return row * terminal.cols + col;
  };
  container.addEventListener("touchstart", (event) => {
    // Claim touches before the engine can turn them into clicks or focus changes.
    event.stopImmediatePropagation();
    if (event.touches.length !== 1) { gesture = undefined; return; }
    const touch = event.touches[0]!;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastY: touch.clientY,
      moved: false, anchor: cellAt(touch.clientX, touch.clientY) };
  }, { capture: true, passive: true });
  container.addEventListener("touchmove", (event) => {
    event.stopImmediatePropagation();
    if (!gesture || event.touches.length !== 1) { gesture = undefined; return; }
    event.preventDefault();
    const touch = [...event.touches].find((touch) => touch.identifier === gesture!.id);
    if (!touch) return;
    if (!gesture.moved && Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) < 8) return;
    gesture.moved = true;
    if (selecting) {
      const end = cellAt(touch.clientX, touch.clientY);
      const start = Math.min(gesture.anchor, end);
      terminal.select(start % terminal.cols, Math.floor(start / terminal.cols), Math.abs(end - gesture.anchor) + 1);
    } else {
      container.querySelector("canvas")?.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, deltaY: gesture.lastY - touch.clientY,
        clientX: touch.clientX, clientY: touch.clientY,
      }));
    }
    gesture.lastY = touch.clientY;
  }, { capture: true, passive: false });
  container.addEventListener("touchend", (event) => {
    event.stopImmediatePropagation();
    // Suppress compatibility mouse events, including after a canceled multi-touch gesture.
    event.preventDefault();
    if (gesture && !gesture.moved && !selecting) {
      // Defer the entire click until release: a swipe must never press a TUI row.
      // The engine listens on the container. Bypass its canvas focus listener
      // so menu taps don't summon the software keyboard.
      for (const type of ["mousedown", "mouseup"]) {
        container.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: type === "mousedown" ? 1 : 0,
          clientX: gesture.x, clientY: gesture.y,
        }));
      }
    }
    gesture = undefined;
  }, { capture: true, passive: false });
  container.addEventListener("touchcancel", () => { gesture = undefined; }, { capture: true });

  // visualViewport shrinks with the software keyboard even when 100dvh does not.
  const viewport = window.visualViewport;
  const layout = () => {
    if (viewport && viewport.scale !== 1) return; // Preserve browser pinch zoom.
    document.body.style.height = `${viewport?.height ?? window.innerHeight}px`;
    document.body.style.top = `${viewport?.offsetTop ?? 0}px`;
  };
  viewport?.addEventListener("resize", layout);
  viewport?.addEventListener("scroll", layout);
  window.addEventListener("resize", layout);
  window.addEventListener("pageshow", layout);
  window.addEventListener("blur", () => { setControl(false); gesture = undefined; });
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
