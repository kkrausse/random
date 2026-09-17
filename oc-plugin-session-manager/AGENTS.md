# AGENTS.md — oc-plugin-session-manager

## Refresh the plugin

Path-loaded via `~/.config/opencode/cli.json`. No build step.

1. Quit the TUI, then `opencode2`
2. Open the picker with `alt+s` to verify

## Verify

Run in this directory:

```sh
bun install   # only when deps change
bun run check
bun test --preload @opentui/solid/preload
```

After changing OpenCode API calls or updating dependencies, also run the read-only
installed-service check with an accessible project directory:

```sh
bun run check:api /path/to/project
```

Attention calls belong in `src/attention-api.ts`. Prefer the documented host TUI
data caches for badges/previews. A missing or failed lookup must remain visibly
unavailable, never become an empty list or a Ready/Inactive status.

## Committing

Scope commits to this directory only:

```sh
git add oc-plugin-session-manager/<files> && git commit -m "..."
```

Never `add -A` / `commit -a`.
