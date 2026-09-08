import type { EditorAuthorization } from "@vivari/workspace-api/server";

/** APP-OWNED LOCAL FIXTURE ONLY. Replace with your existing server session/role policy.
 * Explicit LOCAL_EDITOR_ADMIN=1 enables this loopback demo, without inventing identity.
 * A server started without the flag denies every direct editor/model request. */
export const authorizeEditing: EditorAuthorization = request => {
  const url = new URL(request.url);
  return process.env.LOCAL_EDITOR_ADMIN === "1"
    && ["127.0.0.1", "localhost"].includes(url.hostname)
    && (!request.headers.get("origin") || request.headers.get("origin") === url.origin);
};
