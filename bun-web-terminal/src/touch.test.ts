import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Terminal } from "../vendor/ghostty-web/lib/index";
import { installTerminalTouchControls } from "./touch";

// Exercise the actual event handlers; only DOM geometry and terminal output are stubbed.
const globals = ["window", "document", "MouseEvent", "WheelEvent"] as const;
let saved: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  class InputEvent extends Event {
    constructor(type: string, options: EventInit) {
      super(type, options);
      for (const [key, value] of Object.entries(options)) if (!(key in this)) Object.assign(this, { [key]: value });
    }
  }
  Object.assign(globalThis, { window: new EventTarget(), document: new EventTarget(), MouseEvent: InputEvent, WheelEvent: InputEvent });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  globals.forEach((key, index) => {
    if (saved[index]) Object.defineProperty(globalThis, key, saved[index]!);
    else Reflect.deleteProperty(globalThis, key);
  });
});

function setup(manual = false, application = false) {
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  const container = Object.assign(new EventTarget(), { querySelector: () => canvas });
  const selections: number[][] = [];
  const clicks: string[] = [];
  const wheels: number[] = [];
  const notices: string[] = [];
  const mouseEvents: { type: string; x: number; y: number; buttons: number }[] = [];
  const terminal = {
    cols: 20, rows: 10,
    options: { selectOnDrag: !application },
    wasmTerm: { hasMouseTracking: () => true }, // tmux tracks the mouse even at a shell.
    renderer: { getMetrics: () => ({ width: 10, height: 20 }) },
    select: (...args: number[]) => selections.push(args),
  };
  container.addEventListener("mousedown", () => clicks.push("down"));
  container.addEventListener("mouseup", () => clicks.push("up"));
  for (const type of ["mousedown", "mousemove", "mouseup"]) container.addEventListener(type, event => {
    const mouse = event as MouseEvent;
    mouseEvents.push({ type, x: mouse.clientX, y: mouse.clientY, buttons: mouse.buttons });
  });
  canvas.addEventListener("wheel", event => wheels.push((event as WheelEvent).deltaY));
  installTerminalTouchControls(container as unknown as HTMLElement, terminal as unknown as Terminal, () => manual, message => notices.push(message));
  const touch = (type: string, x = 25, y = 45, count = 1) => {
    const point = { identifier: 1, clientX: x, clientY: y };
    const event = Object.assign(new Event(type, { cancelable: true }), {
      touches: type === "touchend" ? [] : Array.from({ length: count }, (_, i) => ({ ...point, identifier: i + 1 })),
      changedTouches: [point],
    });
    container.dispatchEvent(event);
    return event;
  };
  return { container, selections, clicks, wheels, notices, touch, mouseEvents, terminal };
}

test("hold anchors selection, drag extends in either direction, release preserves it and next swipe scrolls", async () => {
  const t = setup();
  t.touch("touchstart");
  t.touch("touchmove", 27, 46); // Normal finger jitter doesn't cancel the hold.
  await Bun.sleep(550);
  expect(t.selections).toEqual([[2, 2, 1]]);
  t.touch("touchmove", 65, 65);
  expect(t.selections.at(-1)).toEqual([2, 2, 25]);
  t.touch("touchmove", 15, 25);
  expect(t.selections.at(-1)).toEqual([1, 1, 22]);
  t.touch("touchend", 15, 25);
  expect(t.clicks).toEqual([]);
  expect(t.wheels).toEqual([]);
  expect(t.notices).toHaveLength(1);
  t.touch("touchstart");
  t.touch("touchmove", 25, 15);
  t.touch("touchend", 25, 15);
  expect(t.wheels).toEqual([30]);
  expect(t.selections.at(-1)).toEqual([1, 1, 22]);
});

