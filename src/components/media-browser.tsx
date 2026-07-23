import { ChevronRight, ImagePlus, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { groupMediaByDay, toggleMediaSelection } from "../media/browser";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";
import { TripMap } from "./trip-map";
import { Button } from "./ui/button";

type UploadState = {
	id: string;
	name: string;
	status: "waiting" | "uploading" | "processing" | "ready" | "failed";
};

export function MediaBrowser({
	tripId,
	workouts,
	onChanged,
}: {
	tripId: string;
	workouts: WorkoutWithPoints[];
	onChanged: () => void;
}) {
	const [items, setItems] = useState<MediaBrowserItem[]>([]);
	const [selection, setSelection] = useState<Set<string>>(new Set());
	const [kind, setKind] = useState<"all" | "photo" | "video">("all");
	const [groupBy, setGroupBy] = useState<"day" | "kind">("day");
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
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
				if (result.media?.status === "ready") await refresh();
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
		if (!selection.size) return;
		await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ attachMediaIds: [...selection] }),
		});
		setSelection(new Set());
		await refresh();
		onChanged();
	}

	async function updateTimestamp(id: string, value: string) {
		await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				mediaTimestamp: {
					id,
					value: value ? new Date(value).toISOString() : null,
				},
			}),
		});
		await refresh();
		onChanged();
	}

	const groups =
		groupBy === "day"
			? groupMediaByDay(items)
			: (["photo", "video"] as const)
					.map((mediaKind) => ({
						id: `kind-${mediaKind}`,
						label: mediaKind === "photo" ? "Photos" : "Videos",
						items: items.filter((item) => item.kind === mediaKind),
					}))
					.filter((group) => group.items.length > 0);
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
							onClick={() => setKind(value)}
						>
							{value}
						</button>
					))}
				</fieldset>
				<fieldset className="segmented">
					<legend className="sr-only">Group media by</legend>
					{(["day", "kind"] as const).map((value) => (
						<button
							className={groupBy === value ? "active" : ""}
							key={value}
							type="button"
							onClick={() => setGroupBy(value)}
						>
							{value}
						</button>
					))}
				</fieldset>
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
				const selectable = group.items.filter((item) => !item.isInCurrentTrip);
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
										disabled={!selectable.length}
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
										className={`media-tile ${selection.has(item.id) ? "selected" : ""} ${item.isInCurrentTrip ? "associated" : ""}`}
										key={item.id}
									>
										<button
											type="button"
											disabled={item.isInCurrentTrip}
											onClick={() =>
												setSelection((current) =>
													toggleMediaSelection(current, [item.id]),
												)
											}
										>
											<img src={item.previewUrl} alt="" loading="lazy" />
											<span>
												{item.isInCurrentTrip ? "In trip" : item.kind}
											</span>
										</button>
										<label className="media-capture-time">
											<span>Taken</span>
											<input
												type="datetime-local"
												defaultValue={toLocalInput(item.effectiveCapturedAt)}
												onBlur={(event) =>
													void updateTimestamp(item.id, event.target.value)
												}
											/>
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
					<div className="selector-map">
						<TripMap
							workouts={workouts}
							media={items.filter((item) => selection.has(item.id))}
						/>
					</div>
					<div className="selection-bar">
						<button type="button" onClick={() => setSelection(new Set())}>
							<X size={14} /> Clear
						</button>
						<Button onClick={() => void attachSelected()}>
							Add {selection.size} to trip
						</Button>
					</div>
				</>
			)}
		</div>
	);
}

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
