import type { Database } from "bun:sqlite";
import {
	extractExifLocalDateTime,
	isValidTimeZone,
	resolveLocalDateTime,
} from "../media/capture-time";
import type { CaptureMetadata } from "../media/read-capture-metadata";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";

export type TripRecord = {
	id: string;
	title: string;
	timeZone: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ImportRecord = {
	id: string;
	kind: "media" | "workout";
	sourceType: "browser" | "local-backfill" | "workout-archive";
	sourceName: string;
	status: "processing" | "completed" | "completed-with-errors" | "failed";
	originalRelativePath: string | null;
	createdAt: string;
	completedAt: string | null;
};

export type ImportItemRecord = {
	id: string;
	importId: string;
	sourceKey: string;
	entityId: string | null;
	status: "pending" | "processing" | "completed" | "failed";
	originalFilename: string;
	errorMessage: string | null;
};

export type StoredMediaRecord = {
	id: string;
	importId: string | null;
	status: "processing" | "ready" | "failed";
	kind: "photo" | "video" | null;
	originalFilename: string;
	originalRelativePath: string;
	originalMimeType: string | null;
	originalByteSize: number;
	contentHash: string | null;
	storageMode: "copy" | "move" | "hardlink" | "upload";
	width: number | null;
	height: number | null;
	durationMs: number | null;
	capturedAt: string | null;
	capturedAtOverride: string | null;
	capturedAtLocal: string | null;
	capturedTimeZone: string | null;
	capturedTimeZoneSource: string | null;
	latitude: number | null;
	longitude: number | null;
	metadataJson: string;
	processingVersion: string;
	failureCode: string | null;
	failureMessage: string | null;
};

export type WorkoutListItem = {
	id: string;
	importId: string | null;
	tripId: string | null;
	title: string | null;
	startedAt: string;
	endedAt: string;
	activityType: string | null;
	distanceMeters: number | null;
};

export class LibraryRepository {
	constructor(public readonly db: Database) {}

	createTrip(title: string) {
		const trimmed = title.trim();
		if (!trimmed) throw new Error("Trip title is required.");
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.db
			.query(
				"INSERT INTO trips (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
			)
			.run(id, trimmed, now, now);
		return this.getTrip(id) as TripRecord;
	}

	getTrip(id: string): TripRecord | null {
		const row = this.db
			.query<
				{
					id: string;
					title: string;
					time_zone: string | null;
					created_at: string;
					updated_at: string;
				},
				[string]
			>("SELECT * FROM trips WHERE id = ?")
			.get(id);
		return row
			? {
					id: row.id,
					title: row.title,
					timeZone: row.time_zone,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				}
			: null;
	}

	listTrips(): TripRecord[] {
		return this.db
			.query<
				{
					id: string;
					title: string;
					time_zone: string | null;
					created_at: string;
					updated_at: string;
				},
				[]
			>("SELECT * FROM trips ORDER BY updated_at DESC")
			.all()
			.map((row) => ({
				id: row.id,
				title: row.title,
				timeZone: row.time_zone,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			}));
	}

	updateTrip(id: string, title: string) {
		const trimmed = title.trim();
		if (!trimmed) throw new Error("Trip title is required.");
		this.db
			.query("UPDATE trips SET title = ?, updated_at = ? WHERE id = ?")
			.run(trimmed, new Date().toISOString(), id);
		return this.getTrip(id);
	}

	updateTripTimeZone(id: string, timeZone: string | null) {
		if (timeZone !== null && !isValidTimeZone(timeZone))
			throw new Error("Invalid time zone.");
		this.db
			.query("UPDATE trips SET time_zone = ?, updated_at = ? WHERE id = ?")
			.run(timeZone, new Date().toISOString(), id);
		return this.getTrip(id);
	}

	createImport(input: {
		kind: "media" | "workout";
		sourceType: ImportRecord["sourceType"];
		sourceName: string;
		originalRelativePath?: string | null;
	}) {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.db
			.query(
				"INSERT INTO imports (id, kind, source_type, source_name, status, original_relative_path, metadata_json, created_at) VALUES (?, ?, ?, ?, 'processing', ?, '{}', ?)",
			)
			.run(
				id,
				input.kind,
				input.sourceType,
				input.sourceName,
				input.originalRelativePath ?? null,
				now,
			);
		return this.getImport(id) as ImportRecord;
	}

	getImport(id: string): ImportRecord | null {
		const row = this.db
			.query<Record<string, string | null>, [string]>(
				"SELECT * FROM imports WHERE id = ?",
			)
			.get(id);
		return row ? mapImport(row) : null;
	}

	listImports(kind?: "media" | "workout") {
		const rows = kind
			? this.db
					.query<Record<string, string | null>, [string]>(
						"SELECT * FROM imports WHERE kind = ? ORDER BY created_at DESC",
					)
					.all(kind)
			: this.db
					.query<Record<string, string | null>, []>(
						"SELECT * FROM imports ORDER BY created_at DESC",
					)
					.all();
		return rows.map(mapImport);
	}

	updateImportStatus(
		id: string,
		status: ImportRecord["status"],
		errorMessage: string | null = null,
	) {
		const completedAt =
			status === "processing" ? null : new Date().toISOString();
		this.db
			.query(
				"UPDATE imports SET status = ?, error_message = ?, completed_at = ? WHERE id = ?",
			)
			.run(status, errorMessage, completedAt, id);
		return this.getImport(id);
	}

	createImportItem(input: {
		importId: string;
		sourceKey: string;
		entityType: "media" | "workout";
		originalFilename: string;
		id?: string;
	}) {
		const id = input.id ?? crypto.randomUUID();
		const now = new Date().toISOString();
		this.db
			.query(
				"INSERT INTO import_items (id, import_id, source_key, entity_type, status, original_filename, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, '{}', ?, ?)",
			)
			.run(
				id,
				input.importId,
				input.sourceKey,
				input.entityType,
				input.originalFilename,
				now,
				now,
			);
		return this.getImportItem(id) as ImportItemRecord;
	}

	getImportItem(id: string): ImportItemRecord | null {
		const row = this.db
			.query<Record<string, string | null>, [string]>(
				"SELECT * FROM import_items WHERE id = ?",
			)
			.get(id);
		return row ? mapImportItem(row) : null;
	}

	getImportItemBySource(importId: string, sourceKey: string) {
		const row = this.db
			.query<Record<string, string | null>, [string, string]>(
				"SELECT * FROM import_items WHERE import_id = ? AND source_key = ?",
			)
			.get(importId, sourceKey);
		return row ? mapImportItem(row) : null;
	}

	setImportItemStatus(
		id: string,
		status: ImportItemRecord["status"],
		input: { entityId?: string | null; errorMessage?: string | null } = {},
	) {
		this.db
			.query(
				"UPDATE import_items SET status = ?, entity_id = COALESCE(?, entity_id), error_message = ?, updated_at = ? WHERE id = ?",
			)
			.run(
				status,
				input.entityId ?? null,
				input.errorMessage ?? null,
				new Date().toISOString(),
				id,
			);
		return this.getImportItem(id);
	}

	listImportItems(importId: string) {
		return this.db
			.query<Record<string, string | null>, [string]>(
				"SELECT * FROM import_items WHERE import_id = ? ORDER BY source_key",
			)
			.all(importId)
			.map(mapImportItem);
	}

	createProcessingMedia(input: {
		id: string;
		importId: string;
		originalFilename: string;
		originalRelativePath: string;
		originalByteSize: number;
		contentHash?: string | null;
		storageMode: StoredMediaRecord["storageMode"];
		processingVersion: string;
	}) {
		const now = new Date().toISOString();
		this.db
			.query(
				"INSERT INTO media (id, import_id, status, original_filename, original_relative_path, original_byte_size, content_hash, storage_mode, metadata_json, processing_version, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?, ?, ?, ?, '{}', ?, ?, ?)",
			)
			.run(
				input.id,
				input.importId,
				input.originalFilename,
				input.originalRelativePath,
				input.originalByteSize,
				input.contentHash ?? null,
				input.storageMode,
				input.processingVersion,
				now,
				now,
			);
		return this.getMedia(input.id) as StoredMediaRecord;
	}

	getMedia(id: string): StoredMediaRecord | null {
		const row = this.db
			.query<Record<string, string | number | null>, [string]>(
				"SELECT * FROM media WHERE id = ?",
			)
			.get(id);
		return row ? mapStoredMedia(row) : null;
	}

	getMediaByContentHash(contentHash: string): StoredMediaRecord | null {
		const row = this.db
			.query<Record<string, string | number | null>, [string]>(
				"SELECT * FROM media WHERE content_hash = ? LIMIT 1",
			)
			.get(contentHash);
		return row ? mapStoredMedia(row) : null;
	}

	listProcessingMedia(input: { importId?: string; limit?: number } = {}) {
		return this.db
			.query<
				Record<string, string | number | null> & { import_item_id: string },
				[string | null, string | null, number]
			>(`
				SELECT m.*, i.id AS import_item_id
				FROM media m
				JOIN import_items i ON i.id = (
					SELECT candidate.id
					FROM import_items candidate
					WHERE candidate.entity_id = m.id AND candidate.import_id = m.import_id
					ORDER BY candidate.created_at, candidate.id
					LIMIT 1
				)
				WHERE m.status = 'processing'
					AND (? IS NULL OR m.import_id = ?)
				ORDER BY m.created_at
				LIMIT ?
			`)
			.all(
				input.importId ?? null,
				input.importId ?? null,
				input.limit ?? Number.MAX_SAFE_INTEGER,
			)
			.map((row) => ({
				media: mapStoredMedia(row),
				importItemId: row.import_item_id,
			}));
	}

	listReadyRawMediaWithOrientation(input: {
		processingVersion: string;
		limit?: number;
	}) {
		return this.db
			.query<
				Record<string, string | number | null> & { import_item_id: string },
				[string, number]
			>(`
				SELECT m.*, i.id AS import_item_id
				FROM media m
				JOIN import_items i ON i.id = (
					SELECT candidate.id
					FROM import_items candidate
					WHERE candidate.entity_id = m.id AND candidate.import_id = m.import_id
					ORDER BY candidate.created_at, candidate.id
					LIMIT 1
				)
				WHERE m.status = 'ready'
					AND lower(m.original_filename) LIKE '%.arw'
					AND CAST(json_extract(m.metadata_json, '$.Orientation') AS INTEGER) BETWEEN 2 AND 8
					AND m.processing_version <> ?
				ORDER BY m.created_at
				LIMIT ?
			`)
			.all(input.processingVersion, input.limit ?? Number.MAX_SAFE_INTEGER)
			.map((row) => ({
				media: mapStoredMedia(row),
				importItemId: row.import_item_id,
			}));
	}

	listReadyMediaWithoutContentHash(): StoredMediaRecord[] {
		return this.db
			.query<Record<string, string | number | null>, []>(
				"SELECT * FROM media WHERE status = 'ready' AND content_hash IS NULL ORDER BY created_at",
			)
			.all()
			.map(mapStoredMedia);
	}

	listReadyMediaForTimeBackfill(
		input: { kind?: "photo" | "video"; limit?: number } = {},
	): StoredMediaRecord[] {
		return this.db
			.query<
				Record<string, string | number | null>,
				[string | null, string | null, number]
			>(
				"SELECT * FROM media WHERE status = 'ready' AND (? IS NULL OR kind = ?) ORDER BY created_at, id LIMIT ?",
			)
			.all(
				input.kind ?? null,
				input.kind ?? null,
				input.limit ?? Number.MAX_SAFE_INTEGER,
			)
			.map(mapStoredMedia);
	}

	updateMediaCaptureMetadata(
		id: string,
		capture: CaptureMetadata,
		options: { replaceUserTimeZone?: boolean } = {},
	) {
		const current = this.getMedia(id);
		if (!current) return null;
		let capturedAt = capture.capturedAt;
		let capturedAtLocal = capture.capturedAtLocal;
		let capturedTimeZone = capture.capturedTimeZone;
		let capturedTimeZoneSource = capture.capturedTimeZoneSource;
		if (
			!options.replaceUserTimeZone &&
			current.capturedTimeZoneSource === "user"
		) {
			capturedAtLocal ??= current.capturedAtLocal;
			capturedTimeZone = current.capturedTimeZone;
			capturedTimeZoneSource = "user";
			capturedAt =
				capturedAtLocal && capturedTimeZone
					? resolveLocalDateTime(capturedAtLocal, capturedTimeZone)
					: current.capturedAt;
		}
		const metadata = {
			...parseMetadataJson(current.metadataJson),
			...capture.metadata,
		};
		this.db
			.query(
				"UPDATE media SET captured_at = ?, captured_at_local = ?, captured_time_zone = ?, captured_time_zone_source = ?, metadata_json = ?, updated_at = ? WHERE id = ?",
			)
			.run(
				capturedAt,
				capturedAtLocal,
				capturedTimeZone,
				capturedTimeZoneSource,
				JSON.stringify(metadata),
				new Date().toISOString(),
				id,
			);
		return this.getMedia(id);
	}

	setMediaContentHashIfAvailable(id: string, contentHash: string): boolean {
		const result = this.db
			.query(
				"UPDATE media SET content_hash = ?, updated_at = ? WHERE id = ? AND content_hash IS NULL AND NOT EXISTS (SELECT 1 FROM media AS duplicate WHERE duplicate.content_hash = ?)",
			)
			.run(contentHash, new Date().toISOString(), id, contentHash);
		return result.changes > 0;
	}

	completeMedia(
		id: string,
		input: {
			processingVersion: string;
			kind: "photo" | "video";
			mimeType: string | null;
			width: number | null;
			height: number | null;
			durationMs: number | null;
			capturedAt: string | null;
			capturedAtLocal: string | null;
			capturedTimeZone: string | null;
			capturedTimeZoneSource: string | null;
			latitude: number | null;
			longitude: number | null;
			metadataJson: string;
			derivatives: Array<{
				id: string;
				kind: string;
				relativePath: string;
				mimeType: string;
				width: number | null;
				height: number | null;
				durationMs: number | null;
				byteSize: number;
				processingVersion: string;
			}>;
		},
	) {
		const transaction = this.db.transaction(() => {
			for (const derivative of input.derivatives) {
				this.db
					.query(
						"INSERT INTO media_derivatives (id, media_id, kind, relative_path, mime_type, width, height, duration_ms, byte_size, processing_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
					)
					.run(
						derivative.id,
						id,
						derivative.kind,
						derivative.relativePath,
						derivative.mimeType,
						derivative.width,
						derivative.height,
						derivative.durationMs,
						derivative.byteSize,
						derivative.processingVersion,
						new Date().toISOString(),
					);
			}
			this.db
				.query(
					"UPDATE media SET status = 'ready', processing_version = ?, kind = ?, original_mime_type = ?, width = ?, height = ?, duration_ms = ?, captured_at = ?, captured_at_local = ?, captured_time_zone = ?, captured_time_zone_source = ?, latitude = ?, longitude = ?, metadata_json = ?, failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ?",
				)
				.run(
					input.processingVersion,
					input.kind,
					input.mimeType,
					input.width,
					input.height,
					input.durationMs,
					input.capturedAt,
					input.capturedAtLocal,
					input.capturedTimeZone,
					input.capturedTimeZoneSource,
					input.latitude,
					input.longitude,
					input.metadataJson,
					new Date().toISOString(),
					id,
				);
		});
		transaction();
		return this.getMedia(id);
	}

	failMedia(id: string, code: string, message: string) {
		this.db
			.query(
				"UPDATE media SET status = 'failed', content_hash = NULL, failure_code = ?, failure_message = ?, updated_at = ? WHERE id = ?",
			)
			.run(code, message, new Date().toISOString(), id);
		return this.getMedia(id);
	}

	getDerivative(mediaId: string, kind: string) {
		return (
			this.db
				.query<
					{ relative_path: string; mime_type: string; byte_size: number },
					[string, string]
				>(
					"SELECT relative_path, mime_type, byte_size FROM media_derivatives WHERE media_id = ? AND kind = ? ORDER BY processing_version DESC LIMIT 1",
				)
				.get(mediaId, kind) ?? null
		);
	}

	listMedia(tripId?: string, kind?: "photo" | "video"): MediaBrowserItem[] {
		const rows = this.db
			.query<
				Record<string, string | number | null>,
				[string | null, string | null, string | null]
			>(`
			SELECT m.*, d.relative_path AS preview_path,
				CASE WHEN tm.trip_id IS NULL THEN 0 ELSE 1 END AS in_trip
			FROM media m
			JOIN media_derivatives d ON d.media_id = m.id AND d.processing_version = m.processing_version AND d.kind = CASE m.kind WHEN 'photo' THEN 'thumbnail' ELSE 'poster' END
			LEFT JOIN trip_media tm ON tm.media_id = m.id AND tm.trip_id = ?
			WHERE m.status = 'ready' AND (? IS NULL OR m.kind = ?)
			ORDER BY COALESCE(m.captured_at_override, m.captured_at), m.created_at, m.id
		`)
			.all(tripId ?? null, kind ?? null, kind ?? null);
		return rows.map((row) => ({
			id: String(row.id),
			kind: row.kind as "photo" | "video",
			status: "ready",
			effectiveCapturedAt: (row.captured_at_override ?? row.captured_at) as
				| string
				| null,
			capturedAtLocal: row.captured_at_local as string | null,
			capturedTimeZone: row.captured_time_zone as string | null,
			capturedTimeZoneSource: row.captured_time_zone_source as string | null,
			hasCapturedAtOverride: row.captured_at_override !== null,
			latitude: row.latitude as number | null,
			longitude: row.longitude as number | null,
			width: row.width as number | null,
			height: row.height as number | null,
			durationMs: row.duration_ms as number | null,
			previewUrl: `/media/${row.id}/${row.kind === "photo" ? "thumbnail" : "poster"}`,
			isInCurrentTrip: Number(row.in_trip) === 1,
		}));
	}

	updateMediaTimestampOverride(id: string, timestamp: string | null) {
		const normalized =
			timestamp === null ? null : new Date(timestamp).toISOString();
		this.db
			.query(
				"UPDATE media SET captured_at_override = ?, updated_at = ? WHERE id = ?",
			)
			.run(normalized, new Date().toISOString(), id);
		return this.getMedia(id);
	}

	setMediaTimeZone(ids: string[], timeZone: string) {
		if (!isValidTimeZone(timeZone)) throw new Error("Invalid time zone.");
		const select = this.db.query<
			{ captured_at_local: string | null; metadata_json: string },
			[string]
		>(
			"SELECT captured_at_local, metadata_json FROM media WHERE id = ? AND status = 'ready'",
		);
		const update = this.db.query(
			"UPDATE media SET captured_at = ?, captured_at_local = ?, captured_time_zone = ?, captured_time_zone_source = 'user', captured_at_override = NULL, updated_at = ? WHERE id = ?",
		);
		let updated = 0;
		this.db.transaction(() => {
			for (const id of new Set(ids)) {
				const media = select.get(id);
				if (!media) continue;
				const local =
					media.captured_at_local ??
					extractExifLocalDateTime(media.metadata_json);
				if (!local) continue;
				update.run(
					resolveLocalDateTime(local, timeZone),
					local,
					timeZone,
					new Date().toISOString(),
					id,
				);
				updated += 1;
			}
		})();
		return updated;
	}

	shiftMediaTimestampOverrides(ids: string[], offsetMinutes: number) {
		const select = this.db.query<
			{ effective_captured_at: string | null },
			[string]
		>(
			"SELECT COALESCE(captured_at_override, captured_at) AS effective_captured_at FROM media WHERE id = ?",
		);
		const update = this.db.query(
			"UPDATE media SET captured_at_override = ?, updated_at = ? WHERE id = ?",
		);
		let shifted = 0;
		this.db.transaction(() => {
			for (const id of new Set(ids)) {
				const value = select.get(id)?.effective_captured_at;
				if (!value) continue;
				const timestamp = Date.parse(value);
				if (!Number.isFinite(timestamp)) continue;
				update.run(
					new Date(timestamp + offsetMinutes * 60_000).toISOString(),
					new Date().toISOString(),
					id,
				);
				shifted += 1;
			}
		})();
		return shifted;
	}

	attachMediaToTrip(tripId: string, mediaIds: string[]) {
		const insert = this.db.query(
			"INSERT OR IGNORE INTO trip_media (trip_id, media_id, added_at) VALUES (?, ?, ?)",
		);
		this.db.transaction(() =>
			mediaIds.forEach((id) => {
				insert.run(tripId, id, new Date().toISOString());
			}),
		)();
	}

	detachMediaFromTrip(tripId: string, mediaId: string) {
		this.db
			.query("DELETE FROM trip_media WHERE trip_id = ? AND media_id = ?")
			.run(tripId, mediaId);
	}

	createWorkout(input: {
		id: string;
		importId: string;
		title: string | null;
		startedAt: string;
		endedAt: string;
		activityType: string | null;
		distanceMeters: number;
		originalRelativePath: string;
		points: Array<{
			recordedAt: string;
			latitude: number;
			longitude: number;
			elevationMeters: number | null;
		}>;
	}) {
		const now = new Date().toISOString();
		this.db.transaction(() => {
			this.db
				.query(
					"INSERT INTO workouts (id, import_id, title, started_at, ended_at, activity_type, distance_meters, original_relative_path, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)",
				)
				.run(
					input.id,
					input.importId,
					input.title,
					input.startedAt,
					input.endedAt,
					input.activityType,
					input.distanceMeters,
					input.originalRelativePath,
					now,
					now,
				);
			const insert = this.db.query(
				"INSERT INTO workout_points (workout_id, sequence, recorded_at, latitude, longitude, elevation_meters) VALUES (?, ?, ?, ?, ?, ?)",
			);
			input.points.forEach((point, index) => {
				insert.run(
					input.id,
					index,
					point.recordedAt,
					point.latitude,
					point.longitude,
					point.elevationMeters,
				);
			});
		})();
	}

	listWorkouts(
		input: {
			tripId?: string;
			unassigned?: boolean;
			query?: string;
			importId?: string;
		} = {},
	): WorkoutListItem[] {
		const query = `%${input.query?.trim() ?? ""}%`;
		return this.db
			.query<
				Record<string, string | number | null>,
				[
					string | null,
					string | null,
					number,
					string | null,
					string | null,
					string,
					string,
				]
			>(
				`SELECT * FROM workouts WHERE (? IS NULL OR trip_id = ?) AND (? = 0 OR trip_id IS NULL) AND (? IS NULL OR import_id = ?) AND (COALESCE(title, '') LIKE ? OR COALESCE(activity_type, '') LIKE ?) ORDER BY started_at DESC`,
			)
			.all(
				input.tripId ?? null,
				input.tripId ?? null,
				input.unassigned ? 1 : 0,
				input.importId ?? null,
				input.importId ?? null,
				query,
				query,
			)
			.map(mapWorkout);
	}

	assignWorkoutsToTrip(tripId: string, workoutIds: string[]) {
		const update = this.db.query(
			"UPDATE workouts SET trip_id = ?, updated_at = ? WHERE id = ? AND trip_id IS NULL",
		);
		this.db.transaction(() =>
			workoutIds.forEach((id) => {
				update.run(tripId, new Date().toISOString(), id);
			}),
		)();
	}

	getWorkoutWithPoints(id: string): WorkoutWithPoints | null {
		const workout = this.db
			.query<Record<string, string | number | null>, [string]>(
				"SELECT * FROM workouts WHERE id = ?",
			)
			.get(id);
		if (!workout) return null;
		const points = this.db
			.query<
				{
					recorded_at: string;
					latitude: number;
					longitude: number;
					elevation_meters: number | null;
				},
				[string]
			>(
				"SELECT recorded_at, latitude, longitude, elevation_meters FROM workout_points WHERE workout_id = ? ORDER BY sequence",
			)
			.all(id);
		return {
			id,
			startedAt: String(workout.started_at),
			endedAt: String(workout.ended_at),
			points: points.map((point) => ({
				recordedAt: point.recorded_at,
				latitude: point.latitude,
				longitude: point.longitude,
				elevationMeters: point.elevation_meters,
			})),
		};
	}

	getWorkoutsForTripWithPoints(tripId: string) {
		return this.listWorkouts({ tripId })
			.map((workout) => this.getWorkoutWithPoints(workout.id))
			.filter((workout): workout is WorkoutWithPoints => workout !== null);
	}
}

function mapImport(row: Record<string, string | null>): ImportRecord {
	return {
		id: String(row.id),
		kind: row.kind as ImportRecord["kind"],
		sourceType: row.source_type as ImportRecord["sourceType"],
		sourceName: String(row.source_name),
		status: row.status as ImportRecord["status"],
		originalRelativePath: row.original_relative_path,
		createdAt: String(row.created_at),
		completedAt: row.completed_at,
	};
}

function parseMetadataJson(value: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function mapImportItem(row: Record<string, string | null>): ImportItemRecord {
	return {
		id: String(row.id),
		importId: String(row.import_id),
		sourceKey: String(row.source_key),
		entityId: row.entity_id,
		status: row.status as ImportItemRecord["status"],
		originalFilename: String(row.original_filename),
		errorMessage: row.error_message,
	};
}

function mapStoredMedia(
	row: Record<string, string | number | null>,
): StoredMediaRecord {
	return {
		id: String(row.id),
		importId: row.import_id as string | null,
		status: row.status as StoredMediaRecord["status"],
		kind: row.kind as StoredMediaRecord["kind"],
		originalFilename: String(row.original_filename),
		originalRelativePath: String(row.original_relative_path),
		originalMimeType: row.original_mime_type as string | null,
		originalByteSize: Number(row.original_byte_size),
		contentHash: row.content_hash as string | null,
		storageMode: row.storage_mode as StoredMediaRecord["storageMode"],
		width: row.width as number | null,
		height: row.height as number | null,
		durationMs: row.duration_ms as number | null,
		capturedAt: row.captured_at as string | null,
		capturedAtOverride: row.captured_at_override as string | null,
		capturedAtLocal: row.captured_at_local as string | null,
		capturedTimeZone: row.captured_time_zone as string | null,
		capturedTimeZoneSource: row.captured_time_zone_source as string | null,
		latitude: row.latitude as number | null,
		longitude: row.longitude as number | null,
		metadataJson: String(row.metadata_json),
		processingVersion: String(row.processing_version),
		failureCode: row.failure_code as string | null,
		failureMessage: row.failure_message as string | null,
	};
}

function mapWorkout(
	row: Record<string, string | number | null>,
): WorkoutListItem {
	return {
		id: String(row.id),
		importId: row.import_id as string | null,
		tripId: row.trip_id as string | null,
		title: row.title as string | null,
		startedAt: String(row.started_at),
		endedAt: String(row.ended_at),
		activityType: row.activity_type as string | null,
		distanceMeters: row.distance_meters as number | null,
	};
}
