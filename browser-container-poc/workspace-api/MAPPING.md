# Backend mapping (v0)

See [V0-HANDOFF.md](V0-HANDOFF.md) for tested status and continuation commands.

| Public code | Actual implementation |
| --- | --- |
| `workspace.ts` | Retains `Host`, kernel supervisor, single FS worker and OPFS lease; `/` maps to `/workspace` |
| `host.ts` | Explicit `distribution.json` + immutable kernel Worker; private RPC, listener map, SW HTTP relay |
| `execution.ts` | Explicit `/bin/node.js` frontend; real proc IDs; separate byte channels with shared in-flight byte credits |
| `runtime.ts` | One attachment; owns executions/launches/endpoints; stop retains Workspace and FS worker |
| `browser/endpoint.ts` | Listener incarnation plus generic guest Node HTTP relay process; real streaming response bytes |
| `browser/preview.ts` | Fresh iframe navigation and validated, attachment-namespaced WS/SSE forwarding |
| `tools/ripgrep/descriptor.ts` | Hash-verified existing package receipt; private JS entry and genuine WASM; typed callable method |

Durable backend changes live in the `kkrausse/vivari` fork, branch
`browser-runtime`, based on upstream `2629c71097238400c45aefa213ef61df4794c2b7`.
The canonical local checkout is a sibling of `random`; `VIVARI_SOURCE` can select
another checkout. See [runtime development](../vivari/DEVELOPMENT.md).
The old ignored `.runtime/patched` checkout is retained historical work, not the
active source. No workers in emitted distributions are hand-edited.
