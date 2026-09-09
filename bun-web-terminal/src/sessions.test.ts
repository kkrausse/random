import { expect, test } from "bun:test";
import { Ghostty } from "@random/ghostty-web/ghostty";
import { SessionManager, type Attachment, type Session } from "./sessions";

async function until(check: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for terminal state");
    await Bun.sleep(20);
  }
}

test("tmux restores a live alternate screen, coalesces resize storms, and survives slow attachments", async () => {
  const ghostty = await Ghostty.load(new URL(import.meta.resolve("@random/ghostty-web/ghostty-vt.wasm")).pathname);
  const socket = `bun-web-terminal-test-${crypto.randomUUID()}`;
  let manager = new SessionManager(import.meta.dir, socket);
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
    manager.dispose();
    expect(first.closed()).toBe(1001);
    manager = new SessionManager(import.meta.dir, socket);
    const restored = manager.sessions.get(session.id)!;
    expect(restored.name).toBe(session.name);
    expect(restored.createdAt).toEqual(session.createdAt);
    const second = attach(restored);
    await until(() => second.text().includes("ATTACHMENT-FIXTURE count=1"));
    await until(() => second.mouseTracking() === true);
    for (let i = 0; i < 300; i++) second.attachment.resize(80 + i % 40, 24 + i % 10);
    second.terminal.resize(110, 28);
    second.attachment.resize(110, 28);
    await until(() => second.text().includes("size=110x28"));
    expect(second.text()).toContain("resizes=1");

    const slow = attach(restored, 110, 28, false);
    expect(second.closed()).toBe(4002);
    await until(() => slow.text().includes("count=1"));
    slow.input("f");
    await until(() => slow.closed() === 1013, 12_000);
    expect(restored.title).toContain("bun");
    const recovered = attach(restored, 110, 28);
    await until(() => recovered.text().includes("ATTACHMENT-FIXTURE count=1"));
    recovered.input("+");
    await until(() => recovered.text().includes("count=2"));
    recovered.input("q");
    await until(() => recovered.mouseTracking() === false);
    manager.remove(restored);
    expect(recovered.closed()).toBe(4004);
    expect(manager.sessions.size).toBe(0);
  } finally {
    manager.dispose();
    Bun.spawnSync(["tmux", "-L", socket, "kill-server"]);
    for (const terminal of terminals) terminal.free();
  }
}, 25_000);

test("discovers standard tmux sessions and tracks renames and external removal", async () => {
  const socket = `bun-web-terminal-test-${crypto.randomUUID()}`;
  const tmux = (...args: string[]) => Bun.spawnSync(["tmux", "-L", socket, "-f", "/dev/null", ...args]);
  let manager: SessionManager | undefined;
  try {
    const result = tmux("new-session", "-d", "-P", "-F", "#{session_id}", "-s", "existing", "sleep 60");
    expect(result.exitCode).toBe(0);
    const id = result.stdout.toString().trim();
    manager = new SessionManager(import.meta.dir, socket);
    expect(manager.sessions.get(id)?.name).toBe("existing");
    const prefix = tmux("show-options", "-gv", "prefix").stdout.toString();
    const created = manager.create();
    const pane = tmux("display-message", "-p", "-t", created.id, "#{pane_pid}").stdout.toString();
    manager.rename(created, "My terminal");
    expect(manager.sessions.get(created.id)?.name).toBe("My terminal");
    expect(tmux("display-message", "-p", "-t", created.id, "#{pane_pid}").stdout.toString()).toBe(pane);
    expect(() => manager!.rename(created, "existing")).toThrow();
    for (const name of ["", "  ", "bad.name", "bad:name", "bad\nname", "x".repeat(129)]) {
      expect(() => manager!.rename(created, name)).toThrow();
    }
    expect(created.name).toBe("My terminal");
    expect(tmux("show-options", "-gv", "prefix").stdout.toString()).toBe(prefix);
    tmux("rename-session", "-t", id, "renamed");
    await until(() => manager!.sessions.get(id)?.name === "renamed");
    manager.remove(created);
    tmux("kill-session", "-t", id);
    await until(() => manager!.sessions.size === 0);
  } finally {
    manager?.dispose();
    tmux("kill-server");
  }
});
