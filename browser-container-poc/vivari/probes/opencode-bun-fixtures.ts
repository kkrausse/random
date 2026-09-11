export const globFixtures = [
  ['/glob-probe/match.ts', 'VIVARI_GLOB_MATCH\n'],
  ['/glob-probe/nonmatch.txt', 'VIVARI_GLOB_NONMATCH\n'],
] as const
export const globSeed = globFixtures.map(([, content]) => content).join('')
export const globSeedBytes = new TextEncoder().encode(globSeed).length

export const combinedFixture = {
  path: '/combined-probe/baseline.txt', directory: '/workspace/combined-probe',
  target: '/workspace/combined-probe/baseline.txt', before: 'BASELINE_BEFORE\n', after: 'BASELINE_AFTER\n',
} as const
export const combinedSteps = [
  { name: 'read', input: { path: combinedFixture.target }, content: `Read file ${combinedFixture.target}, lines 1-1\n1: BASELINE_BEFORE` },
  { name: 'edit', input: { path: combinedFixture.target, oldString: 'BASELINE_BEFORE', newString: 'BASELINE_AFTER' } },
  { name: 'grep', input: { pattern: 'BASELINE_AFTER', path: combinedFixture.target, limit: 10 }, content: `Found 1 matches\n${combinedFixture.target}:\n  Line 1: BASELINE_AFTER\n` },
  { name: 'glob', input: { pattern: 'baseline.txt', path: combinedFixture.directory, limit: 10 }, content: combinedFixture.target },
] as const
export const combinedPrompt = `Invoke exactly these four upstream tools in this order, waiting for each to succeed before calling the next: ${combinedSteps.map(step => `${step.name} with exactly ${JSON.stringify(step.input)}`).join('; ')}. Preserve the trailing newline when editing. Do not supply other arguments or invoke any other tools. Finish by replying COMBINED_PROBE_OK.`
