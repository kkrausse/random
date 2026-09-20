export type DiagnosticEngineVersion = 'v1' | 'v2'

export const RECORDING_ENGINE_BUILD_ID = 'recording-engine-v1' as const
export const RECORDING_ENGINE_ALGORITHM_ID = 'ride-metrics-v1' as const

const diagnosticBuildIds: Readonly<Record<DiagnosticEngineVersion, string>> = {
  v1: 'phase1-engine-v1',
  v2: 'phase1-engine-v2',
}

export const mobileEngineBuildId = (version: DiagnosticEngineVersion) => `${diagnosticBuildIds[version]}.${RECORDING_ENGINE_BUILD_ID}`

export const composeMobileEngineArtifact = ({ diagnosticVersion, diagnosticSource, recordingSource }: {
  diagnosticVersion: DiagnosticEngineVersion
  diagnosticSource: string
  recordingSource: string
}) => {
  const diagnosticBuildId = diagnosticBuildIds[diagnosticVersion]
  const declaration = `var BUILD_ID = '${diagnosticBuildId}'`
  if (diagnosticSource.split(declaration).length !== 2) throw new Error(`Expected one ${diagnosticBuildId} build declaration`)
  if (!recordingSource.includes(`var RECORDING_ENGINE_BUILD_ID = "${RECORDING_ENGINE_BUILD_ID}"`)) throw new Error(`Recording artifact is not ${RECORDING_ENGINE_BUILD_ID}`)
  if (!recordingSource.includes(`var RECORDING_ENGINE_ALGORITHM_ID = "${RECORDING_ENGINE_ALGORITHM_ID}"`)) throw new Error(`Recording artifact is not ${RECORDING_ENGINE_ALGORITHM_ID}`)

  const packageBuildId = mobileEngineBuildId(diagnosticVersion)
  const diagnostic = diagnosticSource.replace(declaration, `var BUILD_ID = '${packageBuildId}'`)
  // The leading semicolon prevents the recording IIFE from being parsed as a
  // call on the diagnostic IIFE's result when either source omits a terminator.
  return `${diagnostic.trimEnd()}\n\n;${recordingSource.trim()}\n`
}
