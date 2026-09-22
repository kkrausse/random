/// <reference lib="webworker" />
import { detectRoutes } from '../../../src/services/SegmentDetector'
import type { DetectionConfig } from '../../../src/services/SegmentDetector'
import type { NormalizedActivity } from '../../../src/domain/activity'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<{ activities: NormalizedActivity[]; config: DetectionConfig }>) => {
  try {
    let lastSentAt = 0
    let lastPhase = ''
    const analysis = detectRoutes(event.data.activities, event.data.config, (progress) => {
      const now = performance.now()
      if (progress.phase !== lastPhase || progress.completed === progress.total || now - lastSentAt >= 100) {
        lastPhase = progress.phase
        lastSentAt = now
        self.postMessage({ type: 'progress', progress })
      }
    })
    self.postMessage({ type: 'result', analysis })
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Route detection failed' })
  }
}

export {}
