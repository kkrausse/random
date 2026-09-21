declare const __WORKOUT_TAILSCALE_ORIGIN__: string

const tailscaleOrigin = typeof __WORKOUT_TAILSCALE_ORIGIN__ === 'string'
  ? __WORKOUT_TAILSCALE_ORIGIN__
  : 'https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443'

export const recommendedDevelopmentUrl = `${tailscaleOrigin}/`
export const defaultManifestUrl = `${tailscaleOrigin}/__workout/build/manifest.json`
