import { expect, test } from "bun:test";
import { hasAutomaticSessionName, sessionLabel } from "./session-display";

test("uses the current process for sessions still called by their id", () => {
  expect(hasAutomaticSessionName({ id: "1", name: "1" })).toBe(true);
  expect(sessionLabel({ id: "1", name: "1", command: "claude" })).toBe("claude");
  expect(sessionLabel({ id: "12-phone", name: "12-phone", command: "opencode2" })).toBe("opencode2");
  expect(sessionLabel({ id: "3", name: "3", command: "" })).toBe("Shell");
});

test("keeps explicit session names", () => {
  expect(hasAutomaticSessionName({ id: "3", name: "My terminal" })).toBe(false);
  expect(sessionLabel({ id: "3", name: "My terminal", command: "claude" })).toBe("My terminal");
  expect(sessionLabel({ id: "3", name: "7", command: "claude" })).toBe("7");
});
