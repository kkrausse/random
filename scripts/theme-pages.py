"""Attach the shared theme to published HTML without changing page content."""
import pathlib
import os
import re
import sys


def apply(root):
    link = '<link rel="stylesheet" href="/theme.css" data-site-theme>'
    for path in pathlib.Path(root).rglob("*.html"):
        if path.is_symlink():
            continue
        content = path.read_text()
        if 'data-site-theme' in content:
            continue
        # Generated file listings can be headless HTML fragments.
        if re.search(r"</head\s*>", content, re.IGNORECASE):
            themed = re.sub(r"</head\s*>", link + "\n</head>", content, count=1, flags=re.IGNORECASE)
        else:
            themed = content + "\n" + link + "\n"
        timestamp = path.stat()
        path.write_text(themed)
        # Preserve publish ordering when an old artifact has no publish marker.
        os.utime(path, ns=(timestamp.st_atime_ns, timestamp.st_mtime_ns))


if __name__ == "__main__":
    apply(sys.argv[1])
