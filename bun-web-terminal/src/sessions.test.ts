import { expect, test } from "bun:test";
import { Ghostty } from "../vendor/ghostty-web/lib/ghostty";
import { SessionManager, type Attachment, type Session } from "./sessions";

async function until(check: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for terminal state");
    await Bun.sleep(20);
  }
}

test("tmux restores a live alternate screen, coalesces resize storms, and survives slow attachments", async () => {
  const ghostty = await Ghostty.load(new URL(import.meta.resolve("ghostty-web/ghostty-vt.wasm")).pathname);
  const manager = new SessionManager(import.meta.dir);
  const terminals: ReturnType<typeof ghostty.createTerminal>[] = [];
  function attach(session: Session, cols = 100, rows = 30, acknowledge = true) {
    const terminal = ghostty.createTerminal(cols, rows);
    terminals.push(terminal);
    let attachment: Attachment;
    let closeCode = 0;
    let mouseTracking: boolean | undefined;
    attachment = manager.attach(session, {
      send(data) {
        if (typeof data === "string") {
          const message = JSON.parse(data);
          if (message.type === "mouse-mode") mouseTracking = message.tracking;
          return;
        }
        terminal.write(data);
        let response: string | null;
        while ((response = terminal.readResponse()) !== null) attachment.input(new TextEncoder().encode(response));
        if (acknowledge) queueMicrotask(() => attachment.acknowledge(data.byteLength));
      },
      close(code) { closeCode = code; },
    }, cols, rows);
    return {
      terminal, attachment,
      text: () => Array.from({ length: rows }, (_, y) => (terminal.getLine(y) ?? []).map(cell => String.fromCodePoint(cell.codepoint || 32)).join("")).join("\n"),
      input: (value: string) => attachment.input(new TextEncoder().encode(value)),
      closed: () => closeCode,
      mouseTracking: () => mouseTracking,
    };
  }
  try {
    const session = manager.create();
    const first = attach(session);
    await Bun.sleep(300);
    await until(() => first.mouseTracking() === false);
    // The outer terminal still tracks mice for tmux scrolling at a plain shell.
    expect(first.terminal.hasMouseTracking()).toBe(true);
    first.input(`'${process.execPath}' '${import.meta.dir}/fixtures/tui.ts'\r`);
    await until(() => first.text().includes("ATTACHMENT-FIXTURE count=0"));
    await until(() => first.mouseTracking() === true);
    first.input("+");
    await until(() => first.text().includes("count=1"));
    first.attachment.close();

    const second = attach(session);
    await until(() => second.text().includes("ATTACHMENT-FIXTURE count=1"));
    await until(() => second.mouseTracking() === true);
    for (let i = 0; i < 300; i++) second.attachment.resize(80 + i % 40, 24 + i % 10);
    second.terminal.resize(110, 28);
    second.attachment.resize(110, 28);
    await until(() => second.text().includes("size=110x28"));
    expect(second.text()).toContain("resizes=1");

    const slow = attach(session, 110, 28, false);
    expect(second.closed()).toBe(4002);
    await until(() => slow.text().includes("count=1"));
    slow.input("f");
    await until(() => slow.closed() === 1013, 12_000);
    expect(session.title).toContain("bun");
    const recovered = attach(session, 110, 28);
    await until(() => recovered.text().includes("ATTACHMENT-FIXTURE count=1"));
    recovered.input("+");
    await until(() => recovered.text().includes("count=2"));
    recovered.input("q");
    await until(() => recovered.mouseTracking() === false);
    manager.remove(session);
    expect(recovered.closed()).toBe(4004);
    expect(manager.sessions.size).toBe(0);
  } finally {
    manager.dispose();
    for (const terminal of terminals) terminal.free();
  }
}, 25_000);
