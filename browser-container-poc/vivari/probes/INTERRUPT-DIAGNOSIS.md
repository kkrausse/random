# Offline interrupt diagnosis

Source inspected: `.runtime/opencode-v2-source` at
`d7a7256bb6b0952f486c95718cfbf460b1570a56`. No guest execution was performed.

## Demonstrated harness defects

- `packages/schema/src/session-event.ts:287` defines exactly
  `session.step.started`, with `data.sessionID` and `data.assistantMessageID`.
  The probe's event spelling and envelope were correct.
- `packages/core/src/session/runner/llm.ts:315` consumes provider events and
  forwards them to the publisher. `publish-llm-event.ts:341` starts the assistant
  on `step-start`; there is no unconditional pre-request Step.Started publish.
  A held SSE comment is not a provider output event. Waiting for Step.Started
  before interrupt can therefore wait until transport deadline/settlement.
  `llm.ts:424` and `publish-llm-event.ts:303` show interruption settlement calling
  failAssistant, which starts the assistant before its durable failure.
- `packages/server/src/handlers/event.ts:19` acquires the EventFeed subscription
  before emitting `server.connected`. `event-feed.ts:76` installs a 4096-entry
  queue before returning its stream; events buffer while the connected frame is
  delivered. Response headers alone were not an explicit subscription barrier.
- The previous caller assigned evidence only on successful return, omitted it
  from FAIL, and the host replaced rejected results with a generic error. Managed
  stop cleanup was enabled only for tool probes. These independently erased the
  facts needed to distinguish a gate failure from cleanup failure.

The probe now waits for server.connected, prompts once, waits for the held local
provider request, then interrupts without requiring pre-output Step.Started.
Real Step.Started/Failed and execution.interrupted remain required on settlement.
Context and health are checked before waiting for transport closure so a closure
failure retains those independent observations. Failure receipts preserve only
allowlisted labels, booleans, numeric statuses/timestamps and sanitized exit data.
Managed stop and natural exit are observed independently within 20-second bounds
even on gate failure, before bounded local runtime/workspace cleanup.

## Still unknown

The historical 4/7 failure does not establish whether runtime cancellation reaches
the provider body. A deadline close is not cancellation. The sequencing defect
explains why the original gate could stall; it does not prove the cause of that
specific attempt without its missing browser checkpoints. No runtime acceptance
or cancellation fix is claimed by the offline tests.

Next diagnostic: one bounded `--interrupt` attempt using the unchanged prebuilt
guest/runtime and held comment-only provider. Inspect the persisted progress map
alongside host requestAt/headersAt/closedAt and closeReason. Require one local
request, zero external requests, interrupt 204, user terminal, aborted context,
post-interrupt health, actual request.abort/response.cancel, joined SSE and natural
managed exit. If transport still reaches deadline after interrupt settlement,
report that precise boundary; do not synthesize provider completion or broaden
into a cancellation redesign.
