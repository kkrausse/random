# Web app model transport

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

No real provider calls or credential use were performed for this implementation.
The previous 429 evidence remains the last real model result. A browser SDK
success loop and authenticated forwarding remain unqualified. Before those
calls, decide the provider credential explicitly; see the
[historical checkpoint](vivari-model-checkpoint.md).
