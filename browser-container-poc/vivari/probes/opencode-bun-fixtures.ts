export const globFixtures = [
  ['/glob-probe/match.ts', 'VIVARI_GLOB_MATCH\n'],
  ['/glob-probe/nonmatch.txt', 'VIVARI_GLOB_NONMATCH\n'],
] as const
export const globSeed = globFixtures.map(([, content]) => content).join('')
export const globSeedBytes = new TextEncoder().encode(globSeed).length
