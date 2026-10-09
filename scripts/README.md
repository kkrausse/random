# Workspace scripts

These scripts use [Bun](https://bun.sh/). Install dependencies with `bun install` from this directory.

Local audio transcription: `./transcribe-local/transcribe-local /path/to/audio.mp3`

## YouTube video to narrated explainer film

Two scripts cover the path from a YouTube link to a published
[psychopomp](https://github.com/kitlangton/psychopomp) film.

```sh
./yt-transcript.ts 'https://www.youtube.com/watch?v=INgvg03agP8'      # prints the transcript path
./psychopomp-film.sh                                                   # list buildable scenes
./psychopomp-film.sh gromen-inflate --voice --stills                   # quick check: voice + one PNG per cue
./psychopomp-film.sh gromen-inflate --voice --publish --tunnel         # render and publish on the opentunnel shelf
```

`yt-transcript.ts` pulls YouTube's captions through `uvx yt-dlp` (no install, no
audio download) and writes a timestamped text file, by default to
`output/transcripts/<video-id>.txt`. It prefers the `en-orig` track; the plain
`en` track is sometimes a re-translation with words run together.

`psychopomp-film.sh <scene> [flags]` runs `scenes/<scene>/build.sh` from the
permanent psychopomp checkout at `~/devfs/repos/kitlangton/psychopomp`, looking
through its git worktrees as well, with one shared cargo build cache. The flags
are the scene's own: `--voice`, `--stills`, `--publish`, and with `--publish`
one of `--tunnel` or `--public` (private Tailscale shelf otherwise).

The step in between is writing: read the transcript, write a short narration
in your own words (about ten lines, 75 to 90 seconds) into
`scenes/<scene>/narration/script.json`, and draw the diagram in
`scenes/<scene>/src/main.rs` with every beat keyed to a cue id. Start a new
film by copying `scenes/gromen-inflate/` on a new worktree branch.
`../psychopomp-scripts/README.md` records where each film lives and
`../tts-lab/PLAYBOOK.md` has the rules that keep an edit-to-published cycle at
about ten minutes.

## PDF to responsive web page

### Convert and publish in one command

For the usual workflow, pass the downloaded PDF to the wrapper. It converts the PDF, verifies that `index.html` was created, deploys the artifact, and updates the artifact listing:

```sh
./publish-pdf-artifact.sh ~/Downloads/tree-rings-8-28-26.pdf
```

Publishing is **private by default**. Connect Tailscale on your phone to open the link.
The PDF filename becomes the URL slug. The example above publishes to:

```text
https://<pi-hostname>.<tailnet>.ts.net/artifacts/tree-rings-8-28-26/
```

Pass a second argument to override the slug:

```sh
./publish-pdf-artifact.sh ~/Downloads/report.pdf custom-report-slug
```

For deliberately public publishing, put `--public` first:

```sh
./publish-pdf-artifact.sh --public ~/Downloads/report.pdf custom-report-slug
```

This publishes to `https://kkrausse.com/artifacts/custom-report-slug/`.

### Convert only

```sh
bun pdf:web path/to/document.pdf
```

The default output is `scripts/output/<document-name>/index.html`. Pass a second path to choose another directory:

```sh
bun pdf:web path/to/document.pdf path/to/output
```

The converter works locally and does not call an LLM or external service. It reflows selectable prose into a narrow, responsive article, preserves inline emphasis and links, and uses every embedded image's bounding box to crop the fully rendered PDF page. This preserves arrows, circles, text labels, masks, and other overlays within those boundaries. Text spans entirely inside a figure are omitted from reflowed HTML to avoid duplicating labels. Crops use 144 DPI and lossless PNG by default (`--dpi 180` increases figure resolution); identical rendered crops share one asset. Wide, shallow top-margin banners are treated as decorative document chrome and omitted. Numbered lists use sequential numbering and indentation; `(Page N)` references become navigation links.

Every conversion includes a link to the original PDF. Full-page images are **not saved or embedded by default** (pages are rendered in memory to produce figure crops). Graphics extending outside image boundaries and standalone vector-only charts are not captured by those crops; visible notices link to the relevant page in the original PDF. Vector detection is deliberately conservative: decorations and rules can trigger it too. Use the original PDF for full fidelity and layout. Scanned PDFs still need separate OCR for reflowed text.

Page-sized background images behind substantial selectable prose are skipped, with a visible notice, to avoid turning the article into full-page screenshots. The heuristic requires over 70% page coverage, at least 500 text characters, and over 80% of that text inside the image. The prose remains HTML.

Figure filenames contain a content hash so republishing a changed crop cannot reuse a browser's cached unannotated image.

`conversion-report.json` records image counts and notices per page; the same notices appear in the conversion log and HTML. If explicitly wanted, add `--full-pages` to include collapsed original-page images (JPEG, 144 DPI), and `--dpi 180` to increase their resolution. Both flags work through the publishing wrapper:

```sh
./publish-pdf-artifact.sh ~/Downloads/report.pdf report --full-pages --dpi 180
```

The wrapper converts into a temporary directory before replacing the generated output, so republishing removes stale image assets.

## Raspberry Pi site

Deploy the homepage at `kkrausse.com`:

```sh
./deploy-site.sh
```

The public site uses the shared dark, monospace theme in `site/theme.css`.
Homepage, public-artifact, mortgage-calculator, and timegrapher deployments
refresh it automatically. To update only the theme, run `bash deploy-theme.sh`.
The theme adds a stylesheet link to published HTML, preserving its content,
media, and timestamps; source artifact files and private pages are unchanged.

Deploy any generated web artifact **privately** under `/artifacts/<directory-name>/`:

```sh
./deploy-artifact.sh output/tree-rings-8-14-26
```

The artifact can be **any file or folder**; HTML is not required. Single files
return a direct link to the original file. Folders without `index.html` get
generated file listings (including nested folders), without modifying the source.
Existing HTML content is preserved (public copies receive the shared theme). Browsers preview supported formats and download
others. An optional second argument overrides its URL
slug. Single files with spaces in their names need an explicit valid slug.
Each deployment prints the final URL and rebuilds the artifact index, **newest
published first**. Republishing bumps an item to the top, independently of source
file mtimes. Older artifacts without a publish marker fall back to `index.html`
mtime. Published dates are displayed in UTC.

```sh
./deploy-artifact.sh ~/Downloads/photo.png photo
./deploy-artifact.sh --public output/report
```

Private shelf: `https://<pi-hostname>.<tailnet>.ts.net/`.
Public shelf: <https://kkrausse.com/artifacts/>.
Tunnel shelf: <https://zu4tgfuxau5n.opentunnel.xyz/artifacts/> (served from diesel2, set up 2026-10-08).

`--tunnel` publishes to a third shelf that is served from this machine (not
the Pi) through [opentunnel](https://opentunnel.xyz). TLS terminates here, so
the relay in front cannot read the traffic:

```bash
./deploy-artifact.sh --tunnel output/report
./deploy-artifact.sh --tunnel --remove report
```

Run `./setup-opentunnel.sh` once first. It installs the `opentunnel` CLI,
starts `tunnel-server.ts` as the `tunnel-artifacts` systemd user service
(loopback only, serving just `~/devfs/tunnel-artifacts/artifacts/`), and routes
the tunnel hostname to it. Links only work while this machine is up. The
hostname is public (it appears in certificate transparency logs), the shelf has
a listing at `/artifacts/`, and the hostname is lost for good if the tunnel is
deleted.

Remove a deployed artifact and update the listing with:

```sh
./deploy-artifact.sh --remove tree-rings-8-14-26
```

Use `--public --remove <slug>` to remove a public artifact instead. Private and
public copies are independent; publishing privately does not remove a public copy.

### Server configuration

Private artifacts live in `/srv/private-artifacts/artifacts`, **outside** the
public web root. On the Pi, Tailscale Serve serves `/srv/private-artifacts` over
HTTPS, only to allowed tailnet users/devices. It runs persistently across reboot:

```sh
sudo mkdir -p /srv/private-artifacts/artifacts
sudo tailscale serve --bg /srv/private-artifacts
tailscale serve status
```

Do not run Funnel on this endpoint. Before changing Serve settings, inspect
existing configuration rather than replacing unrelated services. If a local web
server is needed later, bind it to `127.0.0.1` and proxy through Serve.

Scripts require Bash, SSH, rsync, and Python 3 (locally and on the Pi); PDF
conversion also requires Bun and the installed package dependencies.
The SSH user needs passwordless sudo for deployment.

Overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEPLOY_HOST` | `lrpi` | SSH destination |
| `DEPLOY_PRIVATE_ROOT` | `/srv/private-artifacts` | Private web root (must be outside `/var/www`) |
| `DEPLOY_PRIVATE_URL` | Detected from Pi's Tailscale DNS name | Private base URL |
| `DEPLOY_WEB_ROOT` | `/var/www/html` | Public web root only |
| `DEPLOY_PUBLIC_URL` | `https://kkrausse.com` | Public base URL |

`deploy-site.sh` still deploys the public homepage, unchanged.

Run publishing tests: `bun test deploy-artifact.test.ts`.

## Codex usage checker

`codex-usage.ts` displays the remaining Codex rolling-window usage for one or
more ChatGPT accounts, including the number of banked full-reset credits. It
delegates authentication and token refresh to the installed Codex CLI and keeps
additional accounts in separate `CODEX_HOME` directories.

```sh
# Use the existing Codex login as the first account.
codex-usage add main ~/.codex

# Create and log into an isolated second account.
codex-usage add second
codex-usage login second

# Check both accounts.
codex-usage
codex-usage --json
```

Configuration is stored at `~/.config/codex-usage/accounts.json`. Set
`CODEX_USAGE_HOME` to use another location. Removing an account from the list
does not delete its Codex home or credentials.

If both accounts are already connected to OpenCode, reuse its saved OAuth
credentials instead of logging into Codex separately:

```sh
codex-usage use-opencode
codex-usage
```

This opens OpenCode's SQLite database read-only and calls the ChatGPT usage
endpoint directly. It never copies credentials or modifies OpenCode's database.
