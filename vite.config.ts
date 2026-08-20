import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    exclude: [
      '@duckdb/node-api',
      '@duckdb/node-bindings',
      '@duckdb/node-bindings-darwin-arm64',
    ],
  },
  plugins: [tanstackStart(), viteReact()],
})

export default config
