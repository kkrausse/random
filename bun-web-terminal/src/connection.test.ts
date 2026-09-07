import { afterEach, expect, spyOn, test } from "bun:test";
import { TerminalConnection } from "./connection";

const originals = new Map<string, PropertyDescriptor | undefined>();
const cleanups: (() => void)[] = [];

function replace(name: string, value: unknown) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

function fixture() {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let next = 0;
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
    timers.set(++next, { callback, delay });
    return next;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation((id) => { timers.delete(Number(id)); });
  cleanups.push(() => { timeout.mockRestore(); clear.mockRestore(); });
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    onerror?: () => void;
    constructor() { sockets.push(this); }
    send() {}
    // Model a dead network: closing never delivers a close event.
    close() { this.readyState = 2; }
    ready() {
      this.readyState = 1;
      this.onmessage?.({ data: JSON.stringify({ type: "ready", attachmentId: "attachment" }) });
    }
  }
  replace("WebSocket", Socket);
  replace("document", { hidden: false });
  replace("navigator", { onLine: true });
  replace("location", { protocol: "http:", host: "localhost" });
  const statuses: string[] = [];
  const connection = new TerminalConnection("session", {
    size: () => ({ cols: 80, rows: 24 }), reset() {}, write() {}, mouseMode() {},
    status: (value) => statuses.push(value),
  });
  cleanups.push(() => connection.dispose());
  function fire(delay: number) {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    expect(entry).toBeDefined();
    timers.delete(entry![0]);
    entry![1].callback();
  }
  return { connection, sockets, statuses, fire, timers };
}

test("stalled handshake retries without waiting for socket close", () => {
  const f = fixture();
  f.fire(8_000);
  expect(f.statuses.at(-1)).toBe("reconnecting");
  f.fire(250);
  expect(f.sockets).toHaveLength(2);
  f.sockets[0]!.onclose?.({ code: 1000 });
  expect(f.statuses.at(-1)).toBe("reconnecting");
});

test("successful attachment resets backoff and heartbeat timeout forces recovery", () => {
  const f = fixture();
  f.sockets[0]!.onerror?.();
  f.fire(250);
  f.sockets[1]!.onerror?.();
  f.fire(500);
  f.sockets[2]!.ready();
  f.fire(3_000);
  f.fire(250);
  expect(f.sockets).toHaveLength(4);
});

test("takeover stays manual and refresh bypasses stopped state", () => {
  const f = fixture();
  f.sockets[0]!.onclose?.({ code: 4002 });
  f.connection.restore();
  expect(f.statuses.at(-1)).toBe("detached");
  expect(f.timers.size).toBe(0);
  expect(f.sockets).toHaveLength(1);
  f.connection.refresh();
  expect(f.sockets).toHaveLength(2);
});

test("manual refresh cancels pending automatic retries", () => {
  const f = fixture();
  f.sockets[0]!.onerror?.();
  f.connection.refresh();
  expect([...f.timers.values()].map((timer) => timer.delay)).toEqual([8_000]);
  expect(f.sockets).toHaveLength(2);
});
