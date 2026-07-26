import {
	ChevronRight,
	Clock3,
	ImagePlus,
	LoaderCircle,
	Upload,
	X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import {
	DEFAULT_MEDIA_GROUP_GAP_HOURS,
	groupMediaByGap,
	toggleMediaSelection,
} from "../media/browser";
import type { MediaBrowserItem } from "../media/types";
import { Button } from "./ui/button";

type UploadState = {
	id: string;
	name: string;
	status: "waiting" | "uploading" | "processing" | "ready" | "failed";
};

export const MediaBrowser = memo(function MediaBrowser({
	tripId,
	onChanged,
	onSelectionChange,
	allowTripAssociation = true,
}: {
	tripId: string;
	onChanged: () => void;
	onSelectionChange?: (items: MediaBrowserItem[]) => void;
	allowTripAssociation?: boolean;
}) {
	const [items, setItems] = useState<MediaBrowserItem[]>([]);
	const [selection, setSelection] = useState<Set<string>>(new Set());
	const [kind, setKind] = useState<"all" | "photo" | "video">("photo");
	const [groupBy, setGroupBy] = useState<"time" | "kind">("time");
	const [groupGapHours, setGroupGapHours] = useState(
		DEFAULT_MEDIA_GROUP_GAP_HOURS,
	);
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [showTimeEditor, setShowTimeEditor] = useState(false);
	const [timeEditOperation, setTimeEditOperation] = useState<
		"shift" | "timezone"
	>("shift");
	const [timeZone, setTimeZone] = useState("America/Los_Angeles");
	const [shiftDays, setShiftDays] = useState("0");
	const [shiftHours, setShiftHours] = useState("0");
	const [shiftMinutes, setShiftMinutes] = useState("0");
	const [uploads, setUploads] = useState<UploadState[]>([]);
	const [error, setError] = useState<string>();
	const fileInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const query = new URLSearchParams({ tripId });
		if (kind !== "all") query.set("kind", kind);
		void fetch(`/api/media?${query}`).then(async (response) => {
			if (response.ok) setItems(await response.json());
		});
	}, [kind, tripId]);
	useEffect(() => {
		onSelectionChange?.(items.filter((item) => selection.has(item.id)));
	}, [items, onSelectionChange, selection]);

	async function refresh() {
		const query = new URLSearchParams({ tripId });
		if (kind !== "all") query.set("kind", kind);
		const response = await fetch(`/api/media?${query}`);
		if (response.ok) setItems(await response.json());
	}

	async function upload(files: File[]) {
		if (!files.length) return;
		setError(undefined);
		const pending = files.map((file) => ({
			id: crypto.randomUUID(),
			name: file.name,
			status: "waiting" as const,
		}));
		setUploads(pending);
		const importResponse = await fetch("/api/media/imports", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sourceName: `${files.length} browser file${files.length === 1 ? "" : "s"}`,
				items: pending.map((item) => ({
					sourceKey: item.id,
					filename: item.name,
				})),
			}),
		});
		if (!importResponse.ok) {
			setError("The upload batch could not be created.");
			return;
		}
		const importRecord = (await importResponse.json()) as { id: string };
		for (const [index, file] of files.entries()) {
			const state = pending[index];
			setUploadStatus(state.id, "uploading");
			const form = new FormData();
			form.set("file", file);
			form.set("importId", importRecord.id);
			form.set("sourceKey", state.id);
			const processingTimer = window.setTimeout(
				() => setUploadStatus(state.id, "processing"),
				500,
			);
			try {
				const response = await fetch("/api/media/upload", {
					method: "POST",
					body: form,
				});
				const result = (await response.json()) as {
					media?: { status: string };
					error?: string;
				};
				setUploadStatus(
					state.id,
					response.ok && result.media?.status === "ready" ? "ready" : "failed",
				);
				if (result.media?.status === "ready") {
					await refresh();
					onChanged();
				}
			} catch {
				setUploadStatus(state.id, "failed");
			} finally {
				window.clearTimeout(processingTimer);
			}
		}
	}

	function setUploadStatus(id: string, status: UploadState["status"]) {
		setUploads((current) =>
			current.map((item) => (item.id === id ? { ...item, status } : item)),
		);
	}

	async function attachSelected() {
		if (!attachableSelection.length) return;
		await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				attachMediaIds: attachableSelection.map((item) => item.id),
			}),
		});
		setSelection(new Set());
		await refresh();
		onChanged();
	}

	async function updateTimestamp(item: MediaBrowserItem, value: string) {
		await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				mediaTimestamp: {
					id: item.id,
					value:
						value && !item.capturedTimeZone
							? new Date(value).toISOString()
							: value || null,
					timeZone: item.capturedTimeZone,
				},
			}),
		});
		await refresh();
		onChanged();
	}

	async function shiftSelectedTimestamps(event: React.FormEvent) {
		event.preventDefault();
		const offsetMinutes =
			Number(shiftDays) * 24 * 60 +
			Number(shiftHours) * 60 +
			Number(shiftMinutes);
		if (!Number.isFinite(offsetMinutes) || offsetMinutes === 0) {
			setError("Enter a non-zero time shift.");
			return;
		}
		const response = await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				shiftMediaTimestamps: { ids: [...selection], offsetMinutes },
			}),
		});
		const result = (await response.json()) as {
			shifted?: number;
			error?: string;
		};
		if (!response.ok) {
			setError(result.error ?? "The selected timestamps could not be shifted.");
			return;
		}
		if (!result.shifted) {
			setError("None of the selected media has a capture time to shift.");
			return;
		}
		setError(undefined);
		setShowTimeEditor(false);
		setExpandedGroups(new Set());
		await refresh();
		onChanged();
	}

	async function setSelectedTimeZone(event: React.FormEvent) {
		event.preventDefault();
		if (!timeZone.trim()) {
			setError("Choose a time zone.");
			return;
		}
		const response = await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				setMediaTimeZone: { ids: [...selection], timeZone: timeZone.trim() },
			}),
		});
		const result = (await response.json()) as {
			timeZonesSet?: number;
			error?: string;
		};
		if (!response.ok) {
			setError(result.error ?? "The selected time zone could not be set.");
			return;
		}
		if (!result.timeZonesSet) {
			setError("None of the selected media has a local capture time.");
			return;
		}
		setError(undefined);
		setShowTimeEditor(false);
		setExpandedGroups(new Set());
		await refresh();
		onChanged();
	}

	const groups =
		groupBy === "time"
			? groupMediaByGap(items, groupGapHours)
			: (["photo", "video"] as const)
					.map((mediaKind) => ({
						id: `kind-${mediaKind}`,
						label: mediaKind === "photo" ? "Photos" : "Videos",
						items: items.filter((item) => item.kind === mediaKind),
					}))
					.filter((group) => group.items.length > 0);
	const attachableSelection = allowTripAssociation
		? items.filter((item) => selection.has(item.id) && !item.isInCurrentTrip)
		: [];
	return (
		<div className="media-browser">
			<div className="section-toolbar">
				<fieldset className="segmented">
					<legend className="sr-only">Media type</legend>
					{(["all", "photo", "video"] as const).map((value) => (
						<button
							className={kind === value ? "active" : ""}
							key={value}
							type="button"
							onClick={() => {
								setKind(value);
								setSelection(new Set());
								setShowTimeEditor(false);
							}}
						>
							{value}
						</button>
					))}
				</fieldset>
				<div className="grouping-controls">
					<fieldset className="segmented">
						<legend className="sr-only">Group media by</legend>
						{(["time", "kind"] as const).map((value) => (
							<button
								className={groupBy === value ? "active" : ""}
								key={value}
								type="button"
								onClick={() => {
									setGroupBy(value);
									setExpandedGroups(new Set());
								}}
							>
								{value === "time" ? "time gaps" : value}
							</button>
						))}
					</fieldset>
					{groupBy === "time" && (
						<label className="group-gap-input">
							Gap
							<input
								type="number"
								min="0.5"
								max="168"
								step="0.5"
								value={groupGapHours}
								onChange={(event) => {
									setGroupGapHours(Number(event.target.value));
									setExpandedGroups(new Set());
								}}
							/>
							hrs
						</label>
					)}
				</div>
				<input
					ref={fileInput}
					className="sr-only"
					type="file"
					multiple
					accept="image/*,video/*,.arw,.heic,.heif,.tif,.tiff"
					onChange={(event) => {
						void upload(Array.from(event.target.files ?? []));
						event.target.value = "";
					}}
				/>
				<Button variant="outline" onClick={() => fileInput.current?.click()}>
					<Upload size={14} /> Upload new
				</Button>
			</div>
			{uploads.length > 0 && (
				<div className="upload-queue">
					{uploads.map((item) => (
						<div key={item.id}>
							<span>{item.name}</span>
							<b className={`status-${item.status}`}>
								{item.status === "processing" && (
									<LoaderCircle className="spin" size={12} />
								)}
								{labelStatus(item.status)}
							</b>
						</div>
					))}
				</div>
			)}
			{error && <p className="inline-error">{error}</p>}
			{groups.length === 0 && (
				<div className="empty-library">
					<ImagePlus size={24} />
					<span>No ready media yet. Upload files to build the library.</span>
				</div>
			)}
			{groups.map((group) => {
				const selectable = group.items;
				const allSelected =
					selectable.length > 0 &&
					selectable.every((item) => selection.has(item.id));
				const isExpanded = expandedGroups.has(group.id);
				return (
					<section className="media-session" key={group.id}>
						<header>
							<div>
								<label className="media-session-select">
									<input
										type="checkbox"
										checked={allSelected}
										onChange={() =>
											setSelection((current) =>
												toggleMediaSelection(
													current,
													selectable.map((item) => item.id),
												),
											)
										}
									/>
									<span className="sr-only">Select all in {group.label}</span>
								</label>
								<button
									className="media-session-toggle"
									type="button"
									aria-expanded={isExpanded}
									onClick={() =>
										setExpandedGroups((current) => {
											const next = new Set(current);
											if (next.has(group.id)) next.delete(group.id);
											else next.add(group.id);
											return next;
										})
									}
								>
									<ChevronRight size={14} />
									<span>{group.label}</span>
								</button>
							</div>
							<small>
								{group.items.length} item
								{group.items.length === 1 ? "" : "s"}
							</small>
						</header>
						{isExpanded && (
							<div className="media-grid">
								{group.items.map((item) => (
									<article
										className={`media-tile ${selection.has(item.id) ? "selected" : ""} ${allowTripAssociation && item.isInCurrentTrip ? "associated" : ""}`}
										key={item.id}
									>
										<button
											type="button"
											onClick={() =>
												setSelection((current) =>
													toggleMediaSelection(current, [item.id]),
												)
											}
										>
											<img src={item.previewUrl} alt="" loading="lazy" />
											<span>
												{allowTripAssociation && item.isInCurrentTrip
													? "In trip"
													: item.kind}
											</span>
										</button>
										<label className="media-capture-time">
											<span>Taken</span>
											<input
												type="datetime-local"
												defaultValue={mediaLocalInput(item)}
												onBlur={(event) => {
													if (event.target.value !== mediaLocalInput(item))
														void updateTimestamp(item, event.target.value);
												}}
											/>
											<small>
												{item.capturedTimeZone ?? "Timezone unknown"}
												{item.hasCapturedAtOverride ? " · exact override" : ""}
											</small>
										</label>
									</article>
								))}
							</div>
						)}
					</section>
				);
			})}
			{selection.size > 0 && (
				<>
					{showTimeEditor && (
						<form
							className="bulk-time-editor"
							onSubmit={
								timeEditOperation === "shift"
									? shiftSelectedTimestamps
									: setSelectedTimeZone
							}
						>
							<select
								aria-label="Bulk edit operation"
								value={timeEditOperation}
								onChange={(event) =>
									setTimeEditOperation(
										event.target.value as "shift" | "timezone",
									)
								}
							>
								<option value="shift">Shift day and time</option>
								<option value="timezone">Set timezone</option>
							</select>
							{timeEditOperation === "timezone" ? (
								<label>
									Timezone
									<input
										list="media-time-zones"
										value={timeZone}
										onChange={(event) => setTimeZone(event.target.value)}
									/>
									<datalist id="media-time-zones">
										<option value="America/Los_Angeles" />
										<option value="America/New_York" />
										<option value="Europe/London" />
										<option value="Europe/Paris" />
										<option value="Asia/Tokyo" />
										<option value="UTC" />
									</datalist>
								</label>
							) : (
								<>
									<label>
										Days
										<input
											type="number"
											value={shiftDays}
											onChange={(event) => setShiftDays(event.target.value)}
										/>
									</label>
									<label>
										Hours
										<input
											type="number"
											value={shiftHours}
											onChange={(event) => setShiftHours(event.target.value)}
										/>
									</label>
									<label>
										Minutes
										<input
											type="number"
											value={shiftMinutes}
											onChange={(event) => setShiftMinutes(event.target.value)}
										/>
									</label>
								</>
							)}
							<Button size="sm" type="submit">
								{timeEditOperation === "shift" ? "Apply shift" : "Set timezone"}
							</Button>
						</form>
					)}
					<div className="selection-bar">
						<button
							type="button"
							onClick={() => {
								setSelection(new Set());
								setShowTimeEditor(false);
							}}
						>
							<X size={14} /> Clear
						</button>
						<Button
							variant="outline"
							onClick={() => setShowTimeEditor((current) => !current)}
						>
							<Clock3 size={14} /> Edit time
						</Button>
						{allowTripAssociation && (
							<Button
								disabled={!attachableSelection.length}
								onClick={() => void attachSelected()}
							>
								Add {attachableSelection.length} to trip
							</Button>
						)}
					</div>
				</>
			)}
		</div>
	);
});

