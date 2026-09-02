import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { Schema } from 'effect'

const exec = promisify(execFile)
const root = path.resolve(import.meta.dir, '../..')
const rawDirectory = path.join(root, 'data/raw/garmin')
const activityDirectory = path.join(rawDirectory, 'activities')
const manifestPath = path.join(rawDirectory, 'manifest.json')
const cli = path.join(import.meta.dir, 'run')
const pageSize = 100

const GarminActivity = Schema.Struct({
  activityId: Schema.Union(Schema.String, Schema.Number),
  activityName: Schema.optional(Schema.String),
  startTimeLocal: Schema.optional(Schema.String),
  activityType: Schema.optional(Schema.Union(
    Schema.String,
    Schema.Struct({ typeKey: Schema.optional(Schema.String) }),
  )),
  distance: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
})
const GarminActivities = Schema.Array(GarminActivity)

const ManifestEntry = Schema.Struct({
  filename: Schema.String,
  downloadedAt: Schema.String,
  sha256: Schema.String,
})
const Manifest = Schema.Record({ key: Schema.String, value: ManifestEntry })
type ManifestData = Record<string, typeof ManifestEntry.Type>

const runCli = async (arguments_: ReadonlyArray<string>) => {
  try {
    return await exec(cli, arguments_, { cwd: root, maxBuffer: 20 * 1024 * 1024 })
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr).trim()
      : String(error)
    throw new Error(`Garmin CLI failed: ${detail}`)
  }
}

const writeManifest = async (manifest: ManifestData) => {
  const temporary = `${manifestPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(temporary, manifestPath)
}

const describeActivity = (activity: typeof GarminActivity.Type) => {
  const parts: string[] = []
  if (activity.startTimeLocal) parts.push(activity.startTimeLocal.replace('T', ' '))
  const sport = typeof activity.activityType === 'string'
    ? activity.activityType
    : activity.activityType?.typeKey
  if (sport) parts.push(sport.replaceAll('_', ' '))
  if (activity.activityName) parts.push(activity.activityName)
  if (activity.distance !== undefined) {
    parts.push(`${(activity.distance / 1_609.344).toFixed(1)} mi`)
  }
  if (activity.duration !== undefined) {
    const minutes = Math.round(activity.duration / 60)
    parts.push(minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`)
  }
  return parts.join(' | ') || `activity ${activity.activityId}`
}

await exec(path.join(import.meta.dir, 'run'), ['--version'], { cwd: root })
await mkdir(activityDirectory, { recursive: true })

const manifest: ManifestData = {
  ...Schema.decodeUnknownSync(Manifest)(
    JSON.parse(await readFile(manifestPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '{}'
      throw error
    })),
  ),
}
let offset = 0
let checked = 0
let downloaded = 0

while (true) {
  const { stdout } = await runCli([
    '--format', 'json', '--quiet',
    'activities', 'list',
    '--start', String(offset),
    '--limit', String(pageSize),
  ])
  const activities = Schema.decodeUnknownSync(GarminActivities)(JSON.parse(stdout))
  if (activities.length === 0) break
  console.log(`Scanning activities ${offset + 1}-${offset + activities.length}...`)

  for (const activity of activities) {
    const activityId = String(activity.activityId)
    checked += 1
    const cached = manifest[activityId]
    if (cached && await Bun.file(path.join(rawDirectory, cached.filename)).exists()) continue

    const orphanedFilename = await (async () => {
      for (const extension of ['zip', 'fit']) {
        const filename = `activities/${activityId}.${extension}`
        if (await Bun.file(path.join(rawDirectory, filename)).exists()) return filename
      }
      return null
    })()
    if (orphanedFilename) {
      const orphanedPath = path.join(rawDirectory, orphanedFilename)
      const [bytes, metadata] = await Promise.all([readFile(orphanedPath), stat(orphanedPath)])
      manifest[activityId] = {
        filename: orphanedFilename,
        downloadedAt: metadata.mtime.toISOString(),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
      await writeManifest(manifest)
      console.log(`Recovered ${orphanedFilename} | ${describeActivity(activity)}`)
      continue
    }

    const temporary = path.join(activityDirectory, `${activityId}.download`)
    console.log(`[${checked} checked, ${downloaded + 1} new] Downloading ${describeActivity(activity)}`)
    await runCli([
      '--format', 'json', '--quiet',
      'activities', 'download', activityId,
      '--format', 'ORIGINAL',
      '--output', temporary,
    ])
    const bytes = await readFile(temporary)
    const extension = bytes[0] === 0x50 && bytes[1] === 0x4b ? 'zip' : 'fit'
    const filename = `activities/${activityId}.${extension}`
    await rename(temporary, path.join(rawDirectory, filename))

    manifest[activityId] = {
      filename,
      downloadedAt: new Date().toISOString(),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    await writeManifest(manifest)
    downloaded += 1
    console.log(`Saved ${filename}`)
  }

  offset += activities.length
  if (activities.length < pageSize) break
}

console.log(`Sync complete: ${checked} activities checked, ${downloaded} downloaded`)
