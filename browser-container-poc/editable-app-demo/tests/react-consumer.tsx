import { renderToStaticMarkup } from "react-dom/server";
import { createChatController } from "@kev-browser-agent-kit/opencode-chat";
import { ChatView } from "@kev-browser-agent-kit/opencode-chat/react";
// Deliberate unavailable endpoint: SSR exercises the public peer dependency and
// visible empty/error view, not a guest connection.
const controller = createChatController({ directory: "/workspace", endpoint: { url: "https://fixture.invalid", fetch: async () => new Response(null, { status: 503 }) } });
await controller.ready.catch(() => {});
console.log(renderToStaticMarkup(<ChatView controller={controller} showModels showSessions />));
controller.dispose();
