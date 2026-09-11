# Runtime development

## Source of truth

Runtime repository: <https://github.com/kkrausse/vivari/tree/browser-runtime>.
Edit normal source files there and commit normally. The fork retains upstream
history, with `upstream` pointing at `maitrungduc1410/vivari`.

Default layout:

```text
kkrausse/
  random/                    # embedding, OpenCode packaging, browser acceptance
    browser-container-poc/
      vivari/                # integration scripts, not the runtime source
      workspace-api/
      opencode-chat/
  vivari/                    # editable runtime fork, branch browser-runtime
```

`VIVARI_SOURCE=/absolute/path/to/vivari` selects another checkout for host builds,
tests, and Vite source aliases. Do not edit the old `.runtime/patched` checkout or
export a new `0001-sqlite.patch`. Old handoffs mentioning that workflow are
historical. Source migration provenance lives in the fork's `FORK.md`.

## Setup

Clone the fork as a sibling of `random`:

```sh
git clone --branch browser-runtime https://github.com/kkrausse/vivari.git
git -C vivari remote add upstream https://github.com/maitrungduc1410/vivari.git
```

Use Bun and the qualified native toolchain: Rust 1.93.0 with
`wasm32-unknown-unknown` and `wasm32-wasip1`, wasm-pack 0.13.1. Use Node 24.18.0
for the qualified headless checks. The build does not install the Rust toolchain.

From `random/browser-container-poc/vivari`:

```sh
bun run setup
bun scripts/build-runtime.ts
```

The build installs frozen fork dependencies, builds native artifacts when their
inputs change, and builds the SDK/workers. Normal working-tree edits are allowed.
There is no clone/reset/reapply cycle during ordinary development.

## Edit → build → check

1. Edit the fork's `packages/runtime`, `packages/kernel-host`, `packages/protocol`,
   or `packages/core`, following its AGENTS.md and ARCHITECTURE.md.
2. From this integration directory, run `bun scripts/build-runtime.ts`.
   Use `--native` to force rebuilding the native artifacts.
3. Run the relevant focused contract from the fork:

   ```sh
   node scripts/verify-runtime-contracts.mjs vm-import
   node scripts/verify-runtime-contracts.mjs
   bun run verify
   ```

4. Package the workspace distribution from `browser-container-poc`:

   ```sh
   bun workspace-api/scripts/distribution.ts
   ```

5. Run the affected workspace/browser qualification and commit your own files
   in each repository. Do not count an import or zero exit as server acceptance.

For fast JS-only iteration once native artifacts exist, `bun run build:core` in
the fork rebuilds the SDK. Use the integration build before distribution
packaging so hashes, provenance, and retained assets are updated together.

## Reproducible builds and receipts

`bun scripts/build-runtime.ts --release` requires committed source. Check out an
exact fork commit when reproducing a release; a moving branch name is not a pin.
The shared source configuration records the qualified revision for setup and
qualification. Intentional upgrades update that pin after verification.

Receipts retain the compatibility filename `.runtime/patched-build.json`, but
record fork source provenance instead of patch hashes. Development provenance
includes dirty-state information; release provenance identifies a clean commit.
Workspace distribution packaging verifies emitted asset hashes against the
receipt and carries that receipt forward.

Build caches and retained immutable assets stay separate from editable source.
Running kernels may still need old hashed worker URLs: do not delete retained
assets during a normal rebuild. Restart/reload to adopt the new runtime.

## Adding tools

Keep the distinction between two extension surfaces:

- A model-facing OpenCode tool uses the pinned server's supported extension
  surface and lifecycle. This is part of the server cleanup milestone.
- A host-bound workspace helper uses `ToolDescriptor` and the existing
  `ToolContext`, independently of OpenCode's model-facing registry.

For example, this complete host-bound descriptor reads through the existing
runtime filesystem without adding a kernel opcode:

```ts
import type { ToolDescriptor } from '@kev-browser-agent-kit/workspace';

export const fileSize: ToolDescriptor<{ path: string }, number> = {
  name: 'file-size',
  version: '1',
  async bind(context) {
    return async ({ path }) => (await context.readFile(path)).byteLength;
  },
};
```

Register it with `Runtime.start({ distribution, workspace, tools: { fileSize } })`,
then call `runtime.tools.fileSize({ path: '/workspace/example.txt' })`.
`ToolContext` uses runtime-absolute paths, whereas public `workspace.fs` paths are
relative to the workspace mount (starting with `/`). This example reads the
whole file; use a future stat capability for a production large-file size tool.

For process-backed tools, use `context.node({ entry, args, cwd, env, signal })`;
drain stdout and stderr concurrently, close unused stdin, inspect the exit
result, and stop owned execution in cleanup. The existing
`workspace-api/src/tools/ripgrep/descriptor.ts` demonstrates asset delivery,
structured argv, result parsing, cancellation, and bounded output.

The current transport's overflow limits are not full backpressure. New tool
examples must not claim otherwise. JS/WASM package-backed tools should declare
and deliver their assets; adding a supported tool should not require a runtime
fork edit or a bespoke HTTP adapter.

## Active scope and historical experiments

Follow [the server cleanup plan](../doc/opencode2-server-runtime-cleanup.md).
This migration establishes the fork workflow. Server-only packaging, the HTTP
bridge, and the JavaScript-first OpenCode tool profile remain subsequent tasks.

The OpenTUI and OpenCode TUI-only patches remain historical experiment inputs.
The cumulative runtime patch has been retired after fork build/contract qualification.
Other experiments and old runtime checkouts are preserved.
