import { createReadingClient } from "reading-context-client";
import type { ModelRef, ReadingClient } from "reading-context-client";
import type { Settings } from "./common";
import { recordDiagnostic } from "./diagnostics";

export function openCodeClient(settings: Settings): ReadingClient {
  return createReadingClient({
    baseUrl: settings.serverUrl,
    password: settings.serverPassword,
    directory: settings.directory
  }, {
    onRequestFailure: (failure) => void recordDiagnostic(
      failure.status ? "api-http-error" : "api-network-error", {
        method: failure.method,
        path: failure.path,
        ...(failure.status ? { status: failure.status } : { message: failure.message || "" })
      })
  });
}

/** The model new chats start with. In OpenCode v2 the model belongs to the session. */
export function newChatModel(settings: Settings): ModelRef | undefined {
  if (!settings.modelProvider || !settings.modelId) return undefined;
  const variant = settings.modelVariant.trim();
  return {
    providerId: settings.modelProvider,
    modelId: settings.modelId,
    ...(variant ? { variant } : {})
  };
}
