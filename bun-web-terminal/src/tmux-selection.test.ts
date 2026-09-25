import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Terminal } from "@random/ghostty-web";
import { installTmuxSelection } from "./tmux-selection";

const globals = ["window", "document", "MouseEvent", "WheelEvent"] as const;
let saved: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  class PointerEvent extends Event {
    button: number; buttons: number; clientX: number; clientY: number; shiftKey: boolean; deltaY: number;
    constructor(type: string, options: Record<string, any> = {}) {
      super(type, { bubbles: options.bubbles });
      this.button = options.button ?? 0;
      this.buttons = options.buttons ?? 0;
      this.clientX = options.clientX ?? 0;
      this.clientY = options.clientY ?? 0;
      this.shiftKey = options.shiftKey ?? false;
      this.deltaY = options.deltaY ?? 0;
    }
  }
  Object.assign(globalThis, { window: new EventTarget(), document: new EventTarget(), MouseEvent: PointerEvent, WheelEvent: PointerEvent });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  globals.forEach((key, index) => {
    if (saved[index]) Object.defineProperty(globalThis, key, saved[index]!);
    else Reflect.deleteProperty(globalThis, key);
  });
});

test("shell drag at the top sends repeated wheel events, keeps release local, and stops on mouseup", async () => {
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 300 }) });
  const container = Object.assign(new EventTarget(), { querySelector: () => canvas, contains: (target: unknown) => target === canvas });
  const terminal = { renderer: { getCanvas: () => canvas } } as unknown as Terminal;
  const wheels: number[] = [];
  const finishes: string[] = [];
  canvas.addEventListener("wheel", event => wheels.push((event as WheelEvent).deltaY));
  const selection = installTmuxSelection(container as unknown as HTMLElement, terminal, () => false,
    () => finishes.push("finish"), () => {});
  canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0, buttons: 1, clientY: 150 }));
  document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientY: 5, clientX: 200 }));
  await Bun.sleep(330);
  expect(wheels).toEqual([-2, -2]);
  expect(selection.input("\x1b[<32;20;1M")).toBe("\x1b[<32;20;1M");
  expect(selection.input("\x1b[<0;20;1m")).toBe("");
  expect(finishes).toEqual(["finish"]);
  document.dispatchEvent(new MouseEvent("mouseup", { clientY: 5 }));
  await Bun.sleep(180);
  expect(wheels).toHaveLength(2);
});

test("application and Shift drags do not start tmux edge scrolling", async () => {
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 300 }) });
  const container = Object.assign(new EventTarget(), { querySelector: () => canvas, contains: () => true });
  const terminal = { renderer: { getCanvas: () => canvas } } as unknown as Terminal;
  const wheels: number[] = [];
  canvas.addEventListener("wheel", event => wheels.push((event as WheelEvent).deltaY));
  let application = true;
  const selection = installTmuxSelection(container as unknown as HTMLElement, terminal, () => application, () => {}, () => {});
  canvas.dispatchEvent(new MouseEvent("mousedown", { buttons: 1 }));
  document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientY: 5 }));
  application = false;
  canvas.dispatchEvent(new MouseEvent("mousedown", { shiftKey: true, buttons: 1 }));
  document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientY: 5 }));
  await Bun.sleep(180);
  expect(wheels).toEqual([]);
  expect(selection.input("\x1b[<0;1;1m")).not.toBe("");
});

test("dragging outside the bottom forwards motion and release and scrolls down", async () => {
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 300 }) });
  const container = Object.assign(new EventTarget(), { querySelector: () => canvas, contains: (target: unknown) => target === canvas });
  const terminal = { renderer: { getCanvas: () => canvas } } as unknown as Terminal;
  const events: string[] = [];
  for (const type of ["mousemove", "mouseup", "wheel"]) canvas.addEventListener(type, () => events.push(type));
  const selection = installTmuxSelection(container as unknown as HTMLElement, terminal, () => false,
    () => events.push("finish"), () => {});
  canvas.dispatchEvent(new MouseEvent("mousedown", { buttons: 1, clientX: 100, clientY: 150 }));
  document.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: 100, clientY: 350 }));
  await Bun.sleep(180);
  expect(events).toContain("mousemove");
  expect(events).toContain("wheel");
  document.dispatchEvent(new MouseEvent("mouseup", { clientX: 100, clientY: 350 }));
  expect(events).toContain("mouseup");
  expect(selection.input("\x1b[<0;10;12m")).toBe("\x1b[<0;10;12m");
});
