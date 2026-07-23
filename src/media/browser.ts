import type { MediaBrowserItem } from "./types";

export const MEDIA_SESSION_GAP_MS = 7 * 60 * 60 * 1000;

export type MediaSession = {
	id: string;
	label: string;
	items: MediaBrowserItem[];
};

export function groupMediaIntoSessions(
	items: MediaBrowserItem[],
): MediaSession[] {
	const timed = items
		.filter((item) => item.effectiveCapturedAt !== null)
		.sort(
			(a, b) =>
				Date.parse(a.effectiveCapturedAt ?? "") -
				Date.parse(b.effectiveCapturedAt ?? ""),
		);
	const sessions: MediaSession[] = [];

	for (const item of timed) {
		const timestamp = Date.parse(item.effectiveCapturedAt ?? "");
		if (!Number.isFinite(timestamp)) continue;
		const current = sessions.at(-1);
		const previous = current?.items.at(-1);
		const previousTimestamp = previous?.effectiveCapturedAt
			? Date.parse(previous.effectiveCapturedAt)
			: undefined;
		if (
			!current ||
			previousTimestamp === undefined ||
			timestamp - previousTimestamp > MEDIA_SESSION_GAP_MS
		) {
			sessions.push({
				id: `session-${item.id}`,
				label: formatSessionLabel(new Date(timestamp)),
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
		sessions.push({
			id: "unknown-time",
			label: "Unknown time",
			items: unknown,
		});
	}
	return sessions;
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

function formatSessionLabel(date: Date) {
	return new Intl.DateTimeFormat("en", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}
