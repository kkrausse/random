# Export the browser container POC into Browser Agent Toolkit

Status: planning for review. No repository creation, extraction, push, package
publication, or deployment is authorized by this document.

## Goal

Create a reusable **browser-agent-toolkit** repository under `kkrausse`.

Description: **Run agent harnesses in the browser.**

The first external consumer will be the sibling `irs-tools` repository. Fixes
discovered in integrations should go back into the toolkit rather than become
app-specific copies. Keep a small TODO example in the toolkit to reproduce and
exercise integration behavior.

## Agreed direction

- Separate source repository; no npm or GitHub Packages publishing for now.
- Consumers reference locally built packages from a neighboring checkout.
- No version bump or manual dependency update for each local toolkit edit.
- The consumer build rebuilds the toolkit first and consumes the fresh output.
- Development should watch toolkit source, rebuild its output, and notify the
  consumer dev server automatically.
- Preserve the `irs-tools` deployment model: build on the development MacBook,
  copy a self-contained deployment to AWS EC2, and run it there.
- A clean static proof-of-concept demo is desirable, with visitors supplying
  their own model credentials. It needs a feasibility check before deployment.
- Keep all work local for review until explicitly asked to create/push the repo.

## Proposed extraction scope

Audit these existing directories as the starting point:

| Current directory | Role in the new repository |
| --- | --- |
| `workspace-api/` | Workspace files/persistence, runtime execution, endpoints, preview, optional React integration, and asset delivery helpers |
| `opencode-chat/` | OpenCode preparation/launch integration, headless client, and optional chat/editor UI |
| `vivari/` | Required runtime build/preparation tooling and pinned inputs; audit which research tools are actually needed |
| `todo-app-demo/` | Reference consumer and candidate static demo |

The workspace layer is built on Vivari. OpenCode provides the agent loop; the
toolkit prepares its dependencies and launches the server inside the browser
workspace. Document the current custom packaging/runtime adaptations rather than
claiming arbitrary unmodified Node/Bun programs work.

Proposed approach: a clean initial snapshot, rather than importing all historical
commits. Confirm this during review. Retain the original history in `random` and
record the source commit used for extraction.

Keep historical status updates, acceptance receipts, handoffs, and unrelated
QEMU/hybrid/earlier demo experiments in `random`. Rewrite useful current setup
instructions as maintained documentation. Preserve licenses, notices, provenance,
and required source pins. Audit dependencies before omitting any directory;
historical demos or tools may currently supply build inputs.

Do not copy ignored runtime checkouts, caches, credentials, generated build output,
or untracked experiments into the source snapshot. Record how necessary generated
artifacts can be reproduced or obtained.

## Local package development

Target checkout layout:

```text
kkrausse/
  random/
  browser-agent-toolkit/
  irs-tools/
```

Exact package names and directory layout remain to be decided. Current public
names use `@kev-browser-agent-kit/*`; a repo rename alone does not require an
immediate package-name migration.

### Build freshness

The existing TODO README documents compiled sibling `file:` dependencies with
Bun's isolated linker and a forced reinstall after rebuilding packages. That is
the current behavior, not the desired automatic workflow.

Choose and verify local linking/resolution that consumes live build output, or
automate dependency refresh if Bun requires it. Do not assume `file:` dependencies
always remain live. Preserve a single compatible React instance and package export
boundaries.

The consumer build command should:

1. Locate the toolkit checkout with a documented default and override.
2. Build packages in dependency order.
3. Refresh local resolution automatically if necessary.
4. Prepare/copy matching runtime and application assets.
5. Build the consumer, failing if any prerequisite fails.

“Latest” means the current local checkout, including local edits. Builds should not
implicitly pull from GitHub. No package version bump should be necessary.

### Development loop

One dev command should start the toolkit build watchers and consumer dev server,
with an initial successful toolkit build before the consumer starts. Handle
watcher errors and process shutdown cleanly.

Configure consumer watching and dependency caching so changes to linked build
output are observed. UI/style changes should hot-update where supported; a full
page reload is acceptable where necessary. Generated CSS and declarations need
the appropriate build steps too.

Runtime workers, WASM, prepared dependencies, and workspace startup logic may
require asset rebuilding and/or restarting the running browser workspace. Document
these boundaries rather than promising hot replacement of a running runtime.

## IRS Tools integration and deployment

