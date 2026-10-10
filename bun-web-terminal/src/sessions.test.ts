import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ghostty } from "@random/ghostty-web/ghostty";
import { SessionManager, type Attachment, type Session } from "./sessions";
import { ClipboardRequests } from "./clipboard";

// Each test gets its own zmx socket directory, so no real session is touched.
let dir: string;
let manager: SessionManager;
const shell = process.env.SHELL;
const zmx = (...args: string[]) => Bun.spawnSync(["zmx", ...args], { env: { ...process.env, ZMX_DIR: dir, ZMX_SESSION: undefined } });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bwt-zmx-"));
  process.env.SHELL = "/bin/sh";
  manager = await SessionManager.open(import.meta.dir, dir);
});
afterEach(() => {
  manager.dispose();
  for (const name of zmx("list", "--short").stdout.toString().split("\n").filter(Boolean)) zmx("kill", name);
  rmSync(dir, { recursive: true, force: true });
  process.env.SHELL = shell;
});

async function until(check: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for terminal state");
    await Bun.sleep(20);
  }
}

// The browser's side of an attachment: the same Ghostty engine, reset on "ready".
async function browser(session: Session, cols = 100, rows = 30, acknowledge = true, extra: (data: Uint8Array) => void = () => {}) {
  const ghostty = await Ghostty.load(new URL(import.meta.resolve("@random/ghostty-web/ghostty-vt.wasm")).pathname);
  const terminal = ghostty.createTerminal(cols, rows);
  let closeCode = 0;
  let restores = 0;
  const attachment: Attachment = manager.attach(session, {
    send(data) {
      if (typeof data === "string") {
        if (JSON.parse(data).type === "ready") { restores++; terminal.write("\x1bc"); }
        return;
      }
      extra(data);
      terminal.write(data);
      let response: string | null;
      while ((response = terminal.readResponse()) !== null) attachment.input(new TextEncoder().encode(response));
      if (acknowledge) queueMicrotask(() => attachment.acknowledge(data.byteLength));
    },
    close(code) { closeCode = code; terminal.free(); },
  }, cols, rows);
  return {
    terminal, attachment,
    text: () => closeCode ? "" : Array.from({ length: rows }, (_, y) => (terminal.getLine(y) ?? []).map(cell => String.fromCodePoint(cell.codepoint || 32)).join("")).join("\n"),
    input: (value: string) => attachment.input(new TextEncoder().encode(value)),
    closed: () => closeCode,
    restores: () => restores,
  };
}

test("application OSC 52 crosses the zmx attachment into the browser clipboard parser", async () => {
  const received: string[] = [];
  const parser = new ClipboardRequests(text => received.push(text));
  const tab = await browser(await manager.create(), 100, 30, true, data => parser.write(data));
  const text = "OpenCode application copy 🌍\nsecond line";
  tab.input(`printf '\\033]52;c;${Buffer.from(text).toString("base64")}\\007'\r`);
  await until(() => received.length > 0);
  expect(received).toEqual([text]);
});

// zmx 0.8.1's snapshot carries the text but not the link, so a reattached
// terminal only regains link targets when the application repaints them.
test("embedded OSC 8 links cross the zmx attachment unchanged", async () => {
  const uri = "https://example.com/diagram";
  const tab = await browser(await manager.create(), 80, 12);
  tab.input(`'${process.execPath}' '${import.meta.dir}/fixtures/hyperlink.ts'\r`);
  await until(() => tab.text().includes("Open diagram"));
  expect(tab.terminal.getHyperlinkUri(0, 0)).toBe(uri);
  expect(tab.terminal.getHyperlinkUri(0, 11)).toBe(uri);
  expect(tab.terminal.getHyperlinkUri(0, 12)).toBeNull();
});

