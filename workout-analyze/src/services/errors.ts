import { Data } from 'effect'

export class FitnessDataError extends Data.TaggedError('FitnessDataError')<{
  readonly operation: string
  readonly cause: unknown
}> {}
