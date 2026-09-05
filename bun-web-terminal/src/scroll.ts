// Trackpads emit many sub-line events. Preserve the fractions instead of
// turning every event into at least one application mouse/arrow event.
export class WheelAccumulator {
  private remainder = 0;
  private lastAt = 0;
  private lastMode = "";

  steps(delta: number, deltaMode: number, lineHeight: number, rows: number, mode: string, now: number) {
    const lines = deltaMode === 1 ? delta : deltaMode === 2 ? delta * rows : delta / lineHeight;
    if (now - this.lastAt > 200 || mode !== this.lastMode || Math.sign(lines) !== Math.sign(this.remainder)) this.remainder = 0;
    this.lastAt = now;
    this.lastMode = mode;
    this.remainder += lines * 0.35;
    const whole = Math.trunc(this.remainder);
    this.remainder -= whole;
    return Math.max(-8, Math.min(8, whole));
  }
}

export function installScrolling(container: HTMLElement, metrics: () => { lineHeight: number; rows: number; mode: string }) {
  const accumulator = new WheelAccumulator();
  let forwarding = false;
  const handler = (event: WheelEvent) => {
    if (forwarding) return;
    if (event.ctrlKey) { event.stopImmediatePropagation(); return; } // Browser pinch-to-zoom.
    event.preventDefault();
    event.stopImmediatePropagation();
    const { lineHeight, rows, mode } = metrics();
    const steps = accumulator.steps(event.deltaY, event.deltaMode, lineHeight, rows, mode, performance.now());
    forwarding = true;
    try {
      for (let i = 0; i < Math.abs(steps); i++) {
        // Route through the emulator so it retains ownership of mouse encoding,
        // alternate-screen fallback, and scrollback behavior.
        (event.target ?? container).dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, deltaMode: 1, deltaY: Math.sign(steps),
          clientX: event.clientX, clientY: event.clientY,
          shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
        }));
      }
    } finally { forwarding = false; }
  };
  container.addEventListener("wheel", handler, { capture: true, passive: false });
  return () => container.removeEventListener("wheel", handler, { capture: true });
}
