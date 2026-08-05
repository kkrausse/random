# Palma OpenCode Server Migration Notes

Date: 2026-08-03

## Current State

- The service uses stable `opencode-ai@1.18.13` and is pinned to that exact version.
- Historical chats were migrated into `state/share/opencode/opencode.db` and are visible through the API.
- `websearch` and `webfetch` are enabled by the checked-in tool and permission policy.
- Do not install a moving release tag in production.

## Web Search Failure

On `next-16741`, a model can create a `websearch` tool call, but the tool remains in `running` state indefinitely. Forcing either supported provider did not make the packaged server complete the call.

The Pi can call the Exa and Parallel MCP endpoints directly. Both returned HTTP 200 responses in under two seconds during diagnosis. A newer local OpenCode build also completed web search. This points to the pinned server's HTTP streaming or response-completion path rather than provider deprecation or basic network access.

Production subsequently migrated to stable OpenCode `1.18.13`; web search was re-enabled after that migration.

## Downgrade Result

The previously installed `next-15760` package is still available from npm, but it is no longer safe for the production data directory. It starts and passes `/api/health`, then returns HTTP 500 when reading sessions after the newer server has opened the database. Treat the database migration as one-way unless a compatible pre-migration backup is restored.

Do not test older binaries against `opencode-next.db`. Use a copy of the database and a separate data directory and port.

## Migration Plan

The migration considered these paths before re-enabling web search:

1. Migrate the deployment and Android client to the current OpenCode V2 server. Validate the database path and migration on a copy, authentication variables and daemon state, session and prompt request schemas, event streaming, history listing, interruption, and deletion.
2. Evaluate the mainline stable OpenCode release instead of the V2 prerelease channel. First confirm that its server API and persistence format support the Android client's required session, prompt, event, interrupt, and history operations. Expect client changes if its API differs.

Path 2 was completed with stable OpenCode `1.18.13`.

For either path, back up `opencode-next.db` with its WAL and SHM files while the service is stopped, test the backup in an isolated deployment, and only then switch production. The acceptance test must cover existing history plus a disposable end-to-end chat using `websearch`.
