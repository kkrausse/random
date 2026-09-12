import { PreparedBrowserEditor } from '@kev-browser-agent-kit/opencode-chat/editor'
import '@kev-browser-agent-kit/opencode-chat/editor.css'

const hostPaths = ['/api']
const isPreviewReady = (frame: HTMLIFrameElement) => !!frame.contentDocument?.querySelector('main input#title:not(:disabled)')

export default function EditorPanel({ onExit }: { onExit(): void }) {
  return <PreparedBrowserEditor hostPaths={hostPaths}
    initialPath="/src/home.tsx" isPreviewReady={isPreviewReady} onExit={onExit} />
}
