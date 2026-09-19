import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { devDiagnosticsPlugin } from '../scripts/mobile/dev-logs.ts'

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss(), react(), devDiagnosticsPlugin()],
  server: { strictPort: true },
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    sourcemap: false,
  },
})