Inspect the real `irs-tools` scripts before selecting commands or changing them.
Integrate the toolkit prerequisite build into the existing local build/deploy flow.

The deployed artifact must contain all required frontend assets, runtime assets,
and server dependencies. It must not depend on MacBook paths, sibling checkout
symlinks, or dev-only package resolution. Preserve any target-platform dependency
handling already needed by EC2.

Verify an unpacked deployment outside the development checkout can start and serve
its assets. App API authorization and model credential handling in `irs-tools`
remain application responsibilities; the public demo's BYOK mode is a separate
consumer configuration.

## Static TODO proof of concept

Desired experience:

1. Open a static site, eventually on GitHub Pages.
2. See a working TODO app and clear proof-of-concept copy.
3. Supply a personal model API key and choose a supported model.
4. Start a browser workspace running OpenCode and the editable application.
5. Ask the agent to change the app and see the preview update.

Suggested copy: “Experimental: edit this TODO app with an agent running in your
browser. Bring your own model API key.” Explain that model inference happens at
the selected provider, while the workspace and harness execute in the browser.

### Provider feasibility

Start by testing OpenRouter with a pasted API key. Its documentation explicitly
describes browser-side API calls and an optional PKCE connection flow:
<https://openrouter.ai/docs/guides/overview/auth/oauth>.

PKCE can be a later UX improvement; it is not required for the first demo.
Anthropic direct browser access is another candidate, using its explicit browser
access header, but organization restrictions and the actual integration must be
tested. Do not promise every provider works cross-origin.

Verify a real streamed tool-using turn through the browser-hosted OpenCode server,
including its actual headers and provider configuration. A successful ordinary
fetch or CLI request is not sufficient. Browser-hosted execution does not bypass
CORS, and adding a header cannot enable a provider that disallows the origin.

Keep the visitor's key in memory by default and provide a disconnect/reset action
that removes it from the running integration. Avoid persisting it through workspace
snapshots, diagnostics, or logs. No shared maintainer credential in static assets.

### Static hosting work

The current TODO demo uses a Bun/tRPC host backend and server-side editing/model
routes; its existing frontend build is not a complete backend-free demo.

- Decide how to preserve the reference integration while adding a static mode.
- Give demo TODO data a browser-local implementation.
- Replace host model forwarding and editing bootstrap routes as needed for BYOK.
- Deliver runtime and prepared application assets as static files.
- Verify project-subpath URLs, service-worker scope, workers, WASM MIME types,
  preview routing, caching, and startup after a fresh load.
- Check runtime requirements for cross-origin isolation and response headers:
  GitHub Pages cannot supply arbitrary custom headers. Resolve this before
  selecting Pages as the deployment target.
- Measure artifact sizes/startup time and check Pages limits.
- Test editing, streaming, cancellation, restart, and source retention from the
  actual static origin. Keep ordinary TODO use available without entering a key.

No hosted demo has been qualified by this plan. Repo extraction and local consumer
integration need not wait for the static demo to be complete.

## README outline

- Project name, description, experimental status, and a short architecture overview.
- Workspace/Vivari responsibilities versus OpenCode integration responsibilities.
- Local checkout, prerequisite installation, package build, and example run steps.
- How another local repo consumes build output and gets automatic rebuilds.
- Runtime/prepared asset delivery and current compatibility limitations.
- TODO example, with static BYOK instructions once verified.
- Development checks, upstream runtime workflow, licenses, and provenance.

Prefer concise maintained documentation over copied chronological status reports.

## Execution milestones (after review)

- [ ] Review extraction scope, clean-snapshot approach, names, and target layout.
- [ ] Audit tracked build inputs, cross-directory paths, licenses, and runtime pins.
- [ ] Prepare and review the local extraction; prove clean-checkout setup works.
- [ ] Implement local build freshness and the watch/dev loop.
- [ ] Verify a toolkit change reaches the TODO consumer without manual reinstall
      or version bump, including a generated style change.
- [ ] Integrate with `irs-tools` and verify a self-contained deployment build.
- [ ] Qualify static BYOK feasibility, then implement the static TODO mode.
- [ ] Review README and demo copy.
- [ ] Create/push the GitHub repository only when explicitly requested.
- [ ] Deploy the static demo only when explicitly requested and qualified.

Package registry publication, release automation, and versioned distribution can
be revisited when an actual consumer needs them; they are not prerequisites now.
