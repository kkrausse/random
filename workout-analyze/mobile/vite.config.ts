import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { mobileBuildDeliveryPlugin } from '../scripts/mobile/build-delivery.ts'
import { devDiagnosticsPlugin } from '../scripts/mobile/dev-logs.ts'
import { devRunnerPlugin } from '../scripts/mobile/dev-runner/plugin.ts'
import { localReplayPlugin } from '../scripts/mobile/local-replay.ts'
import { recoveredArchivePlugin } from '../scripts/mobile/recovered-archive.ts'
import { localDatabasePlugin } from '../scripts/mobile/local-database.ts'

const tailscaleHost = 'kevins-macbook-pro-2.tail7e28fb.ts.net'
const tailscaleHttpsPort = 8443
const tailscaleOrigin = `https://${tailscaleHost}:${tailscaleHttpsPort}`

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss(), react(), devDiagnosticsPlugin(), devRunnerPlugin(), recoveredArchivePlugin(), localDatabasePlugin(), localReplayPlugin(), mobileBuildDeliveryPlugin({ distDirectory: `${import.meta.dirname}/dist` })],
  define: { __WORKOUT_TAILSCALE_ORIGIN__: JSON.stringify(tailscaleOrigin) },
  server: {
    strictPort: true,
    allowedHosts: [tailscaleHost],
    watch: { ignored: ['**/mobile/dist/**'] },
  },
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    sourcemap: false,
  },
})
