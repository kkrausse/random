# Stable OpenCode Migration

Updated: 2026-08-04

## Server Status

The Raspberry Pi deployment has been migrated from the OpenCode V2 prerelease
to regular OpenCode `1.18.13`.

- Active service: `palma2-opencode.service`
- Retired service: `palma2-opencode-v2.service` (removed)
- Canonical executable: `/home/pi/.bun/bin/opencode`
- Server: `http://100.64.0.10:41137`
- Stable database: `/home/pi/deploys/palma2-opencode/state/share/opencode/opencode.db`
- Preserved beta database: `/home/pi/deploys/palma2-opencode/state/share/opencode/opencode-next.db`
- Password variable: `OPENCODE_SERVER_PASSWORD`
- Basic auth username: `opencode`

The password value did not change. `server/deploy.sh` renamed the old
`OPENCODE_PASSWORD` variable in place.

## History Migration

The beta database stored messages in `session_message`; stable OpenCode reads
the classic `message` and `part` tables. `server/migrate-v2-history.sh` performs
a one-time conversion when the classic tables are empty. It also removes the
beta-only required `event.created` column, which prevents regular OpenCode from
recording session events.

The migration preserves:

- sessions and titles
- user prompt text
- assistant response text
- timestamps and parent links
- provider/model identifiers
- token and cost metadata

Beta-only encrypted reasoning state and tool execution internals are not copied.
The original `opencode-next.db` remains available if those records are ever
needed.

Stopped-state backups were created outside the deployment root at:

```text
/home/pi/palma2-opencode-before-stable-*.tgz
```

## Validation

The production deployment passed these checks:

- `GET /global/health` returned OpenCode `1.18.13` healthy.
- `GET /session` returned 100 historical reading sessions.
- The sampled latest session returned one user and one assistant message with
  text parts.
- `GET /config/providers` returned two configured providers.
- `palma2-opencode.service` is active and enabled.
- The obsolete V2 global package and systemd unit were removed.
- Only the production `palma2-opencode.service` process remains running.

## Client Status

The Chrome extension now uses the regular OpenCode contract. Its tests,
TypeScript check, and production build pass; manually reload `chrome-plugin/dist/`
to validate it in Chrome. The Android app still uses the beta `/api/*` contract
and remains to be migrated.

Incremental assistant text arrives as `message.part.delta` with
`properties.sessionID`, `messageID`, `partID`, `field`, and `delta`. The Chrome
handler applies these deltas for live token-by-token rendering, then reloads the
canonical server message on completion.

Use the regular OpenCode `1.18.13` contract from the installed
`@opencode-ai/sdk@1.18.13` generated types. The required subset is:

| Purpose | Regular OpenCode API |
| --- | --- |
| Health | `GET /global/health` |
| Models | `GET /config/providers?directory=...` |
| List sessions | `GET /session?directory=...` |
| Create session | `POST /session?directory=...` with optional title |
| Send asynchronously | `POST /session/{id}/prompt_async?directory=...` |
| List messages | `GET /session/{id}/message?directory=...` |
| Stop response | `POST /session/{id}/abort?directory=...` |
| Events | `GET /event?directory=...` |

Important shape changes:

- Responses are direct JSON values, not `{ "data": ... }` envelopes.
- Session creation does not accept a model. Prompt bodies use
  `{ "model": { "providerID", "modelID" }, "parts": [{ "type": "text", "text": "..." }] }`.
- The generated SDK prompt type omits variants, but the `1.18.13` server's
  `prompt_async` schema accepts a top-level `variant`, and provider models expose
  available variants as an object keyed by variant ID.
- Messages are `{ "info": Message, "parts": Part[] }`.
- User/assistant roles are at `info.role`; visible text is in `parts` entries
  whose type is `text`.
- Assistant model fields are `info.providerID` and `info.modelID`.
- Session rows do not contain cumulative usage. Sum assistant
  `info.tokens` and `info.cost` from messages.
- SSE events use `{ "type", "properties" }`. Streaming text arrives as
  `message.part.updated` with `properties.part`, `properties.delta`, and the
  session ID at `properties.part.sessionID`.
- Completion is signaled by `session.idle`; failures use `session.error`.

The cached `docs/opencode-v2-openapi.json` describes the retired beta server and
must not be used for the client migration. The targeted stable contract was
queried from generated SDK files without loading a full OpenAPI document.

## Operations

Deploy stable server changes with:

```sh
./server/deploy.sh
```

Deployment stops both historical systemd units, terminates any remaining
OpenCode, OpenCode2, or local development server processes, and then starts
only `palma2-opencode.service`. It does not reboot the Raspberry Pi.

Override the pinned version only deliberately:

```sh
OPENCODE_VERSION=1.18.13 ./server/deploy.sh
```

Read the server password with:

```sh
ssh your-pi "sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' /home/pi/deploys/palma2-opencode/state/server.env"
```
