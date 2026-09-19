import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss(), react()],
  server: { strictPort: true },
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    sourcemap: false,
  },
})
