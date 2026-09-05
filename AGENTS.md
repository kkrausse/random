# AGENTS.md

## Committing

Multiple agents work in this repo at the same time on different
projects. Scope every commit to only your own files:

```sh
git add <your-dirs-or-files> && git commit -m "..."
```

Never `add -A` / `commit -a`, and never stage or commit other paths. Keep
it fast; if a commit accidentally picks up someone else's changes, just
revert it.
