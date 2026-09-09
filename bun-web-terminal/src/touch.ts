import type { Terminal } from "@random/ghostty-web";

// Long presses follow desktop drag routing; the Select toolbar forces local selection.
export function installTerminalTouchControls(container: HTMLElement, terminal: Terminal, selecting: () => boolean, notice: (message: string) => void) {
  let gesture: { id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean; anchor: number; selecting: boolean; application: boolean } | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  const clearHold = () => { clearTimeout(holdTimer); holdTimer = undefined; };
  const mouse = (type: string, x: number, y: number) => container.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === "mouseup" ? 0 : 1,
    clientX: x, clientY: y,
  }));
  const cancel = () => {
    clearHold();
    // Balance an application press even on multi-touch, suspension or touchcancel.
    if (gesture?.application) mouse("mouseup", gesture.lastX, gesture.lastY);
    gesture = undefined;
  };
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
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastX: touch.clientX, lastY: touch.clientY,
      moved: false, anchor: cellAt(touch.clientX, touch.clientY), selecting: selecting(), application: false };
    if (gesture.selecting) selectTo(gesture.anchor);
    else holdTimer = setTimeout(() => {
      holdTimer = undefined;
      if (!gesture) return;
      gesture.selecting = true;
      gesture.application = !terminal.options.selectOnDrag && !!terminal.wasmTerm?.hasMouseTracking();
      if (gesture.application) {
        // Use Ghostty's normal mouse encoding and the same inner-pane mode as desktop.
        mouse("mousedown", gesture.x, gesture.y);
      } else selectTo(gesture.anchor);
      // Keep keyboard/viewport geometry stable while the finger is down.
      notice(gesture.application ? "Drag to select in application" : "Drag to select · then tap Copy");
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
      if (gesture.application) mouse("mousemove", touch.clientX, touch.clientY);
      else selectTo(cellAt(touch.clientX, touch.clientY));
    } else {
      container.querySelector("canvas")?.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, deltaY: gesture.lastY - touch.clientY,
        clientX: touch.clientX, clientY: touch.clientY,
      }));
    }
    gesture.lastX = touch.clientX;
    gesture.lastY = touch.clientY;
  }, { capture: true, passive: false });
  container.addEventListener("touchend", (event) => {
    event.stopImmediatePropagation();
    // Suppress compatibility mouse events, including after multi-touch cancellation.
    event.preventDefault();
    clearHold();
    if (gesture?.selecting) {
      const touch = [...event.changedTouches].find((touch) => touch.identifier === gesture!.id);
      if (touch) {
        if (gesture.application) {
          if (touch.clientX !== gesture.lastX || touch.clientY !== gesture.lastY) mouse("mousemove", touch.clientX, touch.clientY);
          gesture.lastX = touch.clientX;
          gesture.lastY = touch.clientY;
        } else selectTo(cellAt(touch.clientX, touch.clientY));
      }
    } else if (gesture && !gesture.moved) {
      // Defer the entire click until release: a swipe must never press a TUI row.
      // Bypass the canvas focus listener so taps don't summon the software keyboard.
      for (const type of ["mousedown", "mouseup"]) {
        mouse(type, gesture.x, gesture.y);
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
