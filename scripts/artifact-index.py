"""Render an artifact shelf, ordered by last successful publish (newest first)."""
import datetime
import html
import pathlib
import re
import sys


def render(root, visibility):
    artifacts = []
    for path in pathlib.Path(root).iterdir():
        if not path.is_dir() or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", path.name):
            continue
        if not (path / "index.html").is_file():
            continue
        marker = path / ".published-at"
        timestamp = (marker if marker.exists() else path / "index.html").stat().st_mtime
        artifacts.append((timestamp, path.name))
    artifacts.sort(key=lambda item: (-item[0], item[1]))
    title = "Private artifacts" if visibility == "private" else "Artifacts"
    items = []
    for timestamp, name in artifacts:
        date = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc)
        items.append(f'<li><a href="/artifacts/{name}/">{html.escape(name)}</a>'
                     f'<time datetime="{date.isoformat()}">{date:%Y-%m-%d %H:%M UTC}</time></li>')
    listing = '<ul>' + '\n'.join(items) + '</ul>' if items else '<p>No artifacts published yet.</p>'
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><style>
body {{ max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; font: 1rem/1.5 system-ui,sans-serif; color: #222; }}
h1 {{ font-size: 1.6rem; }} ul {{ list-style: none; padding: 0; }}
li {{ padding: .85rem 0; border-bottom: 1px solid #ddd; overflow-wrap: anywhere; }}
time {{ display: block; font-size: .8rem; color: #666; }}
</style></head><body><main><h1>{title}</h1>
<p>Newest published first. Republishing moves an artifact to the top.</p>
{listing}</main></body></html>'''


if __name__ == "__main__":
    print(render(sys.argv[1], sys.argv[2]))
