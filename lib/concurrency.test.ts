import { describe, expect, test } from "bun:test";
import { concurrentMap } from "./concurrency";

describe("concurrentMap", () => {
  test("dynamically feeds workers and preserves input order", async () => {
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const gates = [0, 1, 2].map(() => new Promise<void>((resolve) => releases.push(resolve)));
    const mapping = concurrentMap(["a", "b", "c"], 2, async (item, index) => {
      started.push(index);
      await gates[index];
      return `${item}${index}`;
    });

    await Bun.sleep(0);
    expect(started).toEqual([0, 1]);
    releases[1]!();
    await Bun.sleep(0);
    expect(started).toEqual([0, 1, 2]);
    releases[0]!();
    releases[2]!();
    expect(await mapping).toEqual(["a0", "b1", "c2"]);
  });

  test("rejects invalid concurrency", async () => {
    await expect(concurrentMap([1], 0, async (value) => value)).rejects.toThrow("positive integer");
  });

  test("waits for in-flight work and stops scheduling after a failure", async () => {
    const completed: number[] = [];
    const task = concurrentMap([0, 1, 2], 2, async (value) => {
      if (value === 0) throw new Error("failed");
      await Bun.sleep(5);
      completed.push(value);
      return value;
    });

    await expect(task).rejects.toThrow("failed");
    expect(completed).toEqual([1]);
  });
});
