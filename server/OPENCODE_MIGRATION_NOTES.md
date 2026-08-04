# Palma OpenCode Server Migration Notes

Date: 2026-08-03

## Current State

- The service uses `@opencode-ai/cli@0.0.0-next-16741` and is pinned to that exact version.
- Historical chats remain in `state/share/opencode/opencode-next.db` and are visible through the API.
- `websearch` is disabled by the checked-in permission allow list. `webfetch` remains available.
- Do not install the moving `@next` tag in production.

## Web Search Failure

On `next-16741`, a model can create a `websearch` tool call, but the tool remains in `running` state indefinitely. Forcing either supported provider did not make the packaged server complete the call.

The Pi can call the Exa and Parallel MCP endpoints directly. Both returned HTTP 200 responses in under two seconds during diagnosis. A newer local OpenCode build also completed web search. This points to the pinned server's HTTP streaming or response-completion path rather than provider deprecation or basic network access.

## Downgrade Result

The previously installed `next-15760` package is still available from npm, but it is no longer safe for the production data directory. It starts and passes `/api/health`, then returns HTTP 500 when reading sessions after the newer server has opened the database. Treat the database migration as one-way unless a compatible pre-migration backup is restored.

Do not test older binaries against `opencode-next.db`. Use a copy of the database and a separate data directory and port.

## Required Revamp

Choose and validate one of these paths before re-enabling web search:

1. Migrate the deployment and Android client to the current OpenCode V2 server. Validate the database path and migration on a copy, authentication variables and daemon state, session and prompt request schemas, event streaming, history listing, interruption, and deletion.
2. Evaluate the mainline stable OpenCode release instead of the V2 prerelease channel. First confirm that its server API and persistence format support the Android client's required session, prompt, event, interrupt, and history operations. Expect client changes if its API differs.

For either path, back up `opencode-next.db` with its WAL and SHM files while the service is stopped, test the backup in an isolated deployment, and only then switch production. The acceptance test must cover existing history plus a disposable end-to-end chat using `websearch`.
