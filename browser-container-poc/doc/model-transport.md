# Web app model transport

## Latest result: real inference and browser tool loop succeeded

On 2026-09-06, `nemotron-3.5-lightning-free` (NVIDIA, not Meta) succeeded through
Vivari's embedded OpenCode → Vite → Bun proxy → Zen using the approved local
Zen key. The pinned Zen catalog contained no Meta/Llama entry.

- Session: `ses_f88121acaffeOvgJptgJpSSnZd`.
- Fixture: `/workspace/opencode-model-1788718474370`.
- Six primary model requests returned HTTP 200; 50 text-delta events streamed.
- Six successful tool calls: glob, read twice, shell, edit, shell.
- The first test failed with an assertion; the model changed subtraction to
  addition; the same test then passed. An independent guest check confirmed
  the test file remained byte-for-byte unchanged and reran it successfully.
- OpenCode emitted `session.execution.succeeded` and closed cleanly.

The stricter five-tool qualification still returned exit 1 because the model
skipped `grep`: `AssertionError: Model did not successfully use grep`. Its
`failure.json` describes that coverage failure, not an inference failure. The
probe assertions were not weakened. Full five-tool qualification remains open.

Evidence: ignored `vivari/.runtime/opencode-package/model-e2e-zen-nemotron.log`
and the guest fixture's `trace.ndjson`/`failure.json`. The credential-bearing
server was stopped after the run. This successful request establishes that the
key/proxy combination works for Nemotron; earlier Big Pickle/MiMo 429s do not
imply a universally broken key or proxy.

## Decision (2026-09-06)

Use a small Bun/TypeScript HTTP proxy in the web app server. OpenCode SDK,
provider adapters, sessions, filesystem, and tools execute in browser workers.
The server forwards native HTTP streams and attaches configured credentials;
it does not run OpenCode or interpret model JSON. This is deployment-neutral.
Direct transport can still be selected by giving the embedded provider its
original base URL; the current qualification harness selects the proxy.

```
browser OpenCode provider → /api/model/opencode/<SDK-selected path>
                         → catalog upstream base + path + query
```

The initial enabled provider is `opencode` (Zen). Paths are not enumerated: the
SDK can select chat/completions, responses, or other paths beneath that base.
There is no arbitrary destination URL parameter and no proxy-level model retry.

## Catalog reuse

