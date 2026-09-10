import { createChatController } from "./controller";
import type { ChatController } from "./types";
import type { Service, WorkspaceController } from "@kev-browser-agent-kit/workspace/react";

export interface WorkspaceChatOptions { serviceName?: string; directory?: string }
const chats = new WeakMap<Service, ChatController>();
export function chatFor(service: Service) { return chats.get(service); }
/** Attach once per service lifetime. The workspace stops clients before servers. */
export async function attachChat(owner: WorkspaceController, service: Service, options: WorkspaceChatOptions = {}) {
  const name = options.serviceName ?? "chat";
  const signal = owner.signal;
  signal.throwIfAborted();
  let chat = chats.get(service);
  if (!chat) {
    chat = createChatController({
      endpoint: { url: service.connection.url, fetch: (input, init) => service.connection.fetch(input, init) },
      directory: options.directory ?? "/workspace", autoCreateSession: false,
    });
    chats.set(service, chat);
    const current = chat;
    const release = owner.registerAttachment(name, () => {
      signal.removeEventListener("abort", aborted);
      chats.delete(service); current.dispose();
    });
    function aborted() { release(); }
    signal.addEventListener("abort", aborted, { once: true });
  }
  try {
    await chat.ready;
    signal.throwIfAborted();
    if (chats.get(service) === chat) owner.clientReady(name);
    return chat;
  } catch (error) {
    if (chats.get(service) === chat) owner.clientFailed(name, error);
    throw error;
  }
}

/** StrictMode-safe admission and serialized close/start on a reusable controller. */
const closing = new WeakMap<WorkspaceController, Promise<void>>();
export function editorLifecycle(controller: WorkspaceController, start: (controller: WorkspaceController) => Promise<void>, beforeClose: () => Promise<void> = async () => {}) {
  let cancelled = false, admitted = false;
  queueMicrotask(() => {
    if (cancelled) return;
    admitted = true;
    void (async () => {
      await closing.get(controller);
      if (cancelled) return;
      await controller.cancelAndClose();
      if (!cancelled) await controller.run("Start editing", () => start(controller));
    })().catch(error => controller.reportError(error));
  });
  return () => {
    cancelled = true;
    if (admitted) {
      const task = beforeClose().catch(error => controller.reportError(error)).then(() => controller.cancelAndClose());
      closing.set(controller, task);
      void task.catch(error => controller.reportError(error));
    }
  };
}
