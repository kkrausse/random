import { OSC8LinkProvider, UrlRegexProvider, type ILink, type Terminal } from "@random/ghostty-web";

// These built-in providers are synchronous. Resolve and open during touchend,
// not Ghostty's async click handler, so mobile browsers retain user activation.
export function terminalLinkAt(terminal: Terminal, x: number, y: number): string | undefined {
  const canvas = terminal.element?.querySelector("canvas");
  const metrics = terminal.renderer?.getMetrics();
  const wasm = terminal.wasmTerm;
  if (!canvas || !metrics || !wasm) return;
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor((x - rect.left) / metrics.width);
  const row = Math.floor((y - rect.top) / metrics.height);
  if (col < 0 || col >= terminal.cols || row < 0 || row >= terminal.rows) return;
  const bufferRow = wasm.getScrollbackLength() - Math.floor(terminal.getViewportY()) + row;
  for (const provider of [new OSC8LinkProvider(terminal), new UrlRegexProvider(terminal)]) {
    let found: ILink | undefined;
    provider.provideLinks(bufferRow, links => {
      found = links?.find(({ range }) =>
        (bufferRow > range.start.y || (bufferRow === range.start.y && col >= range.start.x)) &&
        (bufferRow < range.end.y || (bufferRow === range.end.y && col <= range.end.x)));
    });
    if (found && /^(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)/i.test(found.text)) return found.text;
  }
}

// Desktop: Cmd+click (Ctrl+click off macOS) opens the link under the pointer.
// The whole press/release/click is swallowed at window capture so neither a
// mouse-aware application nor the selection sees it, and so the wrapper's own
// asynchronous click handler cannot open the same link a second time.
export function installLinkClicks(container: HTMLElement, terminal: Terminal) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  let pressed: string | undefined;
  const swallow = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
  window.addEventListener("mousedown", (event) => {
    pressed = undefined;
    if (event.button !== 0 || !(mac ? event.metaKey : event.ctrlKey) || !container.contains(event.target as Node)) return;
    pressed = terminalLinkAt(terminal, event.clientX, event.clientY);
    if (pressed) swallow(event);
  }, { capture: true });
  window.addEventListener("mouseup", (event) => {
    if (!pressed || event.button !== 0) return;
    swallow(event);
    if (terminalLinkAt(terminal, event.clientX, event.clientY) === pressed) window.open(pressed, "_blank", "noopener,noreferrer");
  }, { capture: true });
  window.addEventListener("click", (event) => {
    if (!pressed) return;
    pressed = undefined;
    swallow(event);
  }, { capture: true });
}
