# Physical iPhone development runner

This development-only runner sends a small JavaScript snippet from the Mac dev server to the **foregrounded real WKWebView app** and returns its value, captured console output, error, duration, and phone metadata. The dev-server message handling and async-function evaluation both run in the page's TypeScript/browser runtime; Swift does not receive or execute runner jobs. It is not a desktop simulator and does not provide a fake bridge.

The runner exists only in Vite serve mode. `import.meta.env.DEV` guards its dynamic web import, and the server plugin uses `apply: 'serve'`, so packaged builds have neither an eval entry point nor runner endpoints.

## Run a script

Keep the Workout Analyze app open and foregrounded on the physical iPhone, using the supported HTTPS development source. Then run from the repository root:

```sh
bun scripts/mobile/dev-runner/run.ts \
  --server https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443 \
  --code 'return await bridge.request("heartRate.status", {})'
```

Or execute a file:

```sh
bun scripts/mobile/dev-runner/run.ts --server https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443 --file /absolute/path/to/check.js --timeout 12000
```

Jobs target a native client by default. `GET /__workout/run` lists recently seen clients and jobs; pass `--kind native|simulator|unavailable` to select the client kind and `--client <client-id>` to pin a job to one phone page. If no job is claimed, foreground the app rather than switching to a simulator.

The runner is independent of native bridge health. A development page without a working native message handler still registers as kind `unavailable`, and can execute page-runtime inspection code with `--kind unavailable`. Only calls that cross `bridge.request(...)` require the native bridge. This distinction is useful for debugging startup, rendering, Zustand state, configuration, and bridge discovery itself.

## Script API

The snippet is the body of an async function:

```js
console.info('checking the validated native bridge')
const hello = await bridge.request('bridge.hello', {
  clientName: 'iphone-dev-check',
  clientVersion: '0.1.0',
  supportedProtocolVersions: [1],
})
const session = await bridge.request('session.snapshot', {})
const heartRate = await bridge.request('heartRate.status', {})
return { hello, session, heartRate }
```

- `bridge.request(method, params)` is the existing validated native bridge client. It is intentionally separate and should be used for protocol diagnostics.
- `bridge.getState()` and `bridge.refreshSnapshot()` expose the same client state/refresh path used by the app.
- `app.actions` is an explicit facade over the **same Zustand action functions used by UI buttons**. Use it to reproduce a user workflow instead of reimplementing that workflow with direct bridge calls.
- `app.getState()` reads current app state with location coordinates and retained sensor samples redacted. `app.getState({ includeSensitive: true })` explicitly requests them.
- `inspect.bridgeState()` and `inspect.appState()` are read-only inspection aliases.
- The supplied `console` (`log`, `info`, `warn`, `error`, `debug`) is scoped to the script and collected without replacing the page's global console.

For example, these invoke the exact actions behind the app controls:

```js
await app.actions.scanHeartRate()
return app.getState().heartRate
```

```js
await app.actions.startWorkout('waitForReliableLocation')
return app.getState().session
```

The normal store action surface includes workout start/pause/resume/finish/recovery/export, archive operations, permissions, location probes, heart-rate scan/connect/read/disconnect, diagnostics, navigation, and development-source/build actions. These are real operations with native authority—there are no mocks by default. Do not run mutating snippets against an active workout unless that mutation is intended.

## Safety and lifecycle

- Requests are accepted only on the selected same-origin dev server; cross-origin browser requests are rejected.
- Code is limited to 64 KiB, results to a bounded payload, timeout to 30 seconds, logs to 200 entries, and completed jobs expire.
- A claimed job cannot be claimed twice. Reloading or hiding the page during execution marks it `unknown`; it is never retried because a native mutation may already have happened.
- Timeout is observation, **not JavaScript cancellation**. The page stops accepting further jobs after a timeout because the timed-out code may still produce side effects.
- Results are made JSON-safe; circular references and BigInts are represented safely. Error messages/stacks receive basic credential redaction.
- The runner does not automatically dump credentials, coordinates, or raw sensor logs.

## Server API

- `POST /__workout/run` — queue `{ code, timeoutMs?, targetKind?, targetClientId? }`; `targetKind` defaults to `native`.
- `GET /__workout/run` — list bounded current jobs and last-seen client metadata.
- `GET /__workout/run/:id?waitMs=20000` — read or long-poll status.
- Phone-only claim/result/abandon subroutes are used by the injected runner.

Production verification:

```sh
bun run mobile:build
grep -R '__workout/run\|AsyncFunction' mobile/dist/ui && echo 'unexpected runner in production build'
```
