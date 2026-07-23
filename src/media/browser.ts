import type { MediaBrowserItem } from "./types";

export type MediaGroup = {
	id: string;
	label: string;
	items: MediaBrowserItem[];
};

export function groupMediaByDay(items: MediaBrowserItem[]): MediaGroup[] {
	const timed = items
		.filter((item) => item.effectiveCapturedAt !== null)
		.sort(
			(a, b) =>
				Date.parse(a.effectiveCapturedAt ?? "") -
				Date.parse(b.effectiveCapturedAt ?? ""),
		);
	const groups: MediaGroup[] = [];

	for (const item of timed) {
		const timestamp = Date.parse(item.effectiveCapturedAt ?? "");
		if (!Number.isFinite(timestamp)) continue;
		const date = new Date(timestamp);
		const id = formatLocalDateId(date);
		const current = groups.at(-1);
		if (!current || current.id !== id) {
			groups.push({
				id,
				label: formatDayLabel(date),
				items: [item],
			});
		} else {
			current.items.push(item);
		}
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

function formatLocalDateId(date: Date) {
	return `day-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(date: Date) {
	return new Intl.DateTimeFormat("en", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(date);
}
