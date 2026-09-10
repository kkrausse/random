import { BrowserEditor } from "@kev-browser-agent-kit/opencode-chat/editor";
import { useWorkspace } from "@kev-browser-agent-kit/workspace/react";
import type { createSampleRecipe } from "./sample-recipe";

const hostPaths = ["/api"];
const isPreviewReady = (frame: HTMLIFrameElement) => !!frame.contentDocument?.getElementById("root")?.childElementCount;

/** App recipe wiring only; the package owns all mounted editing UI. */
export default function Editor({ exit, retry, recipe }: { exit(): void; retry(): void; recipe: ReturnType<typeof createSampleRecipe> }) {
  const { controller } = useWorkspace();
  return <BrowserEditor controller={controller} hostPaths={hostPaths} initialPath="/src/App.tsx"
    isPreviewReady={isPreviewReady} onExit={exit} onRetry={retry}
    onReset={() => controller.run("Reset source", () => recipe.reset(controller))} />;
}
