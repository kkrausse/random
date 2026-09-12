import { combinedBytes, combinedEvidence, runCombined } from './opencode-bun-combined'
import { combinedFixture } from './opencode-bun-fixtures'
import { projectHistory, sameHistory } from './opencode-bun-retention'
import type { Workspace } from '../../workspace-api/src/index'

export const modelID = 'muse-spark-1.3-contributor-free'
export function directModelEvidence() {
  return { providerID: 'opencode', id: modelID, promptRequests: 0, terminal: 'pending', sseCleanup: 'pending',
    deltas: 0, toolEvents: 0, textBlocks: 0, textLength: 0, combined: combinedEvidence(),
    catalogVerified: false, configVerified: false, before: undefined as Awaited<ReturnType<typeof projectHistory>> | undefined,
    after: undefined as Awaited<ReturnType<typeof projectHistory>> | undefined, fileBeforeReopen: '', failure: null as string | null,
    diagnostic: undefined as unknown, setup: undefined as unknown }
}
export type DirectModelEvidence = ReturnType<typeof directModelEvidence>
type Endpoint = { fetch(path: string, init?: RequestInit): Promise<Response> }
type Hash = (bytes: Uint8Array) => Promise<string>
export async function seedDirectModel(workspace: Workspace, evidence: DirectModelEvidence, hash: Hash) {
  await workspace.fs.writeFile('/.server/config/opencode/opencode.json', JSON.stringify({
    model: 'opencode/' + modelID, snapshots: false,
    permissions: ['read', 'edit', 'grep', 'glob'].map(action => ({ action, resource: '*', effect: 'allow' })),
    providers: { opencode: { settings: { baseURL: `http://host.vivari.internal:${location.port}/api/model/opencode` },
      models: { [modelID]: { name: 'Muse Spark 1.3 Free', package: '@opencode/ai/providers/openai',
        capabilities: { tools: true, input: ['text', 'image', 'video', 'pdf', 'audio'], output: ['text'] },
        limit: { context: 1048576, output: 131072 }, websocket: false } } } },
  }))
  await workspace.fs.mkdir('/combined-probe')
  await workspace.fs.writeFile(combinedFixture.path, combinedFixture.before)
  await combinedBytes(evidence.combined, 'before', await workspace.fs.readFile(combinedFixture.path), hash)
}
export async function directModelPhase(endpoint: Endpoint, workspace: Workspace, evidence: DirectModelEvidence, phase: number, hash: Hash) {
  const headers = { authorization: 'Basic ' + btoa('opencode:isolated-probe-only'), 'content-type': 'application/json' }
  const api = async (path: string) => {
    const r = await endpoint.fetch(path, { headers, signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw Error(`Model API ${path} HTTP ${r.status}`)
    const body = await r.json()
    return path.startsWith('/api/config') ? body : body.data
  }
  if (!phase) {
    const config = await api('/api/config?directory=/workspace')
    evidence.configVerified = Array.isArray(config) && config.some(c => c.type === 'document' &&
      c.path === '/workspace/.server/config/opencode/opencode.json' && c.info?.providers?.opencode?.models?.[modelID])
    if (!evidence.configVerified) throw Error('Supported global model configuration not loaded')
    const activation = await endpoint.fetch('/api/plugin/await-activation?directory=/workspace', { method: 'POST', headers, signal: AbortSignal.timeout(20000) })
    if (!activation.ok) throw Error('Plugin activation failed')
    await activation.arrayBuffer()
    const models = await api('/api/model?directory=/workspace')
    const list = Array.isArray(models) ? models : []
    evidence.catalogVerified = list.some(m => m.providerID === evidence.providerID && m.id === evidence.id && m.enabled && m.capabilities?.tools)
    if (!evidence.catalogVerified) throw Error('Configured model absent from enabled catalog')
    await runCombined(endpoint, headers, evidence.combined, evidence)
    if (!evidence.textBlocks || !evidence.textLength || !evidence.deltas) throw Error('No actual model text response')
    await combinedBytes(evidence.combined, 'after', await workspace.fs.readFile(combinedFixture.path), hash)
    evidence.before = await projectHistory(await api(`/api/session/${evidence.combined.sessionID}/context`), evidence.combined.events, hash)
  } else {
    evidence.after = await projectHistory(await api(`/api/session/${evidence.combined.sessionID}/context`), evidence.combined.events, hash)
    sameHistory(evidence.before!, evidence.after)
    await combinedBytes(evidence.combined, 'after', await workspace.fs.readFile(combinedFixture.path), hash)
  }
}

// Error messages and provider state may contain credentials. Retain only error
// classification, tool status/name, and hashes of private diagnostic text.
export async function modelDiagnostic(endpoint: Endpoint, evidence: DirectModelEvidence, hash: Hash) {
  if (!evidence.combined.sessionID) return { sessionCreated: false }
  const r = await endpoint.fetch(`/api/session/${evidence.combined.sessionID}/context`, {
    headers: { authorization: 'Basic ' + btoa('opencode:isolated-probe-only') }, signal: AbortSignal.timeout(5000),
  })
  const data = r.ok ? (await r.json()).data : []
  return { status: r.status, messages: await Promise.all((Array.isArray(data) ? data : []).map(async m => ({
    type: m.type, id: m.id, completed: m.time?.completed != null,
    error: m.error ? { name: m.error.name, sha256: await hash(new TextEncoder().encode(JSON.stringify(m.error))) } : null,
    tools: (m.content ?? []).filter((p: any) => p.type === 'tool').map((p: any) => ({ id: p.id, name: p.name, status: p.state?.status })),
  }))) }
}
