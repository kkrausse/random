# irs-tools: library-owned diagnostics follow-up

Date: 2026-09-17 local (recorded events use 2026-09-18 UTC).

## Goal and ownership

The user confirmed that tool-driven edits work and prioritized a clean, switchable,
library-owned diagnostic stream before performance work and production providers.

The implementation lives in sibling `browser-agent-toolkit-upstream`:

- Workspace `/diagnostics`: shared event bounding/redaction, timed scopes/heartbeats,
  buffered transport with retry/backoff and explicit overflow counts.
- Chat `/diagnostics`: browser configuration discovery, authenticated delivery and
  browser-error/lifecycle integration. Process capture follows the host's switch.
- Chat `/diagnostics/server`: ingestion validation, optional bounded rotating file
  sink, stable-ID retry deduplication, model error reading and log CLI.
- Chat server handler: diagnostic endpoints, contextual actor identity, preparation
  callback and model response/error events.
- Host preparer: timed runtime/application checks, input/package copies, each install
  and its output, package inspection, tree capture, snapshot, bundle and cleanup.
- Browser recipe: correlated manifest request, fetch/decode/validation, bundle cache,
  download/decompression, bulk delivery mode and detailed install result.

The irs-tools app supplies authorization, storage/retention, and `EDITOR_DIAGNOSTICS`.
Its previous client reporter, sanitizing helper, ingestion schema, storage/reader
implementation and model-error inspection were removed/moved into the library.
`EditorPanel` has no diagnostic props/listeners. `withEditor()` authorizes and delegates.
App-specific preparation cache/publication events use the library-provided scope.

## Runtime evidence

Authenticated browser session: `tidy-walrus-087`, `http://localhost:5173/dashboard`.

The new host stream measured a cache miss under run
`e9e1d1d0-3925-4282-abb7-52a6a4d03078`:

- Total preparation: 31,501ms.
- Fingerprint: 4ms, 96 inputs.
- Dependency preparation: 13,002ms. Installs: 3,873ms original, 826ms derived,
  6,646ms fresh verification; removing the first tree took 1,374ms.
- Local package copying: 26ms; installed-package inspection: 211ms.
- Dependency capture: 6,061ms; bundle assembly/compression: 3,590ms.
- Cleanup: 4,338ms; app publication: 4,224ms.

The full new browser/server stream then recorded warm run
`3398aa43-019e-454c-ad44-a0098beaaab9`:

- Successful complete startup: 34,247ms.
- Load preparation: 376ms (fetch 12ms, decode 119ms, validation 229ms).
- Workspace open: 5,243ms; seed missing source: 85ms.
- Start runtime and deliver tree: 9,873ms.
- Start services and render clients: 18,661ms.
- Cached bundle: 77,372,634 compressed bytes, 340,182,561 expanded bytes.
- **Bulk-tree delivery**, 26,088 files. Verification 830ms, install 7,409ms,
  readback 104ms. This was not the individual-file fallback.
- Thirteen guest stdout/stderr events were captured during startup.
- A real asynchronous browser exception named `EDITOR_LIBRARY_DIAGNOSTICS_PROBE`
  reached the host with its stack. It did not modify workspace source.
- The preview rendered **Process transcripts faster**, preserving the user's manual
  agent-generated copy changes. Saved chat history also showed the user's completed edits.

The existing TODO manifest has 10,482 tree entries / 8,852 files and a 36,963,803-byte
compressed bundle. irs-tools has 31,965 entries / 26,088 files and roughly twice the
compressed bytes. These are saved-manifest sizes, not controlled simultaneous timings.

## Stale local library discovery and repair

Reinstalling same-version `file:` packages and `bun dev --force` was insufficient:
the browser executed the old `PreparedBrowserEditor`, with no new diagnostic reporter,
while a no-store fetch of the exact module URL returned the new implementation.
Vite excluded these modules from prebundling but still gave them immutable `?v=` URLs.

The library's Vite boundary now hashes installed editor/workspace client artifacts
into `optimizeDeps.esbuildOptions.define`, which Vite includes in its optimizer hash.
Top-level `define` is not included in Vite 7's dependency hash and was insufficient.
After an ordinary restart/reload the module URL changed from `v=68dcb113` to
`v=9b9d57c8`, and inspecting the executing export confirmed the new reporter was loaded.
The browser stream then reached the host normally. No browser storage was cleared.

Use `bun install --force --frozen-lockfile --no-save` after local package builds.
Bun 1.4 wrote duplicate workspace-package entries when a forced reinstall saved the
chat lockfile. The incidental lock changes were restored; no dependency upgrade is included.

## Checks and known failures

- Workspace library build and 16 tests pass.
- Chat library build/typecheck pass. Focused editor/server/prepared-delivery tests
  passed (17), then the real failed host-process test was added and all nine diagnostic
  integration tests passed.
- Tests exercise real HTTP ingestion, lost acknowledgements/retry IDs, redaction,
  invalid/oversized input, host-owned actor metadata, rotation, disabled collection,
  correlated failures, provider response preservation, browser switch discovery,
  CLI `--follow --json`, and actual failed subprocess stderr/stdout.
- App typecheck, production build and nine auth/proxy/static tests pass.
- The broad chat run had 88 pass / 1 skip / 1 fail before the last three diagnostic
  tests were added. Failure: `disposing during handshake interrupts readiness and
  releases the stream`, `test/controller.test.ts:447`, expected cancellation 1, got 0.
  Reproduced in an unchanged `bb122a1` worktree with the same dependencies; baseline
  worktree removed afterward. This is not a diagnostics regression.
- Existing missing-`tax_entities` full-app test failures were not addressed.

## Next sequence

1. Cache verified immutable dependency preparation separately from cheap source/config
   snapshot refresh. The new timings establish that source changes currently repeat
   installers, capture, compression, cleanup and publication.
2. Use `bundle.*`, `delivery.*`, worker and service stages to reduce the still-real
   ~34s warm startup. Bulk loading is already active; inspect tree size and reuse.
3. Configure production provider keys plus guest model/provider configuration, replace
   local dependencies with deployable pinned packages, and deploy.

Operational reference:
`/Users/kkrausse/Documents/repos/kkrausse/irs-tools/docs/browser-editor.md`.
Current handoff:
`/Users/kkrausse/Documents/repos/kkrausse/irs-tools/docs/browser-editor-handoff.md`.
Library API:
`/Users/kkrausse/Documents/repos/kkrausse/browser-agent-toolkit-upstream/opencode-chat/README.md#diagnostics`.
