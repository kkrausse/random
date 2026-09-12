# Host package preparation preflight

## Result

**Locked host installation and exact WASM overrides PASS. Complete runtime tree
BLOCKED by Bun's handling of the published Oxide `wasm32` optional package.**

This is a direct host experiment, not a browser run or a promoted preparation
implementation. No application manifest, lockfile, runtime source, distribution,
or existing preparation output was changed. The previously stalled read-only
agent was interrupted successfully; this investigation used no subagents.

## Staging and installation

Copied the original TODO `package.json` and `bun.lock` into an isolated directory,
alongside the two compiled local toolkit packages at their original relative
paths. Used real host Bun 1.3.9, the version already documented for local `file:`
dependencies. Its ordinary `bun install --frozen-lockfile` completed successfully.

Read exact package versions from the source lockfile. This project has one version
of each mapped package; no version collapsing was necessary. Applied Bun's normal
root overrides in the staging manifest only:

```json
{
  "esbuild": "npm:esbuild-wasm@0.28.2",
  "rollup": "npm:@rollup/wasm-node@4.63.1",
  "lightningcss": "npm:lightningcss-wasm@1.32.0"
}
```

A subsequent normal host install succeeded. Comparing complete entries in the
original and derived lockfiles:

- Only `esbuild`, `rollup`, and `lightningcss` changed among retained entries.
- `lightningcss/napi-wasm` was added.
- Native platform dependencies of the replaced packages and `detect-libc` were
  removed from the derived lockfile.
- Installed manifests confirm the actual WASM package names and exact versions.
- All seven application scripts remain present. `.bin` contains 22 real relative
  symlinks, including Vite, React Router, esbuild, Rollup, and TypeScript.

This supports normal host installation with explicit, recorded backend selection;
it does not require a custom dependency resolver for this bounded graph. It does
not establish support for multiple versions of one aliased dependency or archive
metadata round-trip. A derived runtime lockfile is distinct from the original.

## Concrete blocker: Oxide is silently omitted

The original lockfile already includes
`@tailwindcss/oxide-wasm32-wasi@4.3.3`, with its registry integrity and bundled
dependency entries. Registry metadata declares `cpu: ["wasm32"]`. Bun serializes
that constraint as `cpu: "none"`.

Observed host commands:

1. `bun install --cpu wasm32 --os linux --frozen-lockfile` rejects `wasm32` as an
   invalid architecture. The printed supported list does not include it.
2. `bun install --cpu '*' --os linux --frozen-lockfile` exits zero, but the Oxide
   WASI package is absent from `node_modules`.
3. Explicitly declaring that exact package as a direct dependency in the staging
   manifest and running `bun install --cpu '*' --os linux` also exits zero and
   leaves the package absent. The derived lockfile still says `cpu: "none"`.

Neither lock metadata nor published package metadata was edited to bypass this.
No downloaded package sources were rewritten. The installation is therefore not
a complete browser-runtime artifact, despite successful installer exit codes.

This is separate from the already confirmed upstream Oxide incremental-scanning
bug: here the required backend never gets installed at all.

## Boundary and next decision

Do not implement or advertise `workspace/prepare` as a complete installer on the
basis of the successful three aliases. Host preparation additionally needs a
supported way to deliver architecture-filtered WASM backend packages.

The narrow candidate is explicit delivery of the unchanged, integrity-verified
backend archive, retaining its bundled dependencies and filesystem metadata.
That may reuse ordinary archive tooling rather than a second package resolver,
but dependency closure and reproducibility need verification first. Alternatively,
a host installer with working `wasm32` targeting could own the entire install.
Neither approach was silently selected or implemented in this run.

No public shim API or TODO preparation rewrite was committed while this boundary
remains unresolved. No browser workers, servers, or OPFS workspaces were opened.

## Evidence

Approved temporary directory:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/workspace-package-preflight.WoZjyT/
```

- `preflight.ts`: baseline install and exact override experiment.
- `baseline-install.json`: command, stdout, stderr, and zero exit.
- `override-install.json`: exact overrides, installer output, complete changed /
  added / removed lock entry lists, and installed package manifests.
- `final-observations.json`: absent Oxide backend despite direct dependency,
  exact lock entry, preserved scripts, and `.bin` symlink targets.
- `todo-app-demo/`: isolated staged manifest, derived lockfile, and installed tree.

The later CPU-selection and direct-dependency commands are recorded above; they
are not part of `preflight.ts`. Both repositories' original source trees and the
pre-existing untracked `vivari/scripts/probe-tailwind-direct.mjs` were preserved.
