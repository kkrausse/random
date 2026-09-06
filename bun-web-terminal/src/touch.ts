import type { Terminal } from "../vendor/ghostty-web/lib/index";

// Touch selection is local, including when the application owns mouse input.
export function installTerminalTouchControls(container: HTMLElement, terminal: Terminal, selecting: () => boolean, notice: (message: string) => void) {
  let gesture: { id: number; x: number; y: number; lastY: number; moved: boolean; anchor: number; selecting: boolean } | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const clearHold = () => { clearTimeout(holdTimer); holdTimer = undefined; };
  const cancel = () => { clearHold(); gesture = undefined; };
  const cellAt = (x: number, y: number) => {
    const rect = container.querySelector("canvas")!.getBoundingClientRect();
    const metrics = terminal.renderer!.getMetrics();
    const col = Math.max(0, Math.min(terminal.cols - 1, Math.floor((x - rect.left) / metrics.width)));
    const row = Math.max(0, Math.min(terminal.rows - 1, Math.floor((y - rect.top) / metrics.height)));
    return row * terminal.cols + col;
  };
  const selectTo = (end: number) => {
    if (!gesture) return;
    const start = Math.min(gesture.anchor, end);
    terminal.select(start % terminal.cols, Math.floor(start / terminal.cols), Math.abs(end - gesture.anchor) + 1);
  };
  container.addEventListener("touchstart", (event) => {
    // Claim touches before the engine can turn them into clicks or focus changes.
    event.stopImmediatePropagation();
    cancel();
    if (event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastY: touch.clientY,
      moved: false, anchor: cellAt(touch.clientX, touch.clientY), selecting: selecting() };
    if (gesture.selecting) selectTo(gesture.anchor);
    else holdTimer = setTimeout(() => {
      holdTimer = undefined;
      if (!gesture) return;
      gesture.selecting = true;
      selectTo(gesture.anchor);
      // Keep keyboard/viewport geometry stable while the finger is down.
      notice("Drag to select · then tap Copy");
    }, 500);
  }, { capture: true, passive: true });
  container.addEventListener("touchmove", (event) => {
    event.stopImmediatePropagation();
    if (!gesture || event.touches.length !== 1) { cancel(); return; }
    event.preventDefault();
    const touch = [...event.touches].find((touch) => touch.identifier === gesture!.id);
    if (!touch) return;
    if (!gesture.selecting && !gesture.moved && Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) < 8) return;
    clearHold();
    gesture.moved = true;
    if (gesture.selecting) {
      selectTo(cellAt(touch.clientX, touch.clientY));
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
    // Suppress compatibility mouse events, including after multi-touch cancellation.
    event.preventDefault();
    clearHold();
    if (gesture?.selecting) {
      const touch = [...event.changedTouches].find((touch) => touch.identifier === gesture!.id);
      if (touch) selectTo(cellAt(touch.clientX, touch.clientY));
    } else if (gesture && !gesture.moved) {
      // Defer the entire click until release: a swipe must never press a TUI row.
      // Bypass the canvas focus listener so taps don't summon the software keyboard.
      for (const type of ["mousedown", "mouseup"]) {
        container.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: type === "mousedown" ? 1 : 0,
          clientX: gesture.x, clientY: gesture.y,
        }));
      }
    }
    cancel();
  }, { capture: true, passive: false });
  container.addEventListener("touchcancel", cancel, { capture: true });
  container.addEventListener("contextmenu", (event) => {
    // Native long-press menus can cancel the drag before selection starts.
    if (gesture) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true });
  window.addEventListener("blur", cancel);
  window.addEventListener("pagehide", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
}
