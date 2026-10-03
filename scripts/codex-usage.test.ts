import { describe, expect, test } from "bun:test";
import { formatWindow } from "./codex-usage";

describe("formatWindow", () => {
  test("shows remaining percentage and rolling window", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(
      formatWindow({
        usedPercent: 37,
        windowDurationMins: 300,
        resetsAt: nowSeconds + 7_200,
      }),
    ).toMatch(/^5 hour\s+63% left\s+resets in 2h/);
  });

  test("formats a weekly window", () => {
    expect(formatWindow({ usedPercent: 100, windowDurationMins: 10_080 })).toContain(
      "1 week     0% left",
    );
  });
});