test("zmx restores a live alternate screen, coalesces resize storms, nudges a redraw, and survives slow attachments", async () => {
  const session = await manager.create();
  const first = await browser(session);
  await until(() => first.restores() === 1);
  // Nothing sits between the application and the browser's emulator any more.
  expect(first.terminal.hasMouseTracking()).toBe(false);
  first.input(`'${process.execPath}' '${import.meta.dir}/fixtures/tui.ts'\r`);
  await until(() => first.text().includes("ATTACHMENT-FIXTURE count=0"));
  await until(() => first.terminal.hasMouseTracking());
  expect(first.terminal.isAlternateScreen()).toBe(true);
  // The detach key of zmx's own client is the application's to handle here.
  first.input("\x1c+");
  await until(() => first.text().includes("count=1"));
  manager.dispose();
  expect(first.closed()).toBe(1001);
  manager = await SessionManager.open(import.meta.dir, dir);
  const restored = manager.sessions.get(session.id)!;
  expect(restored.name).toBe(session.name);
  expect(restored.createdAt).toEqual(session.createdAt);
  expect(restored.command).toBe("bun");
  const second = await browser(restored);
  await until(() => second.text().includes("ATTACHMENT-FIXTURE count=1"));
  expect(second.terminal.hasMouseTracking()).toBe(true);
  expect(second.terminal.isAlternateScreen()).toBe(true);
  const resizes = () => Number(second.text().match(/resizes=(\d+)/)?.[1]);
  await until(() => second.text().includes("size=100x30"));
  await Bun.sleep(200);
  const before = resizes();
  second.attachment.redraw();
  await until(() => second.text().includes("size=100x29"));
  await until(() => second.text().includes("size=100x30"));
  expect(resizes()).toBe(before + 2);
  for (let i = 0; i < 300; i++) second.attachment.resize(80 + i % 40, 24 + i % 10);
  second.terminal.resize(110, 28);
  second.attachment.resize(110, 28);
  await until(() => second.text().includes("size=110x28"));
  expect(resizes()).toBe(before + 3);

  const slow = await browser(restored, 110, 28, false);
  expect(second.closed()).toBe(4002);
  await until(() => slow.text().includes("count=1"));
  slow.input("f");
  await until(() => slow.closed() === 1013, 15_000);
  const recovered = await browser(restored, 110, 28);
  await until(() => recovered.text().includes("ATTACHMENT-FIXTURE count=1"));
  recovered.input("+");
  await until(() => recovered.text().includes("count=2"));
  recovered.input("q");
  await until(() => !recovered.terminal.hasMouseTracking());
  await manager.remove(restored);
  expect(recovered.closed()).toBe(4004);
  expect(manager.sessions.size).toBe(0);
}, 40_000);

test("discovers existing zmx sessions and tracks renames and external removal", async () => {
  // zmx creates a session from an attached client, which needs a terminal.
  const client = Bun.spawn(["zmx", "attach", "existing", "sleep", "60"], {
    env: { ...process.env, ZMX_DIR: dir, ZMX_SESSION: undefined }, terminal: { cols: 80, rows: 24, data() {} },
  });
  try {
    await until(() => { void manager.refresh(); return manager.sessions.has("existing"); });
    await until(() => manager.sessions.get("existing")?.command === "sleep");
    const created = await manager.create("phone");
    expect(created.id).toBe("1-phone");
    expect(created.name).toBe("1-phone");
    expect(created.cwd).toBe(import.meta.dir);
    expect((await manager.create()).id).toBe("2");
    const pid = () => zmx("list").stdout.toString().match(/name=1-phone\tpid=(\d+)/)?.[1];
    const before = pid();
    expect(before).toBeDefined();
    await manager.rename(created, "My terminal: 2.0");
    expect(manager.sessions.get("1-phone")?.name).toBe("My terminal: 2.0");
    await manager.refresh();
    expect(manager.sessions.get("1-phone")?.name).toBe("My terminal: 2.0");
    expect(pid()).toBe(before);
    for (const name of ["", "  ", "bad\nname", "x".repeat(129)]) {
      expect(manager.rename(created, name)).rejects.toThrow();
    }
    expect(created.name).toBe("My terminal: 2.0");
    zmx("set", "existing", "label=renamed");
    await manager.refresh();
    expect(manager.sessions.get("existing")?.name).toBe("renamed");
    await manager.remove(created);
    await manager.remove(manager.sessions.get("2")!);
    zmx("kill", "existing");
    await until(() => { void manager.refresh(); return manager.sessions.size === 0; });
  } finally {
    client.kill();
  }
});
