export const maxCodeBytes = 64 * 1024
export const maxResultBytes = 256 * 1024
export const minTimeoutMs = 100
export const maxTimeoutMs = 30_000
export const maxRetainedJobs = 100

export type ClientKind = 'native' | 'simulator' | 'unavailable'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timedOut' | 'unknown'

export interface RunnerClient {
  clientId: string
  kind: ClientKind
  label: string
  sourceUrl: string
  build: string | null
  lastSeenAt: number
}

export interface RunnerJob {
  id: string
  code: string
  timeoutMs: number
  targetKind: ClientKind
  targetClientId: string | null
  status: JobStatus
  createdAt: number
  claimedAt: number | null
  completedAt: number | null
  client: RunnerClient | null
  result: unknown
}

type CreateInput = { code: string; timeoutMs?: number; targetKind?: ClientKind; targetClientId?: string }
type Completion = { status: Exclude<JobStatus, 'queued' | 'running'>; value?: unknown; logs?: unknown; error?: unknown; durationMs: number }

const publicJob = (job: RunnerJob) => ({ ...job, code: undefined })

export const createRunnerStore = ({ now = Date.now, jobTtlMs = 10 * 60_000, runningGraceMs = 45_000 } = {}) => {
  const jobs = new Map<string, RunnerJob>()
  const clients = new Map<string, RunnerClient>()
  const waiters = new Map<string, Set<() => void>>()
  let sequence = 0

  const notify = (jobId: string) => {
    waiters.get(jobId)?.forEach((resolve) => resolve())
    waiters.delete(jobId)
  }
  const sweep = () => {
    const current = now()
    for (const job of jobs.values()) {
      if (job.status === 'running' && job.claimedAt !== null && current - job.claimedAt > job.timeoutMs + runningGraceMs) {
        job.status = 'unknown'; job.completedAt = current
        job.result = { error: { message: 'The phone stopped reporting after claiming this job; execution outcome is unknown and it will not be retried.' } }
        notify(job.id)
      }
      const retentionStart = job.completedAt ?? (job.status === 'queued' ? job.createdAt : null)
      if (retentionStart !== null && current - retentionStart > jobTtlMs) jobs.delete(job.id)
    }
    for (const [id, client] of clients) if (current - client.lastSeenAt > jobTtlMs) clients.delete(id)
  }
  const register = (input: Omit<RunnerClient, 'lastSeenAt'>) => {
    const client = { ...input, lastSeenAt: now() }
    clients.set(client.clientId, client)
    return client
  }
  const create = (input: CreateInput) => {
    sweep()
    if (jobs.size >= maxRetainedJobs) throw new Error('Runner queue is full')
    if (typeof input.code !== 'string' || input.code.trim().length === 0 || Buffer.byteLength(input.code) > maxCodeBytes) throw new Error('code must be non-empty and at most 64 KiB')
    const timeoutMs = input.timeoutMs ?? 8_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < minTimeoutMs || timeoutMs > maxTimeoutMs) throw new Error(`timeoutMs must be ${minTimeoutMs}-${maxTimeoutMs}`)
    const targetKind = input.targetKind ?? 'native'
    if (!['native', 'simulator', 'unavailable'].includes(targetKind)) throw new Error('Invalid targetKind')
    const id = `run-${now().toString(36)}-${++sequence}`
    const job: RunnerJob = { id, code: input.code, timeoutMs, targetKind, targetClientId: input.targetClientId ?? null, status: 'queued', createdAt: now(), claimedAt: null, completedAt: null, client: null, result: null }
    jobs.set(id, job)
    return publicJob(job)
  }
  const claim = (clientInput: Omit<RunnerClient, 'lastSeenAt'>) => {
    sweep()
    const client = register(clientInput)
    const job = [...jobs.values()].find((candidate) => candidate.status === 'queued' && candidate.targetKind === client.kind && (!candidate.targetClientId || candidate.targetClientId === client.clientId))
    if (!job) return null
    job.status = 'running'; job.claimedAt = now(); job.client = client
    notify(job.id)
    return { id: job.id, code: job.code, timeoutMs: job.timeoutMs }
  }
  const complete = (jobId: string, clientId: string, completion: Completion) => {
    const job = jobs.get(jobId)
    if (!job || job.status !== 'running' || job.client?.clientId !== clientId) return false
    job.status = completion.status; job.completedAt = now(); job.result = completion
    notify(job.id)
    return true
  }
  const abandon = (jobId: string, clientId: string) => {
    const job = jobs.get(jobId)
    if (!job || job.status !== 'running' || job.client?.clientId !== clientId) return false
    job.status = 'unknown'; job.completedAt = now()
    job.result = { error: { message: 'The phone page was hidden or unloaded while this job was running. Its side effects are unknown and it was not retried.' } }
    notify(job.id)
    return true
  }
  const get = (id: string) => { sweep(); const job = jobs.get(id); return job ? publicJob(job) : null }
  const list = () => { sweep(); return { jobs: [...jobs.values()].map(publicJob), clients: [...clients.values()] } }
  const wait = async (id: string, waitMs: number) => {
    const before = jobs.get(id)?.status
    if (!before || !['queued', 'running'].includes(before) || waitMs <= 0) return get(id)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(waitMs, 25_000))
      const done = () => { clearTimeout(timer); resolve() }
      const entries = waiters.get(id) ?? new Set()
      entries.add(done); waiters.set(id, entries)
    })
    return get(id)
  }
  return { create, claim, complete, abandon, get, list, wait, register }
}

export type RunnerStore = ReturnType<typeof createRunnerStore>
