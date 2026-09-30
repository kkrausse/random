import { expect, test } from "bun:test";
import type { Terminal } from "@random/ghostty-web";
import { terminalLinkAt } from "./links";

function fixture(rows: string[], wrapped: number[] = [], history = 0, offset = 0, uri: string | null = null) {
  const lines = rows.map((text, y) => ({
    length: text.length, isWrapped: wrapped.includes(y),
    getCell: (x: number) => ({ getCodepoint: () => text.charCodeAt(x), getWidth: () => 1, getHyperlinkId: () => uri ? 1 : 0 }),
  }));
  return {
    cols: 20, rows: 3,
    element: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 5, top: 10 }) }) },
    renderer: { getMetrics: () => ({ width: 10, height: 20 }) },
    buffer: { active: { getLine: (y: number) => lines[y] } },
    getViewportY: () => offset,
    wasmTerm: { getScrollbackLength: () => history, getHyperlinkUri: () => uri, getScrollbackHyperlinkUri: () => uri },
  } as unknown as Terminal;
}

test("mobile hit testing resolves the complete URL on a continuation row", () => {
  const t = fixture(["https://example.com/a", "/long/path          "], [1]);
  expect(terminalLinkAt(t, 20, 35)).toBe("https://example.com/a/long/path");
  expect(terminalLinkAt(t, 190, 35)).toBeUndefined();
  expect(terminalLinkAt(t, 0, 35)).toBeUndefined();
});

test("hit testing accounts for canvas position and scrolled history", () => {
  const t = fixture(["history", "https://example.com", "screen"], [], 2, 1.5);
  expect(terminalLinkAt(t, 10, 15)).toBe("https://example.com");
});

test("explicit hyperlinks open their target, even when the label isn't a URL", () => {
  const t = fixture(["Open this page", "continued label"], [], 0, 0, "https://example.com/full/path");
  expect(terminalLinkAt(t, 10, 15)).toBe("https://example.com/full/path");
  expect(terminalLinkAt(t, 10, 35)).toBe("https://example.com/full/path");
});

test("unsafe explicit hyperlink schemes are not opened", () => {
  expect(terminalLinkAt(fixture(["click"], [], 0, 0, "javascript:alert(1)"), 10, 15)).toBeUndefined();
});
