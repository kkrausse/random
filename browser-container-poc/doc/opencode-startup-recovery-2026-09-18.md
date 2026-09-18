# OpenCode browser startup recovery — 2026-09-18

Implemented in toolkit commit `8aedf38` at
`/Users/kkrausse/Documents/repos/kkrausse/browser-agent-toolkit-upstream`.

## Failure and fix

The authenticated health loop had a nominal 30-second deadline but a single
3-second fetch timeout escaped the Effect and failed editor startup immediately.
It now catches request failures and retries, caps each attempt and backoff to
the remaining deadline, and reports deadline exhaustion with the last failure
as its cause. Effect interruption still cancels requests/body consumption and
backoff instead of being retried.

The logged unauthenticated `GET /` 401 has a separate source: Vivari's
`kernel-worker.ts` `announceServing` calls `waitServing`, which probes `/` with
empty headers. Endpoint.fetch independently preserves `/api/health` and its
authorization header. There is no evidence here of health-path rewriting.

## Verification

- Chat suite: 99 pass, 2 optional skips, 0 fail.
- Chat typecheck and build passed.
- Regression coverage: fetch rejection, actual 3-second abort, HTTP 503,
  recovery through activation/config/catalog checks, 30-second deadline, and
  existing cancellation tests for response bodies and backoff.
- Rebuilt chat package, force-reinstalled consumer dependencies, and started
  consumer dev with Vite reoptimization. Consumer tracked files were unchanged
  except the pre-existing user-owned AGENTS.md modification.
- Browser session `quiet-raven-407`, run `6b3f00c1`: six health attempts timed
  out; seventh succeeded in 2144ms, about 20.7 seconds after health probing began.
  Activation, plugin state, configuration, catalog, chat, and preview all became
  ready. Chat history hydrated.
- Explicit Exit → Edit local copy also reached Ready, with a visible Message
  OpenCode input and the preview heading `Process transcripts faster`, confirming
  the saved local preview survived reopening.

## Remaining distinction

This fixes premature startup failure, not startup latency. Guest logs show
plugin/catalog initialization during the delay, but do not isolate all of its
cost or prove catalog fetching alone caused it. No model-generation request was
submitted in this verification; prior provider quota failures remain a separate
issue. The browser was left with the editor ready.
