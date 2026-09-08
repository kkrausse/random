import { createChatController, type ChatController } from "@vivari/opencode-chat";
import type { Service, WorkspaceController } from "@vivari/workspace-api/react";

// Endpoint lifetime, not React/panel lifetime. The recipe attaches once; views
// only subscribe. Workspace release/reset disposes the client before the server.
const chats = new WeakMap<Service, ChatController>();
export function chatFor(service: Service): ChatController | undefined { return chats.get(service); }
export async function attachChat(owner: WorkspaceController, service: Service) {
  owner.signal.throwIfAborted();
  let chat = chats.get(service);
  if (!chat) {
    chat = createChatController({
      endpoint: { url: service.connection.url, fetch: (input, init) => service.connection.fetch(input, init) },
      directory: "/workspace",
      autoCreateSession: false,
    });
    chats.set(service, chat);
    const current = chat;
    const signal = owner.signal;
    const release = owner.registerAttachment("chat", () => {
      signal.removeEventListener("abort", aborted);
      chats.delete(service); current.dispose();
    });
    function aborted() { release(); }
    signal.addEventListener("abort", aborted, { once: true });
  }
  try {
    await chat.ready;
    owner.signal.throwIfAborted();
    if (chats.get(service) === chat) owner.clientReady("chat");
  } catch (error) {
    if (chats.get(service) === chat) owner.clientFailed("chat", error);
    throw error;
  }
}
