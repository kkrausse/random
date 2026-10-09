# Synced transcript page

Foreign-language YouTube video to a dark-mode page: English on top, faded
original captions below, original audio with word-by-word highlighting.
The page is `template.html`. Example: https://zu4tgfuxau5n.opentunnel.xyz/artifacts/antirez-automatic-programming/

```sh
scripts/fetch.sh <url> <work> <lang>                 # captions.json3 + site/audio.m4a
bun scripts/build.ts chunks <work>/captions.json3    # passages to translate into <work>/en.json
bun scripts/build.ts page --captions <work>/captions.json3 --en <work>/en.json \
  --title T --byline B --url <url> --lang <lang> --out <work>/site \
  && ../scripts/deploy-artifact.sh --tunnel <work>/site <slug>
bun scripts/check.ts "<published-url>#autoplay" <work>/shot.png
```

Fetch captions once: a second download can differ and break the alignment with `en.json`.