test("quick taps click only on release; swipes cancel the hold even when paused", async () => {
  const t = setup();
  t.touch("touchstart");
  expect(t.clicks).toEqual([]);
  expect(t.touch("touchend").defaultPrevented).toBe(true);
  expect(t.clicks).toEqual(["down", "up"]);
  t.touch("touchstart");
  t.touch("touchmove", 25, 15);
  await Bun.sleep(550);
  t.touch("touchend", 25, 15);
  expect(t.selections).toEqual([]);
  expect(t.clicks).toEqual(["down", "up"]);
  expect(t.wheels).toEqual([30]);
});

test("multi-touch, cancellation and leaving the page disarm pending holds", async () => {
  const cases = [
    (t: ReturnType<typeof setup>) => t.touch("touchstart", 25, 45, 2),
    (t: ReturnType<typeof setup>) => t.touch("touchcancel"),
    () => window.dispatchEvent(new Event("blur")),
    () => window.dispatchEvent(new Event("pagehide")),
    () => { Object.assign(document, { hidden: true }); document.dispatchEvent(new Event("visibilitychange")); },
  ];
  const fixtures = cases.map(cancel => {
    const t = setup();
    t.touch("touchstart");
    cancel(t);
    return t;
  });
  await Bun.sleep(550);
  for (const t of fixtures) {
    t.touch("touchend");
    expect(t.selections).toEqual([]);
    expect(t.clicks).toEqual([]);
  }
});

test("manual Select still works immediately; only touch gestures suppress context menus", () => {
  const t = setup(true, true);
  const menu = () => { const event = new Event("contextmenu", { cancelable: true }); t.container.dispatchEvent(event); return event.defaultPrevented; };
  expect(menu()).toBe(false);
  t.touch("touchstart");
  expect(menu()).toBe(true);
  t.touch("touchmove", 65, 45);
  t.touch("touchend", 65, 45);
  expect(t.selections.at(-1)).toEqual([2, 2, 5]);
  expect(t.clicks).toEqual([]);
  expect(t.wheels).toEqual([]);
  expect(menu()).toBe(false);
});

test("hold delegates press, drag and release when the inner application owns the mouse", async () => {
  const t = setup(false, true);
  t.touch("touchstart");
  expect(t.mouseEvents).toEqual([]);
  await Bun.sleep(550);
  t.touch("touchmove", 65, 65);
  t.touch("touchend", 75, 65);
  expect(t.mouseEvents).toEqual([
    { type: "mousedown", x: 25, y: 45, buttons: 1 },
    { type: "mousemove", x: 65, y: 65, buttons: 1 },
    { type: "mousemove", x: 75, y: 65, buttons: 1 },
    { type: "mouseup", x: 75, y: 65, buttons: 0 },
  ]);
  expect(t.selections).toEqual([]);
  expect(t.wheels).toEqual([]);
  t.touch("touchstart");
  t.touch("touchmove", 25, 15);
  t.touch("touchend", 25, 15);
  expect(t.wheels).toEqual([30]);
  expect(t.mouseEvents).toHaveLength(4);
});

test("canceling an application drag releases its mouse button exactly once", async () => {
  const fixtures = Array.from({ length: 4 }, () => setup(false, true));
  for (const t of fixtures) t.touch("touchstart");
  await Bun.sleep(550);
  fixtures[0]!.touch("touchcancel");
  fixtures[1]!.touch("touchstart", 25, 45, 2);
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("pagehide"));
  for (const t of fixtures) {
    t.touch("touchend");
    expect(t.clicks).toEqual(["down", "up"]);
    expect(t.selections).toEqual([]);
  }
});

test("without outer mouse tracking a hold still selects locally", async () => {
  const t = setup(false, true);
  t.terminal.wasmTerm.hasMouseTracking = () => false;
  t.touch("touchstart");
  await Bun.sleep(550);
  t.touch("touchend");
  expect(t.selections.at(-1)).toEqual([2, 2, 1]);
  expect(t.clicks).toEqual([]);
});
