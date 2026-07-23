import type { Sharp } from "sharp";

export function applyExifOrientation(
	image: Sharp,
	orientation: unknown,
): Sharp {
	switch (Number(orientation)) {
		case 2:
			return image.flop();
		case 3:
			return image.rotate(180);
		case 4:
			return image.flip();
		case 5:
			return image.rotate(90).flip();
		case 6:
			return image.rotate(90);
		case 7:
			return image.rotate(90).flop();
		case 8:
			return image.rotate(270);
		default:
			return image;
	}
}
