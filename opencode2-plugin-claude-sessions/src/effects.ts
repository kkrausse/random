import { Cause, Effect, Exit, Schema } from "effect"

export type Operation = {
  operation: string
  sessionID?: string
  requestID?: string
  directory?: string
}

export class SessionOperationError extends Schema.TaggedError<SessionOperationError>()("SessionOperationError", {
  operation: Schema.String,
  sessionID: Schema.optional(Schema.String),
  requestID: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message() {
    const target = [this.sessionID, this.requestID, this.directory].filter(Boolean).join(" / ")
    return `${this.operation}${target ? ` (${target})` : ""}: ${describe(this.cause)}`
  }
}

// The TUI exposes a connected Promise client, not its transport options. Keep
// that client (including remote/auth configuration) and adapt only at the edge.
export const operation = Effect.fn("operation")(function* <A>(details: Operation, run: (signal: AbortSignal) => Promise<A>) {
  return yield* Effect.tryPromise({ try: run, catch: (cause) => new SessionOperationError({ ...details, cause }) }).pipe(
    Effect.withSpan(details.operation, { attributes: details }),
  )
})

function describe(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return ""
  if (typeof value !== "object") return String(value)
  const error = value as Record<string, unknown>
  const response = error.response as { status?: number } | undefined
  const parts = [
    typeof error._tag === "string" ? error._tag : undefined,
    typeof error.message === "string" ? error.message : undefined,
    typeof (response?.status ?? error.status) === "number" ? `HTTP ${response?.status ?? error.status}` : undefined,
    typeof error.reason === "string" ? error.reason : undefined,
    error.cause === value ? undefined : describe(error.cause, depth + 1),
  ].filter(Boolean)
  return [...new Set(parts)].join(" · ") || "Unknown failure"
}

export function failureMessage(cause: Cause.Cause<unknown>) {
  return cause.reasons.flatMap((reason) => {
    if (Cause.isInterruptReason(reason)) return []
    const original = Cause.isFailReason(reason) ? reason.error : reason.defect
    if (original instanceof SessionOperationError) {
      return original.message
    }
    return describe(original)
  }).join("\n") || Cause.pretty(cause)
}

// One execution boundary for commands, reactive loads, and event callbacks.
// Closing the picker interrupts all work; selection changes cancel read jobs.
export function makeRunner(report: (message: string, cause: Cause.Cause<unknown>) => void) {
  const controllers = new Set<AbortController>()
  let disposed = false
  function start<A, E>(effect: Effect.Effect<A, E>, onFailure?: (message: string) => void) {
    const controller = new AbortController()
    if (disposed) return { done: Promise.resolve(), cancel() {} }
    controllers.add(controller)
    const done = Effect.runPromiseExit(effect, { signal: controller.signal }).then((exit) => {
      controllers.delete(controller)
      if (disposed || controller.signal.aborted || Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return
      const message = failureMessage(exit.cause)
      report(message, exit.cause)
      onFailure?.(message)
    })
    return { done, cancel: () => controller.abort() }
  }
  return {
    start,
    dispose() {
      disposed = true
      for (const controller of controllers) controller.abort()
      controllers.clear()
    },
  }
}
