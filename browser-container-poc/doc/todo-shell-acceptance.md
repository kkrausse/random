# TODO built-in shell gate: multiline quoting failure and bounded source fix

September 12, 2026. **Actual browser shell gate FAIL (exit 127); bounded runtime
source fix and native/guest-worker parity checks PASS.** The corrected source has
not been packaged into a distribution or rerun through the model-facing browser
gate by this task. Parent browser ownership remains exclusive.

## Authoritative failure

Receipt:

```text
/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/todo-editor-clean-acceptance.d1vGpL/final-pr/mty0l5ta-016-shell-verify.json
```

- Receipt SHA-256: `c8e45f182556ba0b7e643ace42d83c65e5c0de829d2539c1422bed8464d9fd3d`.
- Exact command SHA-256: `222b75d90084945e2ca648c52369b2337d40dcd0f21e6f803669943ae7d83023`.
- Native local tool: `shell`, `executed:false`, tool ID
  `call_01a0945b2bcf7270a08a467e67edcb91`, completed with numeric metadata
  `{status:'completed', truncated:false, exit:127}`.
- The tool's first content block is the real combined process capture; its second
  says `Command exited with code 127.` This is not model prose or a timeout inferred
  from UI state.

The command was the exact five-line argument supplied by the gate:

```sh
node -e 'const bytes = require("node:fs").readFileSync("/workspace/src/home.tsx");
const hash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
if (hash !== "da3a0e4747c486ce85527194709cccd26c8f760cea109da4e5e37196040f993e") throw new Error("Source SHA-256 mismatch");
if (!bytes.toString("utf8").includes("<h1>Todos model mty0l5ta</h1>")) throw new Error("Source heading mismatch");
process.stdout.write("editor-shell-mty0l5ta\n");'
```

Its actual capture was:

```text
sh: const: not found
sh: if: not found
sh: if: not found
sh: process.stdout.write(editor-shell-mty0l5ta\n): not found
sh: : not found
```

## Concrete cause and scope

The retained unchanged beta-19425 source was inspected:

- `packages/core/src/shell.ts:248–301` preserves the input command, resolves the
  shell, obtains its arguments, and spawns it through the Environment service.
  It captures actual process output and status; stdin is ignored for this
  non-interactive command.
- `shell/select.ts:163–168` passes ordinary Unix shells `['-c', command]`.
- `tool/plugin/shell.ts` constructs content and metadata from `ShellResult`.

The runtime's `packages/kernel-host/coreutils.js` already has a quote-aware lexer,
but `runBatch()` first did:

```js
for (const raw of script.split('\n')) {
  const line = raw.replace(/#.*$/, '').trim();
  if (line) status = await runLine(line);
}
```

Thus quote context was destroyed before lexing: the first JavaScript line could
reach `node -e`, while later JavaScript statements were treated as separate shell
commands. The comment regex also incorrectly stripped literal `#` inside quoted
arguments. The observed failure does not require native PTY support, a Node-tool
replacement, or full POSIX shell implementation. It is a lexical-boundary bug in
an already supported command form.

## Bounded reusable fix

Runtime fork commit **`33305d5`**, on top of the native-realpath fix:

- The existing lexer identifies unquoted/unescaped batch newline boundaries.
  Batch execution slices raw commands at those boundaries, preserving the
  existing background-command ownership path.
- Quoted newlines remain argument bytes. Comments start only at unquoted word
  boundaries; embedded/quoted `#` remains literal.
- Backslash escaping respects single/double/unquoted contexts, including literal
  single quotes assembled with `'\''` and escaped newline continuation.
- Empty quoted arguments survive. Comment-only trailing lines preserve the
  preceding command's exit code. Unterminated quotes produce an explicit syntax
  failure instead of running silently truncated arguments.

This changes the runtime's own ordinary shell source, not application or package
bytes. The shell remains the documented minimal subset: variable expansion,
command substitution, general globbing, compound/control-flow syntax and full
POSIX grammar are not added or claimed. JavaScript `if` inside a quoted `node -e`
argument is child-process input, not unsupported shell control flow.

## Checks and limits of the result

New independent fork fixture:
`scripts/fixtures/runtime-contracts/shell-quoting.cjs`.

It creates its own source file, computes its expected hash, and executes the same
five-line source-read/hash/heading/marker command shape through **both** `sh -c`
and an ordinary script file. Both require exact marker output, empty stderr,
numeric exit 0 and no signal. Additional native parity cases cover single/double
quoted newlines, escaped quotes, literal backslashes, continuation, empty args,
quoted/comment `#`, quoted operators, sequencing/and-or, pipes, redirects,
comment-only trailing lines, and malformed quotes.

Commands run from the runtime fork with the explicit native executable:

```sh
/Users/kkrausse/.bun/install/cache/node-bin-darwin-arm64@24.18.0@@@1/bin/node scripts/fixtures/runtime-contracts/shell-quoting.cjs
/Users/kkrausse/.bun/install/cache/node-bin-darwin-arm64@24.18.0@@@1/bin/node scripts/verify-runtime-contracts.mjs
```

Results: native `/bin/sh` + Node 24.18.0 **SHELL_QUOTING_PASS**, and **all 15 real
guest-worker runtime contracts PASS**. No shared runtime build, package rebuild,
preparation, live artifact, or browser operation was performed. The independent
fixture is regression evidence for the quoting fix, not a substitute for the
exact model-facing acceptance gate.

## Parent decision and next gate

The sustainable next step is an explicit runtime candidate rebuild containing
`33305d5`, followed by preparation against its new runtime identity and a genuine
rerun of the built-in shell gate. Preserve the multiline command and require the
native primary capture plus numeric metadata exit 0; do not flatten the command,
replace the tool, or skip the source/hash checks. Bind any rerun's expected source
hash to independently read current workspace bytes, as the existing harness does.

Parent remains free to finish CSS/retention on exact runtime `0f0f9bc…` before
adopting the source fix. A future dedicated Node tool is a separate product/API
decision and would not close this existing built-in shell acceptance gate.
