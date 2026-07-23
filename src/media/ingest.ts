import "@tanstack/react-start/server-only";
import { constants } from "node:fs";
import {
	access,
	copyFile,
	link,
	mkdir,
	rename,
	rm,
	stat,
	unlink,
} from "node:fs/promises";
import { basename, dirname, extname, relative } from "node:path";
import type { LibraryRepository, StoredMediaRecord } from "../db/library";
import { originalMediaKey, resolveRelativePath } from "../storage/paths";
import { publicMediaError } from "./errors";
import {
	MEDIA_PROCESSING_VERSION,
	processMediaOriginal,
} from "./process-original";

type IngestionContext = {
	repository: LibraryRepository;
	assetRoot: string;
	tempRoot: string;
};

export async function ingestUploadedMedia(input: {
	file: File;
	importId: string;
	importItemId: string;
	context: IngestionContext;
}): Promise<StoredMediaRecord> {
	const mediaId = crypto.randomUUID();
	const temporary = temporaryOriginal(input.context, mediaId, input.file.name);
	await mkdir(dirname(temporary), { recursive: true });
	await streamFile(input.file, temporary);
	return storeAndProcess({
		...input,
		mediaId,
		temporaryPath: temporary,
		originalFilename: input.file.name,
		storageMode: "upload",
		deleteSourceAfterFinal: false,
	});
}

export async function ingestMediaFromPath(input: {
	sourcePath: string;
	originalFilename?: string;
	importId: string;
	importItemId: string;
	storageMode: "copy" | "move" | "hardlink";
	context: IngestionContext;
}): Promise<StoredMediaRecord> {
	const source = await stat(input.sourcePath);
	if (!source.isFile() || source.size <= 0)
		throw new Error("Source must be a nonempty regular file.");
	const mediaId = crypto.randomUUID();
	const originalFilename = input.originalFilename ?? basename(input.sourcePath);
	const temporary = temporaryOriginal(input.context, mediaId, originalFilename);
	await mkdir(dirname(temporary), { recursive: true });
	let deleteSourceAfterFinal = false;
	if (input.storageMode === "copy")
		await copyFile(input.sourcePath, temporary, constants.COPYFILE_EXCL);
	if (input.storageMode === "hardlink") {
		try {
			await link(input.sourcePath, temporary);
		} catch (error) {
			throw new Error(
				`Hardlink failed; source and asset storage must be on the same filesystem: ${error instanceof Error ? error.message : "unknown error"}`,
			);
		}
	}
	if (input.storageMode === "move") {
		try {
			await rename(input.sourcePath, temporary);
		} catch (error) {
			if (!isCrossDevice(error)) throw error;
			await copyFile(input.sourcePath, temporary, constants.COPYFILE_EXCL);
			deleteSourceAfterFinal = true;
		}
	}
	return storeAndProcess({
		...input,
		mediaId,
		temporaryPath: temporary,
		originalFilename,
		deleteSourceAfterFinal,
	});
}

async function storeAndProcess(input: {
	mediaId: string;
	temporaryPath: string;
	originalFilename: string;
	importId: string;
	importItemId: string;
	storageMode: StoredMediaRecord["storageMode"];
	context: IngestionContext;
	sourcePath?: string;
	deleteSourceAfterFinal: boolean;
}) {
	const { repository, assetRoot } = input.context;
	repository.setImportItemStatus(input.importItemId, "processing");
	const file = await stat(input.temporaryPath);
	if (!file.isFile() || file.size <= 0)
		throw new Error("Stored original is empty.");
	const originalRelativePath = originalMediaKey(
		input.mediaId,
		input.originalFilename,
	);
	const finalOriginal = resolveRelativePath(assetRoot, originalRelativePath);
	await mkdir(dirname(finalOriginal), { recursive: true });
	await rename(input.temporaryPath, finalOriginal);
	if (input.deleteSourceAfterFinal && input.sourcePath)
		await unlink(input.sourcePath);
	const media = repository.createProcessingMedia({
		id: input.mediaId,
		importId: input.importId,
		originalFilename: input.originalFilename,
		originalRelativePath,
		originalByteSize: file.size,
		storageMode: input.storageMode,
		processingVersion: MEDIA_PROCESSING_VERSION,
	});
	return processStoredMediaOriginal({
		mediaId: media.id,
		originalPath: finalOriginal,
		importItemId: input.importItemId,
		context: input.context,
	});
}

export async function processStoredMediaOriginal(input: {
	mediaId: string;
	originalPath: string;
	importItemId: string;
	context: IngestionContext;
}): Promise<StoredMediaRecord> {
	const temporaryDerived = temporaryDerivedDirectory(
		input.context,
		input.mediaId,
	);
	const finalKey = `media/derived/${input.mediaId}`;
	const finalDerived = resolveRelativePath(input.context.assetRoot, finalKey);
	await rm(temporaryDerived, { recursive: true, force: true });
	await mkdir(temporaryDerived, { recursive: true });
	try {
		const processed = await processMediaOriginal({
			originalPath: input.originalPath,
			derivedDirectory: temporaryDerived,
		});
		await mkdir(dirname(finalDerived), { recursive: true });
		await rm(finalDerived, { recursive: true, force: true });
		await rename(temporaryDerived, finalDerived);
		const completed = input.context.repository.completeMedia(input.mediaId, {
			...processed,
			metadataJson: JSON.stringify(processed.metadata),
			derivatives: processed.derivatives.map((derivative) => ({
				id: crypto.randomUUID(),
				kind: derivative.kind,
				relativePath: `${finalKey}/${derivative.kind}.${derivative.kind === "proxy" ? "mp4" : "webp"}`,
				mimeType: derivative.mimeType,
				width: derivative.width,
				height: derivative.height,
				durationMs: derivative.durationMs,
				byteSize: derivative.byteSize,
				processingVersion: MEDIA_PROCESSING_VERSION,
			})),
		});
		input.context.repository.setImportItemStatus(
			input.importItemId,
			"completed",
			{ entityId: input.mediaId },
		);
		return completed as StoredMediaRecord;
	} catch (error) {
		await rm(temporaryDerived, { recursive: true, force: true });
		const failure = publicMediaError(error);
		input.context.repository.failMedia(
			input.mediaId,
			failure.code,
			failure.message,
		);
		input.context.repository.setImportItemStatus(input.importItemId, "failed", {
			entityId: input.mediaId,
			errorMessage: failure.message,
		});
		return input.context.repository.getMedia(
			input.mediaId,
		) as StoredMediaRecord;
	}
}

function temporaryOriginal(
	context: IngestionContext,
	mediaId: string,
	filename: string,
) {
	return resolveRelativePath(
		context.tempRoot,
		`${mediaId}/original${extname(filename).toLowerCase()}`,
	);
}

function temporaryDerivedDirectory(context: IngestionContext, mediaId: string) {
	return resolveRelativePath(context.tempRoot, `${mediaId}/derived`);
}

async function streamFile(file: File, destination: string) {
	const writer = Bun.file(destination).writer();
	try {
		for await (const chunk of file.stream()) await writer.write(chunk);
		await writer.end();
	} catch (error) {
		writer.end();
		await rm(destination, { force: true });
		throw error;
	}
	await access(destination, constants.R_OK);
}

function isCrossDevice(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "EXDEV"
	);
}

export function toRelativeAssetPath(assetRoot: string, path: string) {
	return relative(assetRoot, path).split("\\").join("/");
}
