# OpenCode 2.0.3 upgrade — September 15, 2026

**PASS: the TODO browser editor now targets stable OpenCode 2.0.3.** The server is
built from published packages and the chat client uses the exact 2.0.3 generated
contract. No Vivari change was needed; runtime pin remains `33305d5`.

## Inputs and delivery

| Input | Identity |
| --- | --- |
| Release | `@opencode/server@2.0.3`; upstream tag `v2.0.3` |
| Tag revision | `d44b52ca66b6bf69626c0384626d1a9cd9555977` |
| Frozen consumer lock SHA-256 | `d50fd8123bd950a286a70a1ae890d5ee5cd6203d0aaa83b63552a36bc78020de` |
| Server JS | 27,721,709 bytes; `1df4bc41c0f6c7350da9d5953f3139586f760a7931fe411bdcabb3460098a929` |
| Final build receipt | `df6a3d88f014f95c1dd5957a06c6e3baa3ca4d4dd45ca4be5ea88d6518627813` |
| Generated client contract | `9238842bf9d4dbef486f4c20fb4051a5ccb051a30a9d84a9d4267c089ef37fed` |
| Runtime distribution | `913a31409aa2fbae699e3e1675f8ec11fb48c7c7c0b8edc5c93e4ad36b93338d` |
| Tailwind | Existing PR #20487 source `11050dda2c4e26a3412b1745e84ea41d8fed6335` |

