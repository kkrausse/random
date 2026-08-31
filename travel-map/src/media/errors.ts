export type MediaFailureCode =
	| "unsupported-format"
	| "missing-tool"
	| "inspection-failed"
	| "processing-failed"
	| "validation-failed"
	| "storage-failed";

export class MediaPipelineError extends Error {
	constructor(
		public readonly code: MediaFailureCode,
		message: string,
		public readonly internalMessage?: string,
	) {
		super(message);
		this.name = "MediaPipelineError";
	}
}

export class UnsupportedMediaError extends MediaPipelineError {
	constructor() {
		super("unsupported-format", "This file type is not supported.");
	}
}

export function publicMediaError(error: unknown) {
	return error instanceof MediaPipelineError
		? { code: error.code, message: error.message }
		: {
				code: "processing-failed" as const,
				message: "Media processing failed.",
			};
}
