import { Effect } from 'effect'

import { rebuildDatabase } from './Database'
import { decodeFitActivity } from './FitDecoder'
import { readRawActivities } from './RawActivityStore'

export const importRawActivities = Effect.gen(function* () {
  const rawActivities = yield* readRawActivities
  const decoded = yield* Effect.try({
    try: () =>
      rawActivities.map((activity) => ({
        sourceActivityId: activity.sourceActivityId,
        ...decodeFitActivity(activity.filename, activity.bytes),
      })),
    catch: (cause) => ({ _tag: 'FitDecodeError' as const, cause }),
  })
  yield* rebuildDatabase(decoded)
  return {
    activities: decoded.length,
    samples: decoded.reduce((total, activity) => total + activity.samples.length, 0),
  }
})
