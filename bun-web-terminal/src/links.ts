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
