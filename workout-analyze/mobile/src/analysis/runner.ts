import type { RouteDetector } from '../../../src/engine/analysis'
import type { DetectionProgress } from '../../../src/services/SegmentDetector'
import type { DetectionResult } from '../../../src/services/SegmentDetector'

type WorkerMessage =
  | { readonly type: 'progress'; readonly progress: DetectionProgress }
  | { readonly type: 'result'; readonly analysis: DetectionResult }
  | { readonly type: 'error'; readonly error: string }

export const runAnalysisWorker: RouteDetector = (activities, config, onProgress) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const finish = () => worker.terminate()
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    if (event.data.type === 'progress') onProgress?.(event.data.progress)
    if (event.data.type === 'result') { finish(); resolve(event.data.analysis) }
    if (event.data.type === 'error') { finish(); reject(new Error(event.data.error)) }
  }
  worker.onerror = (event) => { finish(); reject(new Error(event.message || 'Analysis worker failed')) }
  worker.postMessage({ activities, config })
})
