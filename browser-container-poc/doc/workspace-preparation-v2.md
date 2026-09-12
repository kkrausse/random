# Metadata-preserving host preparation v2

September 11, 2026. **Host preparation PASS; combined browser acceptance belongs
to the subsequent OpenCode integration checkpoint.** The previously escalated
preparation contract changes are now authorized and implemented.

## Installation and backend policy

`prepareBrowserEditor` stages the original `package.json`, `bun.lock`, explicitly
allowed source, and declared relative `file:` package inputs in a private temporary
tree. It runs ordinary Bun installation with the **isolated linker**:

1. `bun install --linker isolated --frozen-lockfile` against original inputs.
2. Select exact locked backend versions using the runtime-owned lockstep policy;
   add normal root overrides to the derived staging manifest and run Bun install.
3. Verify the derived Oxide tarball entry retains the original lock's SHA-512.
4. Remove the staging `node_modules` and frozen-install the derived graph using a
   separate fresh cache. Verify the derived lock bytes did not change, all required
   direct project dependencies exist, and all selected backend package identities
   and WASM payloads exist before export.

The successful host is Bun **1.4.0 (34cbb9a40)**. The isolated linker is important:
the default hoisted linker rejects this project's existing
`file:../workspace-api/dist/lib` reference as an unsafe folder path, even with a
fresh cache. The supported isolated linker succeeds without changing either local
package's manifest or its relative dependency references.

Bun **1.3.9 is insufficient for this integrity contract**. It installs the exact
Oxide tarball but omits archive integrity from the derived lock. This distinction
was missed in the prior preflight's summary: its full-graph 1.3.9 evidence actually
has no Oxide tarball SHA-512, while its minimal 1.4.0 evidence does. The new
preparer rejects that result rather than claiming reproducibility.

Verified derived overrides:

```json
{
  "esbuild": "npm:esbuild-wasm@0.28.2",
  "rollup": "npm:@rollup/wasm-node@4.63.1",
  "lightningcss": "npm:lightningcss-wasm@1.32.0",
  "@tailwindcss/oxide-wasm32-wasi": "https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.3.tgz"
}
```

No custom resolver, archive installer, registry metadata rewrite, or package-source
transform is involved. Bun's normal lifecycle/trusted-dependency policy applies;
installation does not use `--ignore-scripts`. Project scripts, declared dependencies,
dev dependencies, full compiled local toolkit packages, nested versions, package
bins, and host-selected optional native package files are retained. Normal platform
filtering still applies to optional native packages; the explicitly required WASM
backend is separately asserted.

`workspace-api/scripts/distribution.ts` now copies the unchanged runtime
`toolchain-shims.js` as `backend-policy.mjs`, after matching its hash to the build
receipt's source file entry. Public `readRuntimeBackendPolicy(directory)` verifies
that receipt binding and reads `NATIVE_WASM_ALIASES` from the verified bytes.
Consumers need no editable runtime checkout. `copyRuntimeAssets` carries the policy
with the distribution. Packaging existing receipted output retained runtime version
`098e0b60a0ff8703994ea681d9c974ae9267bfe5dbdd799e87ff00982ff938a3`;
worker bundles were not rebuilt.

## Versioned delivery

`browser-editor-v2` assets distinguish regular files (content hash, length and
permission mode), directories (including empty ones and modes), and symbolic links
(original relative targets). `.bin` and the isolated `.bun` tree are retained.
The walker never dereferences package links; special files and dangling/escaping
links fail. Validation also rejects duplicate/noncanonical paths, cycles,
write-through-link parents, missing directory parents, and root escapes. Modes
preserve ordinary permission bits (`0777`), not setuid/setgid/sticky flags.

The guest installer uses the existing public `ToolContext.installFile` and
`ToolContext.node` APIs plus supported Node filesystem operations. It resets the
owned package/application roots, creates directories, delivers hash-verified file
bytes, then creates symlinks and applies modes. Content-addressed installer scripts
respect `installFile`'s immutable-file contract. Both guest phases must exit cleanly
**and emit their completion checkpoint**. Host round-trip tests execute these exact
generated filesystem programs against real files with only guest-root mapping.
Actual browser execution remains for the combined integration qualification.

