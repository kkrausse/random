# AGENTS.md

## Publishing files for phone viewing

When the user asks "publish this as a private artifact", "publish this publicly",
or simply "publish this", use the commands below and return the printed clickable
URL. Default to private unless the user explicitly requests public access.

Private shelf: https://raspberrypi.tail7e28fb.ts.net/ (requires Tailscale connected).

- HTML directory (must contain `index.html`): `scripts/deploy-artifact.sh /absolute/path/to/artifact optional-slug`
- Any single file: `scripts/deploy-artifact.sh /absolute/path/to/file optional-slug`
- PDF converted to a mobile-readable page: `scripts/publish-pdf-artifact.sh /absolute/path/to/file.pdf optional-slug`
- Public publishing: add `--public` before the input in either command.
- Remove only the requested private artifact: `scripts/deploy-artifact.sh --remove slug`.
- The index sorts by last successful publish time, newest first; republishing bumps an item.
- Private files live in `/srv/private-artifacts`, never the public `/var/www/html` tree.
- Do not use Tailscale Funnel for private artifacts. Existing public copies remain public;
  publishing privately does not remove them.

`scripts/` is a separate Git repository; commit its changes there.

## Committing

Multiple agents work in this repo at the same time on different
projects. Scope every commit to only your own files:

```sh
git add <your-dirs-or-files> && git commit -m "..."
```

Never `add -A` / `commit -a`, and never stage or commit other paths. Keep
it fast; if a commit accidentally picks up someone else's changes, just
revert it.
