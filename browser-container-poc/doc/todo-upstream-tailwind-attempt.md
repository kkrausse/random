# TODO upstream Tailwind attempt — BLOCKED at CSS HMR

September 11, 2026. Authorized scope: remove the custom application Tailwind
compiler/scanner and attempt ordinary upstream execution with published WASM
backends; stop at a concrete unsupported behavior rather than add workarounds.

## Source change

- `todo-app-demo/vite.config.ts` once again imports `@tailwindcss/vite` and calls
  `tailwindcss()` in its normal synchronous Vite config, exactly as the standalone
  `aa7a4a6` baseline did.
- Removed `browserCompatibleTailwind()` and its recursive regex scanner from
  `opencode-chat/src/vite.ts`. A repository-wide reference search found no other
  source consumers; the other references were documentation.
- The editor boundary, router/base configuration, authorization, and default-closed
  **Open editor** entry retain their existing behavior.

The original business frontend/backend files have an empty diff against `aa7a4a6`:

```sh
git diff aa7a4a6 HEAD -- browser-container-poc/todo-app-demo
git diff aa7a4a6 HEAD -- browser-container-poc/todo-app-demo/src/home.tsx \
  browser-container-poc/todo-app-demo/src/server/trpcRouter.ts \
  browser-container-poc/todo-app-demo/src/schema/todo.ts
```

Compared with the baseline, Vite still adds React deduplication, the existing editor
boundary/authorization imports, editor/policy proxy routes, and isolation headers.
There is now **no Tailwind-specific application adaptation**.
The complete TODO application diff is **12 files, 163 insertions, 9 deletions**,
including documentation and lockfile; shared-toolkit changes are outside that count.

## Package delivery and provenance

The existing runtime distribution was used intact:

| Item | Exact value |
| --- | --- |
| Runtime source | `80d5cdd599fce4fa4817128461c865e009109d34` |
| Distribution | `098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3` |
| Tailwind Vite/node/compiler/Oxide | `4.3.3` |
| Oxide optional WASM package | `@tailwindcss/oxide-wasm32-wasi@4.3.3` |
| Lightning CSS backend | `lightningcss-wasm@1.32.0` |
| Rollup backend | `@rollup/wasm-node@4.63.1` |
| esbuild backend | `esbuild-wasm@0.28.2` |
| Vite / React Router | `7.3.6` / `7.18.3` |

`prepare:editor` was run once after rebuilding/reinstalling the local toolkit. Its
ignored manifest now matches the existing distribution and includes the restored
upstream config. The distribution and immutable beta-19425 candidate were not rebuilt
or overwritten.

**This was an isolated diagnostic delivery, not promotion of the current preparer.**
The preparer still hardcodes esbuild-wasm `0.25.12` (outside Vite 7.3.6's
`^0.27.0 || ^0.28.0` range), Rollup `4.63.1`, and omits the required Oxide/Lightning
WASM payloads. Its host installation does not use the runtime Fetcher Worker's
registry aliasing. Those legacy product-packaging limitations remain explicit.

For this attempt, the temporary host harness read the runtime-owned
`NATIVE_WASM_ALIASES` table through `runtime-source.mjs`. It delivered unchanged
published backend package trees under their corresponding dependency names,
requiring their versions to match the normally installed host packages. It also
delivered Oxide's published WASM optional dependency. This replaced the diagnostic
asset set's incompatible esbuild payload with `0.28.2`; it added no application
override block, compiler/scanner, dependency source rewrite, or runtime patch.
The browser verified SHA-256 for all 5,692 delivered files, and the server checked
requested runtime asset hashes against the existing distribution receipt.

The probe reused the public Workspace/Runtime/Endpoint APIs and existing preview
attachment. A separate short-lived guest process first checked the actual upstream
scanner and Vite middleware transform. Then a new guest process launched the
prepared TODO's ordinary Vite CLI/config with the existing native config-loader
arguments. A diagnostic HTML source file supplied the arbitrary-variant candidate;
the TODO frontend files were unchanged until the explicit HMR edit.

## Actual real-browser results

Browser Control CLI `0.7.0`, owned session `gentle-otter-161`, fresh loopback origin
`http://127.0.0.1:50571/`. OPFS was asserted empty before opening a durable workspace.
This used browser process workers, including Oxide's worker path, not host Node.

| Check | Result / evidence |
| --- | --- |
| Upstream Lightning CSS transform | **PASS** |
| Upstream Oxide import, constructor, scan | **PASS**, scan includes `data-[state=open]:block` |
| Upstream Tailwind compiler + Vite plugin import | **PASS** |
| Real `vite.createServer` middleware `transformRequest` | **PASS**, emits the arbitrary variant and `display: block`; process exits 0, not forced |
| Unchanged TODO Vite config startup | **PASS**, listener 5173; Vite ready in 6,854 ms |
| TODO root and CSS requests | **PASS**, both HTTP 200; CSS contains the initial arbitrary variant |
| TODO initial preview | **PASS for rendering/style scope**, hydrated input enabled; main padding `0px 16px`, max-width `576px` |
| New utility through source edit + CSS HMR | **BLOCKED**, exact evidence below |

