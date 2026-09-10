import { BrowserEditor } from '@kev-browser-agent-kit/opencode-chat/editor'
import { createBrowserEditorRecipe } from '@kev-browser-agent-kit/opencode-chat/recipe'
import { WorkspaceProvider, useWorkspace } from '@kev-browser-agent-kit/workspace/react'
import '@kev-browser-agent-kit/opencode-chat/editor.css'

const recipe = createBrowserEditorRecipe()
const hostPaths = ['/api']

function Editor({ onExit }: { onExit(): void }) {
  const { controller } = useWorkspace()
  return <BrowserEditor controller={controller} recipe={recipe} hostPaths={hostPaths}
    initialPath="/src/home.tsx" onExit={onExit} />
}

export default function EditorPanel(props: { onExit(): void }) {
  return <WorkspaceProvider><Editor {...props} /></WorkspaceProvider>
}
