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

## Committing

Scope commits to this directory only:

```sh
git add oc-plugin-session-manager/<files> && git commit -m "..."
```

Never `add -A` / `commit -a`.
