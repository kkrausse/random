import { strict as assert } from "node:assert"
import { test } from "node:test"
import { Cause, Effect } from "effect"
import { failureMessage, makeRunner, operation, SessionOperationError } from "./effects"

test("operation failures retain context, nested HTTP status, and original cause", async () => {
  const original = { _tag: "HttpClientError", cause: { message: "Unexpected Status", response: { status: 409 } } }
  const reports: Array<{ message: string; cause: Cause.Cause<unknown> }> = []
  const runner = makeRunner((message, cause) => reports.push({ message, cause }))
  let surfaced = ""
  await runner.start(operation({ operation: "Interrupt session", sessionID: "s1" }, async () => { throw original }),
    (message) => { surfaced = message }).done
  assert.equal(reports.length, 1)
  assert.match(surfaced, /Interrupt session \(s1\).*Unexpected Status.*HTTP 409/)
  const reason = reports[0]!.cause.reasons.find(Cause.isFailReason)!
  assert.ok(reason.error instanceof SessionOperationError)
  assert.equal(reason.error.cause, original)
  runner.dispose()
})

test("boundary catches defects and finalizes failed work", async () => {
  const reports: string[] = []
  const runner = makeRunner((message) => reports.push(message))
  let finalized = false
  await runner.start(Effect.sync(() => { throw new Error("render callback failed") }).pipe(
    Effect.ensuring(Effect.sync(() => { finalized = true })),
  )).done
  assert.equal(finalized, true)
  assert.match(reports[0]!, /render callback failed/)
  runner.dispose()
})

test("cancelling a read aborts transport and prevents stale publication without an error", async () => {
  const reports: string[] = []
  const runner = makeRunner((message) => reports.push(message))
  let resolve!: (value: string) => void
  let signal!: AbortSignal
  let published = false
  let started!: () => void
  const ready = new Promise<void>((done) => { started = done })
  const job = runner.start(Effect.gen(function* () {
    yield* operation({ operation: "Load preview", sessionID: "s1" }, (abort) => {
      signal = abort
      started()
      return new Promise<string>((done) => { resolve = done })
    })
    published = true
  }))
  await ready
  job.cancel()
  await job.done
  assert.equal(signal.aborted, true)
  resolve("late result")
  await Promise.resolve()
  assert.equal(published, false)
  assert.deepEqual(reports, [])
  runner.dispose()
})

test("dispose cancels all jobs and prevents new work", async () => {
  const runner = makeRunner(() => assert.fail("cancellation is not an error"))
  const jobs = [runner.start(Effect.never), runner.start(Effect.never)]
  runner.dispose()
  await Promise.all(jobs.map((job) => job.done))
  await runner.start(Effect.sync(() => assert.fail("disposed runner started work"))).done
})

test("non-Error rejections and cyclic causes still produce readable failures", () => {
  assert.match(failureMessage(Cause.fail("offline")), /offline/)
  const error = { message: "cycle", cause: undefined as unknown }
  error.cause = error
  assert.match(failureMessage(Cause.fail(error)), /cycle/)
})