The original manifest and lock are seeded byte-for-byte as `/package.json` and
`/bun.lock`. Derived inputs are visible at `/.browser-editor/runtime-package.json`
and `/.browser-editor/runtime-bun.lock`. Manifest `dependencies` records original
and derived bytes/hashes, installer/linker, runtime policy/hash, exact overrides,
backend presence assertions, and every changed/added/removed lock entry. The runtime
tree is the derived installation, not an assertion that an ordinary guest reinstall
of the original lock is equivalent. Existing source is still seed-if-missing; use
a clean workspace for the next acceptance run so old reduced project metadata does
not mask the new contract. v1 manifests are rejected with a regenerate instruction.

Bounded constraints: Bun text lockfile v1, a single application rather than a
workspace root, relative local `file:` inputs, and one locked version per replaced
backend. Conflicting existing overrides, ambiguous backend versions, and Oxide
versions other than the demonstrated 4.3.3 fail explicitly. Source delivery remains
the caller's text-source allowlist; required lifecycle inputs must be included.

## Verified checkpoint

Commands, run in package directories:

```sh
# workspace-api
bun run build
bun run distribution
bun run typecheck
bun test tests/*.test.ts

# opencode-chat (after workspace build completes)
bun run typecheck
bun run build
bun test
bun scripts/verify-preparation.ts
```

- Full TODO graph checkpoint: **PASS**, including original input hashes, scripts,
  all direct dependencies, full toolkit editor export, bin links, WASM payloads,
  original/derived Oxide integrity equality, and complete tree validation.
- Original TODO lock SHA-256:
  `3ccd16d5559b7eeeb603640d6ad6cd881bd345d06cd77c259b31051ac9987bba`.
- Derived runtime lock SHA-256:
  `051ff8cd9177197bdc2e8046b64caaadbf3338b08b910bc85c0091188b479d32`.
- Only retained entries `esbuild`, `rollup`, `lightningcss`, and
  `@tailwindcss/oxide-wasm32-wasi` changed. `lightningcss/napi-wasm` was added;
  replaced native backends and `detect-libc` were removed. Full deltas are recorded
  by the verification script and prepared provenance.
- Captured dependency tree after local package build: **8,829 files, 1,115
  directories, 490 symlinks**. Counts include concurrent candidate-library outputs
  already present in the compiled local package, and will vary with package builds.
- Full `prepareBrowserEditor` wrapper in a disposable output: **PASS**, v2 manifest,
  10,467 tree entries and 21 source/provenance files; original project bytes exact.
  This wrapper check deliberately used the previous application receipt because
  candidate application delivery is owned by the parent integration task.
- Package tests at this checkpoint: opencode-chat **58 passed / 244 assertions**
  (including concurrent candidate work); workspace-api **9 passed / 36 assertions**.
  Six new preparation tests cover metadata round-trip, bin-relative module
  resolution, invalid links, exact backend selection, immutable installer paths,
  guest completion markers and corrupted payload rejection. One workspace test
  covers runtime policy provenance and copying.

All temporary install/export directories were removed. Existing TODO preparation,
runtime worker bytes, immutable candidate outputs, application source/lock, and the
pre-existing untracked Tailwind probe were preserved.

Final full-graph command output is retained at
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/workspace-preparation-v2-check.log`.

## Parent integration handoff

`recipe.ts` is untouched by this preparation work. Parent should replace only the
old receipt/application-delivery section in `prepare.ts` using the independently
verified candidate module, add its descriptor/provenance to `PreparedManifest`, and
wire the candidate launch/config into the recipe. Tree v2 already admits `/app`
alongside the old `/opencode-v2` root and generates parent directories for either.
The package-tree metadata machinery needs no launch-specific change.

Rebuild/reinstall the combined local packages, regenerate preparation using Bun
1.4.0, then perform clean-workspace browser acceptance. Specifically verify guest
symlink/mode installation checkpoints and isolated package resolution before the
preview/chat/model/shell/CRUD/retention checks. The separate upstream Oxide
incremental CSS scanning issue remains the Tailwind investigation's scope.
