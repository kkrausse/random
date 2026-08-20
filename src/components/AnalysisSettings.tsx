import { useRouter } from '@tanstack/react-router'
import { Play, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useState, useTransition } from 'react'

import { rebuildAnalysis } from '../server/analysis.functions'
import type { AnalysisSettings as AnalysisSettingsValue } from '../services/AnalysisDatabase'
import type { DetectionConfig } from '../services/SegmentDetector'

const fields: ReadonlyArray<{
  key: keyof DetectionConfig
  label: string
  unit: string
  min: number
  max: number
  step: number
}> = [
  { key: 'maxRouteDeviationM', label: 'Maximum deviation', unit: 'm', min: 5, max: 200, step: 5 },
  { key: 'candidateCellM', label: 'Candidate cell size', unit: 'm', min: 20, max: 1_000, step: 10 },
  { key: 'minSegmentDistanceM', label: 'Minimum segment', unit: 'm', min: 100, max: 20_000, step: 100 },
  { key: 'minLoopDistanceM', label: 'Minimum loop', unit: 'm', min: 100, max: 10_000, step: 100 },
  { key: 'maxLoopDistanceM', label: 'Maximum loop', unit: 'm', min: 200, max: 50_000, step: 100 },
  { key: 'loopClosureM', label: 'Loop closure', unit: 'm', min: 5, max: 500, step: 5 },
  { key: 'minWorkoutCount', label: 'Minimum workouts', unit: '', min: 2, max: 100, step: 1 },
  { key: 'maxRoutesPerSport', label: 'Routes per sport/type', unit: '', min: 1, max: 100, step: 1 },
]

export function AnalysisSettings({ settings }: { settings: AnalysisSettingsValue }) {
  const router = useRouter()
  const [config, setConfig] = useState(settings.config)
  const [expanded, setExpanded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)

  const run = () => {
    setStatus(null)
    startTransition(async () => {
      try {
        const result = await rebuildAnalysis({ data: config })
        setStatus(`Analyzed ${result.activities} workouts: ${result.routes} routes and ${result.traversals} traversals.`)
        await router.invalidate()
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Analysis failed')
      }
    })
  }

  return (
    <section className="detector-settings">
      <button className="settings-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span><SlidersHorizontal aria-hidden="true" /><span><strong>Detection settings</strong><small>{settings.analyzedAt ? `Last run ${new Date(settings.analyzedAt).toLocaleString()}` : 'Analysis has not been run'}</small></span></span>
        <span>{expanded ? 'Hide settings' : 'Adjust and rerun'}</span>
      </button>
      {expanded && <div className="settings-body">
        <div className="settings-intro"><p>These settings rebuild only derived routes and traversals. Imported workouts and GPS samples are not modified.</p><button type="button" onClick={() => setConfig(settings.config)} disabled={isPending}><RotateCcw />Restore last run</button></div>
        <div className="settings-grid">
          {fields.map((field) => <label key={field.key}>{field.label}<span><input type="number" min={field.min} max={field.max} step={field.step} value={config[field.key]} disabled={isPending} onChange={(event) => setConfig({ ...config, [field.key]: Number(event.target.value) })} />{field.unit && <small>{field.unit}</small>}</span></label>)}
        </div>
        <div className="settings-actions"><p>Detection usually takes a few seconds for the current archive.</p><button className="sync-button" type="button" onClick={run} disabled={isPending}><Play />{isPending ? 'Running analysis...' : 'Rerun analysis'}</button></div>
      </div>}
      {status && <p className="analysis-run-status" role="status">{status}</p>}
    </section>
  )
}
