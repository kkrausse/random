# irs-tools local editor trial — 2026-09-17

## Formatting follow-up

At the user's request, rebuilt the local irs-tools history using its existing
Prettier configuration (no single-quote override): `f7d8c75` formats the pre-editor
baseline, then `6a49d9d` reapplies the editor integration. This replaces `7909f82`
mentioned below. Verified that all 14 files differing from the original editor
commit are exactly its contents passed through the existing Prettier config.
The user's `AGENTS.md` formatting-section removal remains preserved as their
uncommitted edit. Toolkit fix `c5be267` is unchanged. Nothing was pushed.

User chose local installation for the first irs-tools trial, with public-package
imports so npm distribution can replace local dependencies later. No GitHub
package-read authentication or shell/registry configuration was added. Initial
workspace is a browser-local copy of irs-tools.

## Commits

- Toolkit `c5be267`: binary project source preservation, committed independently
  at the user's request. The old `.text()` roundtrip changed both irs-tools assets
  `og-image.png` (398,782 bytes) and `f2848.pdf` (142,587 bytes). New encoding and
  prepared manifest delivery match both originals byte-for-byte. Two focused tests,
  chat typecheck and library build passed. No runtime fork changes.
- irs-tools `7909f82`: local package dependencies, preparation/launcher, opt-in
  editor UI, runtime asset handling, model proxy, guest Vite boundary, isolation
  headers and setup documentation. Not pushed.

## Running setup

From `irs-tools`, `bun install` then `bun run dev:editor`.
`bun scripts/devEditor.ts` restarts without preparing again.
The launcher reuses the existing local Zen API credential on the host only;
`VIVARI_MODEL_API_KEY` can override it. Existing SOPS development setup still applies.

At this report's creation, the session-owned launcher is running via OpenCode
shell `sh_0b1f5e8ca0012jwRNP2M87tnLK`:

- UI: http://127.0.0.1:5193/ — **Edit local copy** button after client hydration.
- API: http://127.0.0.1:3193/.
- Ports were checked free before starting. Recheck liveness before reuse.
- Browser Control has not opened this origin, and no OPFS state was reset.

Detailed consumer setup and migration steps: `irs-tools/docs/browser-editor.md`.
Local paths live in package dependency declarations/lockfile; application imports
use toolkit exports, and runtime discovery uses the distribution export.
Runtime dependency currently points at the validated local check-pack directory.
It is identity `972d9bc8d3515d3c1dfcf4fb4fc95efae7f939328aa6b497e1c999cd38d14884`,
**not** the published CI distribution. Chat uses the rebuilt local binary-source fix.
The initial trial lockfile requires those built sibling directories and is not
standalone CI/deployment-ready until dependency sources are replaced.

## Verification

- `bun install --frozen-lockfile`: passed with isolated linker.
- `bun run prepare:editor`: passed; 93 project files, 31,959 verified tree entries,
  74 MiB compressed dependency/application bundle. SOPS/.env/root server/database/
  Git inputs excluded from source allowlist; public client config delivered instead.
- Manifest PNG/PDF bytes verified against actual files; runtime identity matches
  the installed distribution. Existing browser source is seeded only when missing.
- `bun run typecheck`: passed.
- Production build/prerender: passed, with existing sourcemap/large-chunk/splat notes.
- `bun test`: 29 pass, 5 fail. All five failures are in unchanged
  `src/server/storage/encryptedStorage.test.ts`, reporting missing `tax_entities`
  in the in-memory fixture. New local authorization test passes.
- Formatting of touched files and `git diff --check`: passed.
- HTTP: landing page 200 with expected heading and COOP/COEP; preparation/runtime
  assets 200; foreign-origin preparation and editor module requests 403.

React Router's dev document response bypassed Vite's static header setting, so
the SSR entry also applies isolation headers for the local trial. React 19.1's
Node server export lacked `renderToReadableStream`; the explicit `server.browser`
entry supplies the existing streaming API consistently.

## Pending browser acceptance

Browser Control 0.7.0 reports the extension disconnected, matching reachable relay,
and no active targets. The initial execute failed before creating a usable page.
User was asked to reconnect; diagnostics recorded in `browser-control-todo.md`.
No browser chat, in-browser Vite preview, Clerk behavior under isolation, model
edit/HMR, or restart/reload claim has been established for irs-tools yet.

Next: reconnect extension, open port 5193, inspect/click **Edit local copy**, verify
actual app preview and model-selected edit/shell, then check retention. Keep edits
in the browser copy; do not reset any pre-existing origin storage.
