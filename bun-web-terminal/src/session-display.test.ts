import { expect, test } from "bun:test";
import { hasAutomaticSessionName, sessionLabel } from "./session-display";

test("uses the current process for automatically named sessions", () => {
  expect(hasAutomaticSessionName("0")).toBe(true);
  expect(sessionLabel({ name: "0", command: "claude" })).toBe("claude");
  expect(sessionLabel({ name: "12", command: "opencode2" })).toBe("opencode2");
  expect(sessionLabel({ name: "3", command: "" })).toBe("Shell");
});

test("keeps explicit session names", () => {
  expect(hasAutomaticSessionName("My terminal")).toBe(false);
  expect(sessionLabel({ name: "My terminal", command: "claude" })).toBe("My terminal");
});
