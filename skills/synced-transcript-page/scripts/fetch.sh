#!/usr/bin/env bash
# Downloads a YouTube video's auto-captions (with per-word timings) and its
# original-language audio track, and leaves a seekable audio.m4a in the site dir.
#   fetch.sh <youtube-url> <work-dir> <lang>      e.g. fetch.sh https://… /tmp/job it
set -euo pipefail
url=$1 work=$2 lang=$3
mkdir -p "$work/dl" "$work/site"

uvx yt-dlp --no-progress --no-playlist --skip-download --no-simulate --print "%(title)s | %(uploader)s | %(duration_string)s" \
  --write-auto-subs --sub-langs "$lang-orig" --sub-format json3 \
  -o "$work/dl/captions.%(ext)s" "$url"
mv "$work/dl/captions.$lang-orig.json3" "$work/captions.json3"

# The plain https audio formats return 403 from this box; the HLS ones work.
# Dubbed tracks exist too, so pin the language.
uvx yt-dlp --no-progress --no-playlist --js-runtimes bun \
  -f "bestaudio[protocol^=m3u8][language^=$lang]/bestaudio[language^=$lang]" \
  -o "$work/dl/audio.%(ext)s" "$url"

# The HLS download is raw ADTS with no seek index: re-encode into m4a with the
# index up front so the browser can seek with range requests.
ffmpeg -v error -y -i "$work"/dl/audio.* -vn -ac 1 -c:a aac -b:a 64k -movflags +faststart "$work/site/audio.m4a"
ls -la "$work/captions.json3" "$work/site/audio.m4a"
