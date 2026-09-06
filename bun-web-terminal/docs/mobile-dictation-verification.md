# Mobile dictation verification

Implementation verified locally September 6, 2026, on Apple Silicon macOS 15.1,
Swift 6.0.3 / Xcode 16.2, Bun 1.4.0, and the cached FluidAudio 0.15.5 English
Parakeet Unified `(70, 7, 7)` model.

## Automated checks

- `bun run typecheck`: passed.
- `bun run test`: 20 tests passed, including isolated tmux tests and the new
  resampler/transcript/protocol/proxy tests.
- `swift build -c release`: passed; complete dependency graph locked in
  `dictation-server/Package.resolved`.
- `swift test -c release`: two protocol/audio-validation tests passed.
- `bun docs/verify-dictation-supervision.ts`: passed collision isolation, shared
  concurrent startup, forced-crash/fresh-instance restart, bounded shutdown, and
  externally managed service ownership.
- `bun scripts/verify.ts` in `dictation-server`: real-model integration passed
  timed streaming, busy rejection, ordered partial/final/done, final-word
  retention, warm consecutive-recording isolation, cancel/reset, non-finite audio
  rejection, and queue overload termination.

The initial Swift test run exposed executable-main linkage in the XCTest runner;
separating `DictationCore` from the executable fixed it. No model assets were
downloaded: the worker uses FluidAudio's explicit local-directory loading API.

## Local model measurements

Fixture generated with macOS `say -v Samantha`: “The quick brown fox jumps over
the lazy dog.” Sent as 16 kHz mono Float32 LE in 80 ms timed packets.

| Measurement | Observed |
| --- | --- |
| First process model load (on-disk cache already present) | 11.50 s |
| Later process model load (CoreML/OS caches warm) | 0.10–0.14 s |
| Warm socket/start to ready | 21–22 ms (20 ms polling resolution) |
| Start to first nonempty partial | 1.73–1.75 s |
| Stop to final/done, including 400 ms decoder silence padding | 42–43 ms |
| Warm silence recording final flush | 20–21 ms |
| Final transcript | `The quick brown fox jumps over the lazy dog.` |

After several recordings, `vmmap -summary` reported **43.4 MiB physical footprint**
(44.2 MiB peak), and 315.6 MiB total resident mappings including shared libraries.
`ps` RSS snapshots ranged roughly 51–88 MiB as pages changed residency. These
process-level figures do not isolate total ANE/CoreML shared-service memory.
The existing Hex process stayed running throughout (idle, not simultaneously
dictating). Active simultaneous Hex/phone contention remains to be measured.
These local synthetic-fixture timings are not an end-to-end phone latency claim.

## Visible browser and terminal check

Used Browser Control 0.7.0 with a disposable Bun instance on port 13007, a Swift
instance on 19876, and a newly created disposable tmux session. The browser
microphone method was replaced **only in the test tab** by a generated speech
MediaStream from a 48 kHz AudioContext. Production AudioContext/AudioWorklet,
resampling, Bun proxy, Swift inference, transcript insertion, and tmux were real.

Verified:

- Keyboard icon followed immediately by mic; approximately 44 px touch targets,
  accessible state labels and pressed state.
- Permission rejection shows a notice and exits loading.
- Rapid cancel while permission is pending releases tracks when the late
  permission result resolves.
- Recording clears one-shot Ctrl and does not focus the textarea.
- Stop drains audio, reaches idle, and leaves all microphone tracks `ended`.
- A shell shows the dictated sentence at its prompt without executing it.
- Vim receives the complete sentence on one line at its insertion cursor.
- Vim's terminal writes were exactly whole-word bracketed pastes:
  `The quick brown `, `fox `, `jumps over the `, `lazy `, `dog.`. Each had
  `ESC[200~` / `ESC[201~` wrappers; no Enter, missing/duplicate words, or Ctrl
  transformation. Focus stayed on BODY during recording/stop.
- Opening the same terminal in a second tab ends recording, releases tracks,
  shows detached state, and sends no additional terminal text.

Disposable browser pages, audio contexts, native terminal observer, tmux session,
and test services were cleaned up. No microphone permission was requested from
the host user's actual device during these synthetic browser checks.

## Real-phone checks still required

Use the existing Tailscale HTTPS URL on the target phone:

- Actual microphone permission allow/deny and browser-specific error text.
- First and warm recordings; a short last word, long speech, and silence.
- Rapid toggling; keyboard open/closed; rotation; selection of recovery text.
- Screen lock/background and return; verify capture stops and never auto-resumes.
- Network loss, reconnection, and second-tab takeover during speech/finish.
- Shell and full-screen editor insertion with the phone's real capture rate.
- Active simultaneous dictation in Hex and the phone, including memory and
  latency under contention.

Desktop capture simulation does not establish iOS software-keyboard, microphone,
or background/lock behavior.