function labelStatus(status: UploadState["status"]) {
	return {
		waiting: "Waiting",
		uploading: "Uploading",
		processing: "Processing",
		ready: "Ready",
		failed: "Failed",
	}[status];
}

function toLocalInput(value: string | null) {
	if (!value) return "";
	const date = new Date(value);
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}

function mediaLocalInput(item: MediaBrowserItem) {
	if (
		item.hasCapturedAtOverride &&
		item.effectiveCapturedAt &&
		item.capturedTimeZone
	) {
		return formatInstantForLocalInput(
			item.effectiveCapturedAt,
			item.capturedTimeZone,
		);
	}
	return !item.hasCapturedAtOverride && item.capturedAtLocal
		? item.capturedAtLocal.slice(0, 16)
		: toLocalInput(item.effectiveCapturedAt);
}

function formatInstantForLocalInput(instant: string, timeZone: string) {
	const offset = timeZone.match(/^([+-])(\d{2}):(\d{2})$/);
	if (offset) {
		const minutes =
			(offset[1] === "-" ? -1 : 1) *
			(Number(offset[2]) * 60 + Number(offset[3]));
		return new Date(Date.parse(instant) + minutes * 60_000)
			.toISOString()
			.slice(0, 16);
	}
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(instant));
	const value = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}
