import type { MediaBrowserItem } from "./types";

export const DEFAULT_MEDIA_GROUP_GAP_HOURS = 12;

export type MediaGroup = {
	id: string;
	label: string;
	items: MediaBrowserItem[];
};

export function groupMediaByGap(
	items: MediaBrowserItem[],
	gapHours = DEFAULT_MEDIA_GROUP_GAP_HOURS,
): MediaGroup[] {
	const timed = items
		.filter((item) => item.effectiveCapturedAt !== null)
		.sort(
			(a, b) =>
				Date.parse(a.effectiveCapturedAt ?? "") -
				Date.parse(b.effectiveCapturedAt ?? ""),
		);
	const groups: MediaGroup[] = [];
	const gapMs = Math.max(0, gapHours) * 60 * 60 * 1000;

	for (const item of timed) {
		const timestamp = Date.parse(item.effectiveCapturedAt ?? "");
		if (!Number.isFinite(timestamp)) continue;
		const current = groups.at(-1);
		const previousTimestamp = current?.items.at(-1)?.effectiveCapturedAt;
		if (
			!current ||
			!previousTimestamp ||
			timestamp - Date.parse(previousTimestamp) > gapMs
		) {
			groups.push({
				id: `time-${item.id}`,
				label: "",
				items: [item],
			});
		} else {
			current.items.push(item);
		}
	}
	for (const group of groups) {
		group.label = formatGroupLabel(group.items);
	}

	const unknown = items.filter(
		(item) =>
			item.effectiveCapturedAt === null ||
			!Number.isFinite(Date.parse(item.effectiveCapturedAt)),
	);
	if (unknown.length) {
		groups.push({
			id: "unknown-time",
			label: "Unknown time",
			items: unknown,
		});
	}
	return groups;
}

export function toggleMediaSelection(
	selection: ReadonlySet<string>,
	ids: Iterable<string>,
	selected?: boolean,
): Set<string> {
	const next = new Set(selection);
	const values = Array.from(ids);
	const shouldSelect = selected ?? values.some((id) => !next.has(id));
	for (const id of values) {
		if (shouldSelect) next.add(id);
		else next.delete(id);
	}
	return next;
}

function formatGroupLabel(items: MediaBrowserItem[]) {
	const first = new Date(items[0]?.effectiveCapturedAt ?? "");
	const last = new Date(items.at(-1)?.effectiveCapturedAt ?? "");
	const date = new Intl.DateTimeFormat("en", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const dateTime = new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
	const time = new Intl.DateTimeFormat("en", {
		hour: "numeric",
		minute: "2-digit",
	});
	if (first.toDateString() === last.toDateString()) {
		return first.getTime() === last.getTime()
			? dateTime.format(first)
			: `${date.format(first)} · ${time.format(first)} – ${time.format(last)}`;
	}
	return `${dateTime.format(first)} – ${dateTime.format(last)}`;
}