Registry `latest` for both `@opencode/server` and `@opencode/client` was 2.0.3.
GitHub's general latest-release API still reports the V1 release line, so it was
not used to select the V2 version. V2 documentation consulted:
[intro](https://opencode.ai/v2/docs/),
[client](https://opencode.ai/v2/docs/build/client), and
[Effect SDK](https://opencode.ai/v2/docs/build/sdk/effect).

The build recipe is tracked in `vivari/experiments/opencode-release-server/` with
a frozen lock and invocation-only launcher. It uses the same exported server
process/lifecycle API as the beta. Published archive integrity is explicit in the
receipt/verifier; tag revision identifies the release and is **not** a claim that
a source checkout produced those registry archives locally. Generated types are
independently downloaded from the exact tag and hash-checked.

The receipt was corrected after the browser run to represent published inputs
without a fictional clean-checkout field. Initial receipt `68911b14…` and tested
prepared manifest remain in the evidence directory. Rebuilding with the final
receipt recipe produced **identical bytes/hashes for all five application outputs**;
`summarize.ts` verifies that equality. Final archive-verifier integration checks
passed, including rejection of wrong package version/integrity or missing lock
identity. The full browser run below used those identical application bytes.
After final preparation and host rebuild, browser run `mu3c8r4i` also passed
startup and natural EOF shutdown with the final receipt. Its separate
`final-receipt-smoke.json` records closed runtime/workspace and joined output drains.

## Compatibility findings

- Initial published-package import selected transitive Effect platform rc.115
  against Effect rc.112 and failed on missing `effect/ByteSize`. Explicitly pinning
  `@effect/platform-node-shared@4.0.0-rc.112` resolves this without package edits.
- A plain Node-target bundle reproduced the existing jsonc-parser UMD relative
  require failure (`Cannot find module './impl/format' from '/app'`). Retaining
  the existing published ESM entry selection resolves it. No new source transform.
- One initial headless probe accidentally reused exit-only `capture:true` with a
  live-output readiness gate and timed out. Corrected to live output, matching the
  existing diagnosis. Subsequent startup/auth/EOF checks passed on real workers.
- Generated contract additions are idle history messages, per-session permissions,
  session diffs and preferences. Used HTTP/SSE/tool/form contracts remain compatible;
  authoritative history and the generic transcript retain the new idle records.

## Verification

### Host and real-worker checks

- Chat package: complete suite **74 tests / 314 assertions passed** before the
  published-receipt refinement; focused final verifier/integration suite **12 tests /
  36 assertions passed**, including the added archive-provenance test.
- Chat and TODO typechecks/builds passed. TODO HTTP tests: **3 / 23 assertions**.
- Real guest server: version 2.0.3, authenticated HTTP 200, unauthenticated 401,
  upstream scope-completion marker, exit 0/null signal, no guest stderr or worker errors.
- **Actual beta-to-release SQLite migration:** seeded a session under unchanged
  beta-19425 (46 migrations), shut it down naturally, opened its disk snapshot under
  2.0.3. Upstream applied `20260910120000_clear_v1_session_permission` in 4 ms.
  The same session ID/title/project/location survived; release shutdown was natural
  exit 0. This is a headless schema/session test, not old-conversation OPFS migration.

### Real browser TODO flow

Browser Control CLI 0.7.0, session `cosmic-otter-081`, fresh origin
`http://127.0.0.1:54403/`; OPFS observed empty before opening.
Main run **`mu3bs824`**, cancellation run **`mu3c05tk`**.

| Check | Result |
| --- | --- |
| Default-closed UI and complete prepared-tree startup | PASS; 10,469 entries, preview and chat ready |
| Host-backed add/complete/delete | PASS; independent tRPC state checks |
| Manual source autosave/HMR | PASS; exact workspace bytes and same preview Document |
| Real Muse Spark read/edit | PASS; native tool IDs/inputs/timestamps, independent source and heading |
| Tool file navigation | PASS; editor bytes match workspace |
| Native multiline shell → Node | PASS; original five-line source hash/heading verification, exact marker, exit 0 |
| New Tailwind utility | PASS; `text-[37px]`, actual CSSOM rule, computed 37px, same Document |
| OpenCode close | PASS twice; exitCode 0, signal null, forced false, output drained |
| Vite close | Explicit SIGTERM/143, drained; not a natural-exit claim |
| Reopen persistence | PASS; complete edited source and prior conversation/tool records retained |
| Restoration | PASS; original source independently verified before final close |
| Startup cancellation | PASS; cancelled while busy, then runtime/workspace/services closed |

This run does not repeat the September 12 separate 13-request authorization or
network-laziness qualification. No authorization implementation changed. The
current source/chat persistence proof is same-page close/reopen, not page reload
or remote Git publication. CSS application was verified through CSSOM/computed
style; no new network-response capture is claimed for this run.

Evidence, including all pending observations and original provenance:
`vivari/.runtime/opencode-release-2.0.3/browser-acceptance/`. `summary.json` independently
checks required receipts, source restoration, shell exit/output, CSSOM, natural
shutdowns, cancellation and final build-output equality. A navigation/snapshot race
and a caller Chat-toggle mistake are recorded in `vivari/browser-control.todo.md`;
neither required restarting the relay or duplicating model submissions.
The final metadata-only smoke also retained guarded attempts to use the full-flow
retention/close phases without that new run's required model/closed baselines.
Those phases correctly refused; cleanup used the ordinary Exit UI and independently
checked the captured controller and service exits. They do not qualify page reload.

## Run

The assembled demo uses **http://127.0.0.1:54403/**. For preparation from the current
checkout, follow the toolkit package build/install steps in the TODO README, then:

```sh
cd browser-container-poc/todo-app-demo
bun --cwd ../vivari/experiments/opencode-release-server install --frozen-lockfile --linker isolated
bun run --cwd ../vivari/experiments/opencode-release-server build
export OPENCODE_PACKAGE_DIR="$PWD/../vivari/.runtime/opencode-release-2.0.3"
# Select the retained Tailwind PR receipt/hash as documented in this demo's README.
bun run prepare:editor
bun run build
LOCAL_EDITOR_ADMIN=1 PORT=54403 bun start
```

Existing prepared output needs only the last command. The exact qualified build
uses Bun 1.4.0 on macOS arm64 and the checked-in build layout. Different build
paths/toolchains/platforms may change bundle/native output hashes; such outputs
must be qualified before replacing exact artifact pins.