The V2 [provider docs](https://opencode.ai/v2/docs/providers) document the
models.dev-derived catalog and provider `settings.baseURL` overrides. A schema
describes data shape; the catalog supplies the actual URLs.

In pinned SDK/core `0.0.0-dev-19167`, the snapshot is a string literal bundled
inside core's compiled chunks, rather than a lightweight exported JSON file.
`vivari/scripts/sync-provider-routes.ts` uses TypeScript's parser to read that
literal without executing OpenCode, fetching a catalog, or accessing credentials.
It generates `vivari/src/provider-upstreams.json`, containing the SDK version and
concrete HTTPS base URLs. Parameterized endpoints are omitted. `bun run build`
regenerates it; `bun run sync:providers` runs it separately.

This is a **version-checked extraction adapter**, not an upstream stable catalog
export. An SDK version/layout change fails the extraction for review. There are
no copied endpoint-path lists. The generated catalog does not enable providers:
`src/model-transport.ts` owns enabled provider IDs and public proxy URL construction;
the server looks up those IDs in the generated catalog.

Adding another provider requires enabling its ID and supplying its explicit
server auth/header policy. Catalog environment-variable names alone do not tell
us how to authenticate. OAuth refresh, signed requests, custom deployment URLs,
and provider-specific model-level URL overrides need separate qualification.

## Running locally

From `browser-container-poc/vivari`, in separate terminals:

```sh
bun run serve
```

```sh
bun run dev --port 5192
```

Vite forwards `/api/model/*` to the Bun web app server at `127.0.0.1:5194`.
Set `VIVARI_WEB_PORT` consistently in both processes to change that port.
For built assets, run `bun run build`, then `bun run serve` and open port 5194.
The built-app server preserves COOP/COEP isolation headers for worker assets.
Vite preview is static-only; use the Bun server for built-app model transport.
Existing browser runtimes can remain on their current origin; changing origins
selects different browser storage.

The server binds only to loopback in this first implementation. Application
authentication and non-local deployment are not implemented yet.

## Credentials and forwarding

Zen defaults to `Bearer public`. `VIVARI_MODEL_API_KEY` explicitly supplies a
server-only key if selected later. It is never put in `VITE_*`, the guest, or
the generated catalog. The old `VIVARI_MODEL_AUTH_FILE` discovery option was
removed. No existing host account is automatically used.

The proxy strips browser credentials, cookies, origin/referrer, forwarding and
hop-by-hop headers, then applies the server route's authentication headers.
Protocol headers such as `anthropic-version` pass through. Response status,
body streams and provider headers such as `retry-after` pass back; upstream
cookies and hop-by-hop headers are removed. Fetch-decoded response bodies are
returned without stale content-encoding/content-length. Redirects are not
followed server-side. Client abort is passed to upstream fetch. Transport
failures return a generic 502 without logging bodies or secrets.

## Qualification

`bun test scripts/model-proxy.test.ts` uses loopback mock upstreams only. It
checks opaque request forwarding, arbitrary SDK-selected paths and queries,
header/credential isolation, 429 response propagation, streaming before upstream
completion, client-abort propagation through actual Bun servers, and redirects.
Build/typechecking also pass. Static serving and isolation headers were checked
on the built app.

No real provider calls or credential use were performed in the implementation
commit `fb5ad55`. The subsequently approved E2E run is recorded below.

### Authenticated browser E2E attempt (2026-09-06)

User explicitly approved using the existing Zen API-key entry with free models.
The key was loaded into the Bun server's process environment only, without
printing it or writing a credential file. The browser stayed at origin 5192,
reloaded the new harness, and booted its existing OPFS storage without resetting it.

Both probes packaged and digest-verified the SDK/assets, created an OpenCode
host and session inside Vivari, checked zero catalog input/output pricing, and
issued a primary request through `/api/model/opencode/chat/completions`:

| Model | Session | Guest fixture | Result |
| --- | --- | --- | --- |
| `big-pickle` | `ses_f881ce5e3ffeMEGZjJg9vaAIJO` | `/workspace/opencode-model-1788717767000` | HTTP 429 |
| `mimo-v2.5-free` | `ses_f881c8703ffeFE1G70c0uCsQ9M` | `/workspace/opencode-model-1788717791303` | HTTP 429 |

OpenCode classified each response as `provider.rate-limit`: “Error from provider
(Console): Rate limit exceeded. Please try again later.” Each emitted
`session.step.failed` and `session.execution.failed`, wrote `failure.json`,
closed its host cleanly, and returned exit 1. No token output or tool calls
occurred. This establishes the real browser → Vite → Bun proxy → Zen response
path with the configured credential; it does not establish successful inference,
credential acceptance, or model-selected tool execution. The 429 alone does not
identify whether the restriction is account-, IP-, or model-scoped.

Ignored host evidence in `vivari/.runtime/opencode-package/`:
`model-e2e-zen.log`, `model-e2e-zen-failure.json`,
`model-e2e-zen-mimo.log`, `model-e2e-zen-mimo-failure.json`.
Guest fixtures retain their traces. Browser runtime ID at this handoff:
`5bcd61cc-9d00-483b-b457-f835c1caad2f`; recheck with `vv status`.

The credential-bearing Bun server was stopped after the attempts. Vite on 5192,
the relay on 5193, and the browser tab were retained. A new probe needs the Bun
server started again. The remaining gate is successful inference after the Zen
limit clears or another explicitly selected provider/model becomes available.

### Credential/routing isolation check

Following the user's question about incorrect header attachment, a loopback
mock checked that the proxy's outgoing Authorization header exactly matched
`Bearer <approved local Zen key>` while replacing an incoming `Bearer public`.
Only the equality boolean was printed; it was true.

The same minimal Big Pickle request (8 output tokens maximum) was then sent
directly to Zen using that key and through the actual `modelProxy` handler.
Both returned HTTP 429 with `error.type: FreeUsageLimitError` and the same
Console rate-limit message; neither supplied Retry-After. This reproduces the
failure without the proxy and verifies key attachment in the handler. It points
to Zen's free-usage restriction rather than proxy header loss, but does not
prove the key's validity or determine the restriction's account/IP scope.
