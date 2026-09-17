# Model proxy: provider routes and Zen 403 resolution

Checkpoint: 2026-09-17 UTC (2026-09-16 local). Consumer checkout:
`browser-agent-toolkit-upstream`, branch `integration/upstream-runtime`.
This supersedes the model-blocked conclusion in the Vivari integration handoff;
it does not complete the remaining runtime migration qualification.

## Root cause, measured

The pinned, unchanged OpenCode 2.0.3 `ServerProcess` constructs these headers:

- `User-Agent: opencode/stable/2.0.3/vivari-opencode-server`
- `x-opencode-client: vivari-opencode-server`
- `x-opencode-session: <actual guest session ID>`

The real browser request reaching `/editor/model/responses` retained the
OpenCode session/client/project headers, but its user agent was Chrome's
`Mozilla/5.0 ... Chrome/152.0.0.0 ...`. The host proxy forwarded it unchanged.
Chromium replaces the guest's user agent during browser fetch.

A controlled direct Zen Responses comparison used the same approved local Zen
key, model (`muse-spark-1.3-contributor-free`), request body, session/project/client
headers, and endpoint. Only `User-Agent` differed:

| User agent | Result |
| --- | --- |
| Actual browser UA | HTTP 403, `FreeTierError`, “OpenCode's free tier can only be used from within OpenCode” |
| Actual pinned OpenCode application UA | HTTP 200, no provider error |

The direct probe requested only 16 output tokens and returned no output text;
its 200 alone was not counted as successful model output. Actual chat below
provided the inference proof. No fabricated session/client identity was needed.
The earlier direct POST without equivalent application metadata was therefore
not sufficient to attribute this to account eligibility.

## Implementation

- Generalized `createBrowserEditorHandler` from one `model` upstream to a
  server-only `providers` map. Public paths are now
  `/editor/model/<providerID>/<native path>`; the recipe uses
  `/editor/model/opencode/` as OpenCode's provider `settings.baseURL`.
- Only `opencode` is configured in the TODO host. Its upstream is
  `https://opencode.ai/zen/v1`. The path/query and opaque request/response streams
  retain provider-native semantics. Unknown provider IDs return 404.
- The host's `opencode` route restores the **actual pinned application's** UA
  through its configured headers. Version/channel/name must track
  `vivari/experiments/opencode-release-server/server.ts` when upgrading.
- Server credentials remain in the host process environment. The host reads the
  previously authorized local `opencode` API credential through a Bun parent;
  no key is printed, persisted into project/browser state, or put in diagnostics.
- OpenCode's explicit Muse definition remains: this model was absent from the
  pinned catalog. No OpenCode bundle or runtime bytes were rewritten.

## Actual browser results

Same isolated origin `http://127.0.0.1:19437/`, Browser Control session
`brisk-comet-900`, retained OPFS and conversations:

1. Before the fix, a fresh real UI request reproduced 403 with the session header
   present and Chrome UA visible at the host boundary.
2. Built the toolkit and TODO consumer, exited the editor, restarted the host,
   reloaded the same origin, and reopened the retained workspace.
3. Requests now went to `/editor/model/opencode/responses` and returned HTTP 200.
   The retained conversation `ses_f52f2cf7fffe1w3GPKvVOh1c35` picked up its earlier
   heading-verification task. Incremental UI output and model-selected `glob`,
   `grep`, three `read` calls, and `shell` completed. The model correctly found
   the heading already changed by earlier diagnostics and did not edit it.
   Its shell command `node /workspace/integration-19437.cjs` reported
   `INTEGRATION_19437_OK`, exit 0; the UI recorded `outcome: succeeded`.
4. A fresh conversation `ses_f52d967a0ffeB2GRLVKZyd5oDx` returned exactly
   `PROXY_OK` with `outcome: succeeded`, verifying ordinary chat independently
   of the old failed task. The first immediate send after New chat raced chat
   readiness; dismissing the app error and sending after creation completed
   succeeded (see browser-control todo).

The model-selected edit/HMR gate, post-success restart/reload acceptance, and
broader runtime regressions from the handoff remain outstanding. The old
independent diagnostic heading edit is not relabeled as a model edit.

## Checks and continuation

- Targeted proxy/launch/integration tests: 12 pass, 1 conditional retained-artifact
  test skipped, 69 assertions. Proxy tests exercise two independently configured
  upstream prefixes/auth policies, native query/body/header forwarding, server
  UA restoration, and rejection of unknown/inherited provider keys.
- Toolkit typecheck/build and TODO consumer typecheck/build passed.
- Host was restarted as PID **7037**, port **19437**, launcher
  `sh_0ad24afc70010vB1xhWmwFE5d1`. Recheck liveness before using this PID.
- Browser remains open on the successful fresh chat. No runtime pin promotion.

Safe evidence under
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/`:

- `zen-identity-probe.ts` (loads credentials privately; no embedded key)
- `model-proxy-browser-success.json` (allowlisted request identity headers,
  HTTP statuses, final conversation and preview heading)
- `model-proxy-fresh-chat.json` (fresh successful reply)
- `start-proxy-investigation-host.ts` and `model-proxy-host-19437.log`

Browser automation used the Bun-backed CLI only; no relay reset was needed.
