import type { Terminal } from "@random/ghostty-web";

// Tmux owns shell history and the copy-mode highlight. Feed it wheel events
// while a drag is held at the viewport edge; its copy mode extends the
// selection as it scrolls. Mouse-aware applications keep their own routing.
export function installTmuxSelection(
  container: HTMLElement,
  terminal: Terminal,
  isApplicationMouse: () => boolean,
  finish: () => void,
  begin: () => void,
) {
  let dragging = false;
  let moved = false;
  let edge = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let releasing = false;
  let forwarding = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { clearInterval(timer); timer = undefined; edge = 0; };
  const tick = () => {
    const canvas = terminal.renderer?.getCanvas();
    if (!canvas || !dragging || !moved || isApplicationMouse()) { stop(); return; }
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, deltaMode: 1, deltaY: edge * 2,
      clientX: Math.max(rect.left + 1, Math.min(x, rect.right - 1)),
      clientY: edge < 0 ? rect.top + 1 : rect.bottom - 1,
    }));
  };
  const move = (event: MouseEvent) => {
    if (!dragging || forwarding) return;
    if (!(event.buttons & 1)) { up(event); return; }
    moved = moved || Math.hypot(event.clientX - startX, event.clientY - startY) > 4;
    x = event.clientX;
    y = event.clientY;
    const canvas = terminal.renderer?.getCanvas();
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !moved || isApplicationMouse()) { stop(); return; }
    if (canvas && !container.contains(event.target as Node)) {
      forwarding = true;
      canvas.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true, button: 0, buttons: 1,
        clientX: Math.max(rect.left + 1, Math.min(event.clientX, rect.right - 1)),
        clientY: Math.max(rect.top + 1, Math.min(event.clientY, rect.bottom - 1)),
      }));
      forwarding = false;
    }
    const next = event.clientY < rect.top + 24 ? -1 : event.clientY > rect.bottom - 24 ? 1 : 0;
    if (next === edge) return;
    stop();
    edge = next;
    if (edge) timer = setInterval(tick, 150);
  };
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || event.shiftKey || isApplicationMouse()) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    x = startX;
    y = startY;
    begin();
  };
  const up = (event?: MouseEvent) => {
    // InputHandler listens on the terminal element, not document. Deliver a
    // clamped release when the pointer leaves it so its pressed-button state
    // cannot leak into the next drag.
    if (dragging && !releasing && (!event || !container.contains(event.target as Node))) {
      const canvas = terminal.renderer?.getCanvas();
      const rect = canvas?.getBoundingClientRect();
      if (canvas && rect) {
        releasing = true;
        canvas.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true, button: 0, buttons: 0,
          clientX: Math.max(rect.left + 1, Math.min(event?.clientX ?? x, rect.right - 1)),
          clientY: Math.max(rect.top + 1, Math.min(event?.clientY ?? y, rect.bottom - 1)),
        }));
        releasing = false;
      }
    }
    dragging = false; moved = false; stop();
  };
  container.querySelector("canvas")?.addEventListener("mousedown", down);
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  window.addEventListener("blur", () => up());
  window.addEventListener("pagehide", () => up());
  return {
    // The input handler must receive the release to reset its pressed-button
    // state, but forwarding it to tmux would invoke copy-pipe-and-cancel.
    input(data: string) {
      if (dragging && moved && !isApplicationMouse() && /^\x1b\[<0;\d+;\d+m$/.test(data)) {
        finish();
        return "";
      }
      return data;
    },
  };
}
