import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect, Schema } from 'effect'

import { FitnessDataError } from './errors'

const ManifestEntry = Schema.Struct({
  filename: Schema.String,
  downloadedAt: Schema.String,
  sha256: Schema.String,
})

const Manifest = Schema.Record({ key: Schema.String, value: ManifestEntry })

export interface RawActivity {
  readonly sourceActivityId: string
  readonly filename: string
  readonly bytes: Uint8Array
}

const rawRoot = () =>
  path.resolve(process.env.FITNESS_RAW_DIR ?? 'data/raw/garmin')

export const readRawActivities = Effect.tryPromise({
  try: async (): Promise<ReadonlyArray<RawActivity>> => {
    const root = rawRoot()
    const manifest = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8').catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return '{}'
          throw error
        },
      )),
    )

    return Promise.all(
      Object.entries(manifest).map(async ([sourceActivityId, entry]) => ({
        sourceActivityId,
        filename: entry.filename,
        bytes: await readFile(path.join(root, entry.filename)),
      })),
    )
  },
  catch: (cause) =>
    new FitnessDataError({ operation: 'read raw activity archive', cause }),
})