The probe host deliberately had no TODO API/model service. `/api/getTodos` returned
404; backend CRUD/data readiness and the complete editor recipe were not qualified.
The existing input predicate is insufficient by itself to claim backend data readiness.

### Concrete stop: DOM edit arrives but new CSS utility does not take effect

Through `workspace.fs.writeFile`, the probe changed exactly:

```diff
- <div className="row">
+ <div className="row text-[37px]">
```

Within the bounded run:

- The actual iframe DOM became `class="row text-[37px]"`.
- Guest Vite logged `hmr update /src/home.tsx` and
  `hmr update /src/style.css?direct, /src/home.tsx`.
- Browser Vite logged `hot updated: /src/home.tsx` and
  `css hot updated: /src/style.css`.
- The edited **`.row`** element's computed font size remained **`16px`**, not `37px`,
  after 20 seconds. Captured inline styles contained no `37px` utility.
- The browser also warned that the CSS URL was preloaded but not used, including
  its updated `?t=...` URL. This is an observation, not an established root cause.
- Guest stderr was empty. The failure stack is from the bounded acceptance check:

```text
Error: CSS HMR on edited .row timeout
    at http://127.0.0.1:50571/probe.js:926:39
```

This does **not** identify whether the remaining fault is scanner invalidation,
Vite/React Router CSS delivery, or the existing preview transport/application of CSS.
Initial scanner/plugin loading is proven separately. No speculative repair was made.

An earlier run at port 50401 edited the first class-bearing `.row` but incorrectly
checked `<main>` for the resulting outline width. Its timeout is a **harness defect**,
not runtime evidence. It was retained, corrected to an exact `.row` edit/assertion,
and followed by the single bounded run above. No further runtime retries were made.

## Host verification

- `opencode-chat`: `bun run typecheck` and `bun run build` **PASS**.
- Reinstalled the compiled local consumer dependencies with Bun `1.3.9 --force`;
  no lockfile diff resulted.
- TODO: ordinary `bun run typecheck` and `bun run build` **PASS**, including
  production client build and React Router prerender.
- Existing focused editor/source/lifecycle/markup tests: **8 PASS, 29 assertions**.
- No additional implementation-mirroring tests were added for the config restoration.

## Retained evidence and cleanup

Local evidence directory (ignored, no generated payload committed):

```text
vivari/.runtime/todo-upstream-tailwind/920ee39745e3864a/
```

It contains `receipt.json`, the first harness receipt, both diagnostic scripts,
the published-backend dependency manifest/lock, and host provenance. The original
execution directory is:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/todo-tailwind-browser.Eb3etl/
```

| Evidence | SHA-256 |
| --- | --- |
| Final receipt (20,780 bytes) | `920ee39745e3864a534a636dafb2bf9af80c549350aabb7470387b8d53df5bcc` |
| First, defective-harness receipt | `9281e739ca48a896509c22be2e890890a4b3e27ed92831611d20b9320868e38f` |
| Corrected browser harness source | `7dee9766f3684a37521f2abe29c3f5e2c2c996b7f2d9a54bb42846b88180bd2c` |
| Host delivery harness source | `c2f746296603464621d44a9b1462165584c033874f91d4108247c7b5e5691ca6` |

The final receipt records source restoration, endpoint disposal, runtime stop,
stdout/stderr drain completion, and workspace close. Vite ended by intentional
SIGTERM (forced, exit 143); this is cleanup, not a startup failure. Both owned host
servers were stopped; ports 50401 and 50571 were verified unreachable. The Browser
Control session/page was deleted. Isolated-origin OPFS scratch data was left in its
own origins; existing user OPFS was neither opened nor overwritten. The first
defective run's scratch edit is confined to its discarded isolated workspace.
The pre-existing untracked `vivari/scripts/probe-tailwind-direct.mjs` was preserved.

## Escalation / next exact step

Stop here under the no-hacks constraint. The next bounded investigation should
compare **post-edit upstream-generated CSS bytes with the stylesheet actually
applied in the iframe**, using the exact `.row text-[37px]` reproduction. Capture
the CSS response and stylesheet/link lifecycle before teardown; do not guess a
scanner or preview fix from the timeout alone. Keep it separate from product
dependency-delivery design.

After that capability is qualified, promote normal WASM dependency delivery through
a reusable platform-owned path (either the existing registry installer or a narrowly
designed host-delivery consumer of the same backend policy). Do not add another
application override/scanner. The ordinary preparer still needs that delivery work.

OpenCode scope remains the older `d7a7256` package and CLI wrapper in `prepare.ts` /
`recipe.ts`. No OpenCode process/model call, beta-19425 migration, built-in shell,
chat retention, or full editor acceptance was attempted here. The immutable qualified
beta-19425 candidate and existing runtime distribution remain intact.
