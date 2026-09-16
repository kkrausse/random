import { prepareBrowserEditor, readTailwindWasmCandidate } from '@kev-browser-agent-kit/opencode-chat/prepare'
import { resolve } from 'node:path'

const candidate = process.env.OPENCODE_PACKAGE_DIR
if (!candidate) throw Error('Set OPENCODE_PACKAGE_DIR to the qualified OpenCode 2.0.3 root containing build-receipt.json')
const receipt = process.env.TAILWIND_CANDIDATE_RECEIPT
const digest = process.env.TAILWIND_CANDIDATE_SHA256
if (!!receipt !== !!digest) throw Error('Set both TAILWIND_CANDIDATE_RECEIPT and TAILWIND_CANDIDATE_SHA256 to select a source-built backend')
const backend = receipt ? readTailwindWasmCandidate(resolve(receipt), digest!) : undefined

await prepareBrowserEditor({
  appRoot: import.meta.dirname,
  output: resolve('.editor'),
  runtimeDirectory: resolve(process.env.RUNTIME_DIR ?? '../workspace-api/dist/runtime'),
  openCodeDirectory: resolve(candidate),
  backendArchives: backend ? [{
    override: backend.packageName, packageName: backend.packageName, version: backend.packageVersion,
    archivePath: backend.archive.path, sha256: backend.archive.sha256, sha512: backend.archive.sha512,
    source: { repository: backend.source.repository, revision: backend.source.revision, buildReceiptSha256: backend.receiptSha256 },
  }] : undefined,
  source: ['src', 'vite.config.ts', 'react-router.config.ts', 'tsconfig.json'],
})
