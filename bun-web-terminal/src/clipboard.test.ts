import { expect, test } from "bun:test";
import { ApplicationClipboard, ClipboardRequests } from "./clipboard";

const encode = (text: string) => Buffer.from(text).toString("base64");
const osc = (text: string, end = "\x07") => `\x1b]52;c;${encode(text)}${end}`;

test("OSC 52 survives every byte boundary, preserves Unicode, and ignores other OSCs and queries", () => {
  const received: string[] = [];
  const parser = new ClipboardRequests(text => received.push(text));
  const stream = `plain\x1b]2;title\x07\x1b]52;c;?\x07${osc("hello 🌍\n你好", "\x1b\\")}${osc("second")}`;
  for (const byte of new TextEncoder().encode(stream)) parser.write(Uint8Array.of(byte));
  expect(received).toEqual(["hello 🌍\n你好", "second"]);
});

test("malformed, cancelled, oversized and reset requests do not copy; subsequent requests recover", () => {
  const received: string[] = [];
  const parser = new ClipboardRequests(text => received.push(text));
  const write = (text: string) => parser.write(new TextEncoder().encode(text));
  write("\x1b]52;c;A\x07\x1b]52;c;/w==\x07\x1b]52;c;YWJj\x18");
  write(`\x1b]52;c;${"A".repeat(4 * 1024 * 1024)}\x07`);
  write("\x1b]52;c;");
  parser.reset();
  write(`YWJj\x07${osc("recovered")}`);
  expect(received).toEqual(["recovered"]);
});

test("denied automatic copy retains exact application text for a synchronous tap retry", async () => {
  const writes: string[] = [];
  let allowed = false;
  let pending = false;
  const notices: string[] = [];
  const clipboard = new ApplicationClipboard(text => {
    writes.push(text);
    return allowed ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
  }, value => { pending = value; }, text => notices.push(text));
  clipboard.receive("application selection 🌍");
  await Promise.resolve();
  expect(pending).toBe(true);
  expect(notices).not.toContain("Copied");
  allowed = true;
  const result = clipboard.copy();
  expect(writes).toEqual(["application selection 🌍", "application selection 🌍"]);
  await result;
  expect(pending).toBe(false);
  expect(notices.at(-1)).toBe("Copied");
});

test("stale clipboard completions cannot dismiss a newer copy or survive reset", async () => {
  const completions: (() => void)[] = [];
  let pending = false;
  const notices: string[] = [];
  const clipboard = new ApplicationClipboard(() => new Promise<void>(resolve => completions.push(resolve)),
    value => { pending = value; }, text => notices.push(text));
  clipboard.receive("first");
  clipboard.receive("second");
  completions[0]!();
  await Promise.resolve();
  expect(pending).toBe(true);
  expect(notices).toEqual([]);
  clipboard.reset();
  completions[1]!();
  await Promise.resolve();
  expect(pending).toBe(false);
  expect(notices).toEqual([]);
});
