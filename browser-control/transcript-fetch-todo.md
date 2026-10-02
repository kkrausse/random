# YouTube transcript retrieval diagnostics

- Browser Control installed CLI: v0.8.2.
- Context: session-owned YouTube watch page, session `calm-wombat-651`, public video `OO9FSQuBBRw`.
- Snapshot reproduction: expanding the description, then `snapshot({within:"#description"})`, fails because the page contains two matching elements. Expected: scoped description; actual: explicit ambiguity error. Recovery: read body text directly. This is a selector issue, not a relay failure.
- Transcript reproduction: click the observed “Show transcript” button, then read `ytd-transcript-renderer`; locator timed out after 30 seconds because no transcript renderer appeared. Expected: transcript panel; actual: no renderer. Reading the discovered get_transcript endpoint returned HTTP 400 FAILED_PRECONDITION; the caption URL returned HTTP 200 with an empty body.
- Recovery: successfully retrieved Italian auto-captions through yt-dlp, without changing browser settings or bypassing any protected UI. No Browser Control changes are requested; investigate only if repeated on other videos.
