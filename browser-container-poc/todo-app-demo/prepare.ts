import { prepareBrowserEditor } from '@kev-browser-agent-kit/opencode-chat/prepare'
import { resolve } from 'node:path'

const candidate = process.env.OPENCODE_PACKAGE_DIR
if (!candidate) throw Error('Set OPENCODE_PACKAGE_DIR to the qualified beta-19425 root containing build-receipt.json')

await prepareBrowserEditor({
  appRoot: import.meta.dirname,
  output: resolve('.editor'),
  runtimeDirectory: resolve(process.env.RUNTIME_DIR ?? '../workspace-api/dist/runtime'),
  openCodeDirectory: resolve(candidate),
  source: ['src', 'vite.config.ts', 'react-router.config.ts', 'tsconfig.json'],
})
