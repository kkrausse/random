export {}

const args = Bun.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const server = (option('--server') ?? 'http://100.86.29.19:4317').replace(/\/$/, '')
const file = option('--file')
const inline = option('--code')
if ((!file && !inline) || (file && inline)) throw new Error('Provide exactly one of --code <javascript> or --file <path>')
const code = file ? await Bun.file(file).text() : inline!
const timeoutMs = Number(option('--timeout') ?? 8_000)
const targetClientId = option('--client')
const targetKind = option('--kind') ?? 'native'
if (!['native', 'simulator', 'unavailable'].includes(targetKind)) throw new Error('--kind must be native, simulator, or unavailable')

const createdResponse = await fetch(`${server}/__workout/run`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, timeoutMs, targetKind, ...(targetClientId ? { targetClientId } : {}) }),
})
if (!createdResponse.ok) throw new Error(`Runner rejected job (${createdResponse.status}): ${await createdResponse.text()}`)
const created = await createdResponse.json() as { id: string }
const deadline = Date.now() + timeoutMs + 35_000
type JobResponse = { status: string; result?: unknown }
let job: JobResponse | undefined
while (Date.now() < deadline) {
  const remaining = deadline - Date.now()
  const response = await fetch(`${server}/__workout/run/${encodeURIComponent(created.id)}?waitMs=${Math.min(20_000, remaining)}`)
  if (!response.ok) throw new Error(`Could not read job (${response.status}): ${await response.text()}`)
  job = await response.json() as JobResponse
  if (!['queued', 'running'].includes(job.status)) break
}
const finished = job as JobResponse | undefined
if (!finished || ['queued', 'running'].includes(finished.status)) throw new Error(`Job ${created.id} did not complete. Open the app on the physical iPhone and keep it foregrounded.`)
console.log(JSON.stringify({ jobId: created.id, status: finished.status, result: finished.result }, null, 2))
if (finished.status !== 'succeeded') process.exitCode = 1
