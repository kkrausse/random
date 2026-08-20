import { Effect } from 'effect'

import { importRawActivities } from '../services/Importer'

const result = await Effect.runPromise(importRawActivities)
console.log(`Built data/fitness.duckdb: ${result.activities} activities, ${result.samples} samples`)
