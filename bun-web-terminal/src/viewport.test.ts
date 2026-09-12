import { expect, test } from "bun:test";
import { terminalViewport } from "./viewport";

test("keyboard open/close and rotation recover dimensions even while zoomed", () => {
  const sizes = [
    { height: 800, scale: 1, offsetTop: 0 },
    { height: 450, scale: 1, offsetTop: 30 },
    { height: 300, scale: 1.5, offsetTop: 80 },
    { height: 800 / 1.5, scale: 1.5, offsetTop: 100 },
    { height: 400 / 1.5, scale: 1.5, offsetTop: 50 },
    { height: 400, scale: 1, offsetTop: 0 },
  ];
  expect(sizes.map(viewport => terminalViewport(viewport, 800))).toEqual([
    { height: 800, top: 0 }, { height: 450, top: 30 },
    { height: 450, top: 0 }, { height: 800, top: 0 },
    { height: 400, top: 0 }, { height: 400, top: 0 },
  ]);
});

test("pinch zoom does not shrink the terminal's CSS height", () => {
  for (const scale of [1, 1.25, 2, 3]) {
    expect(terminalViewport({ height: 810 / scale, scale, offsetTop: 0 }, 810).height).toBe(810);
  }
  expect(terminalViewport(null, 600)).toEqual({ height: 600, top: 0 });
});
