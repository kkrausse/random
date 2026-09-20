# Native UI source state

`BuildManager` is the sole native authority for UI source selection. `developmentURL`, when present, wins; otherwise the active bundled/installed build supplies the UI. Startup, native recovery, `devSource.configure`, build activation/rollback, and reload all resolve through `BuildManager.activeUIURL()`.

The existing `appBuild.status.active` field is **not the effective web UI source**. Its strict phase-1 contract is the active bundled/installed build artifact and engine pointer. Its `source` remains `bundled | installed`; React must label it “Build source” rather than “Current source.” `lastFailure` is an unresolved current build/load operation failure and clears when a new load starts or the current generation completes its hello.

Native lifecycle truth is available without changing the strict bridge contract in the `webBuild` diagnostics row under `details.uiSource`:

- `configured`: selected development origin or build pointer
- `targetUrl`: URL of the current load generation
- `loadedUrl`: last URL that completed `bridge.hello` in this process
- `loadState`: `notLoaded | navigating | awaitingHello | ready | failed`
- `currentFailure`: failure for the current target, or null
- `lastFailureHistory`: retained historical failure, not current health
- `generation`: native load generation

A future first-class `appBuild.status.uiSource` requires a coordinated shared-contract revision because current clients reject unknown status keys.
