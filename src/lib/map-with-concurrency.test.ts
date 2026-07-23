import { expect, it } from "vitest";
import { mapWithConcurrency } from "./map-with-concurrency";

it("limits active workers and preserves result order", async () => {
	let active = 0;
	let peak = 0;
	const results = await mapWithConcurrency([3, 2, 1], 2, async (value) => {
		active += 1;
		peak = Math.max(peak, active);
		await Bun.sleep(value);
		active -= 1;
		return value * 2;
	});

	expect(peak).toBe(2);
	expect(results).toEqual([6, 4, 2]);
});

it("rejects an invalid worker count", async () => {
	await expect(mapWithConcurrency([], 0, async () => 1)).rejects.toThrow(
		"concurrency must be a positive integer",
	);
});
