# Browser verification blocker

- 2026-09-05: `browser-control execute 'return { url: page.url() }'` failed with `Missing required flag: --json`.
- Retrying with `--json` failed: `Running relay build 2026-09-05T19:03:42.828Z does not match CLI build 2026-08-23T23:42:36.863Z; restart the relay.`
- Expected: a new browser verification session. Actual: no page/session created. Recovery attempted: added required JSON flag. Align the CLI with the newer running relay before retrying terminal drag-selection/clipboard verification.
