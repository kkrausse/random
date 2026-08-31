import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyExifOrientation } from "./image-orientation";

describe("EXIF image orientation", () => {
	for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
		it(`applies orientation ${orientation}`, async () => {
			const input = await sharp({
				create: {
					width: 3,
					height: 2,
					channels: 3,
					background: "black",
				},
			})
				.composite([
					{
						input: Buffer.from([255, 0, 0]),
						raw: { width: 1, height: 1, channels: 3 },
						left: 0,
						top: 0,
					},
					{
						input: Buffer.from([0, 255, 0]),
						raw: { width: 1, height: 1, channels: 3 },
						left: 2,
						top: 1,
					},
				])
				.png()
				.toBuffer();
			const tagged = await sharp(input)
				.withMetadata({ orientation })
				.png()
				.toBuffer();
			const expected = await sharp(tagged)
				.autoOrient()
				.raw()
				.toBuffer({ resolveWithObject: true });
			const actual = await applyExifOrientation(sharp(input), orientation)
				.raw()
				.toBuffer({ resolveWithObject: true });

			expect(actual.info.width).toBe(expected.info.width);
			expect(actual.info.height).toBe(expected.info.height);
			expect(actual.data).toEqual(expected.data);
		});
	}
});
