# iPhone development diagnostics

Development builds can send native diagnostic events directly to the selected mobile Vite server. The endpoint exists only in `vite serve`; it is not included in production or bundled builds.

## Upload contract

Send `POST /__workout/diagnostics` with `Content-Type: application/json` on the same origin selected as the development server. A batch contains at most 64 events and its HTTP body must not exceed 128 KiB:

```json
{
  "formatVersion": 1,
  "uploadId": "unique-upload-id",
  "events": [{
    "id": "unique-event-id",
    "timestamp": "2026-09-19T12:00:00Z",
    "subsystem": "native-host",
    "level": "info",
    "message": "Native host started",
    "metadata": { "build": "development" }
  }]
}
```

Success returns `200 {"accepted":true,"uploadId":"unique-upload-id"}`. Event IDs are deduplicated in bounded server memory, so retrying a batch is safe while that Vite process remains running.

The phone must redact before upload. The server applies a second redaction pass to credential-like URL query values, URL user information, sensitive metadata, and common GPS/heart-rate fields. Never emit raw GPS coordinates, heart-rate observations, authorization values, cookies, passwords, tokens, or other credentials.

## Viewing logs

Accepted events print as concise `[native level] subsystem: message` lines in the Vite terminal. For automated verification, `GET /__workout/diagnostics` returns `{ "events": [...] }` with at most the latest 100 redacted, deduplicated events accepted by the current server process.

Redacted JSONL is also written outside the repository at:

```text
${TMPDIR}/workout-analyze/dev-diagnostics/native-diagnostics.jsonl
```

The server prints the resolved path at startup. Files rotate at 1 MiB and retain three rotated files. They are development diagnostics, not durable storage.

Manual diagnostic export remains the path for offline diagnosis and installed bundled builds. The development endpoint does not accept other methods, routes, content types, cross-origin browser requests, or arbitrary event shapes.
