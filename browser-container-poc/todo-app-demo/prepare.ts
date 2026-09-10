import { prepareBrowserEditor } from '@kev-browser-agent-kit/opencode-chat/prepare'
import { resolve } from 'node:path'

await prepareBrowserEditor({
  appRoot: import.meta.dirname,
  output: resolve('.editor'),
  runtimeDirectory: resolve(process.env.RUNTIME_DIR ?? '../workspace-api/dist/runtime'),
  openCodeDirectory: resolve(process.env.OPENCODE_PACKAGE_DIR ?? '../vivari/.runtime/opencode-v2-package'),
  source: ['src', 'vite.config.ts', 'react-router.config.ts', 'tsconfig.json'],
})
