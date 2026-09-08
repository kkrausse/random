import type { Endpoint } from "../types.js";

export interface PreviewAttachment {
  dispose(): void;
}

/**
 * Owns iframe registration and WS/SSE relay plumbing for an endpoint.
 * A0 signature only; attaching rejects until the C1 transport exists.
 */
export function attachPreview(_iframe: unknown, _endpoint: Endpoint): PreviewAttachment {
  throw new Error("attachPreview has no backend in workspace-api A0 (see MAPPING.md)");
}
