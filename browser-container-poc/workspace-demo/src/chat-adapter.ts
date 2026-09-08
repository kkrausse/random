import { mountOpenCodeClient } from "../../opencode-client-demo/src/client";

/** Interim replaceable chat slot. The standalone @vivari/opencode-chat package
 * can replace this mount after its independent owner finishes. Keep endpoint,
 * caller directory and ready/dispose ownership here, never in workspace React/core.
 * Types currently come directly from the existing component's export. */
export type ChatOptions = NonNullable<Parameters<typeof mountOpenCodeClient>[1]>;
export type ChatMount = ReturnType<typeof mountOpenCodeClient>;
export async function mountChat(container: HTMLElement, options: ChatOptions): Promise<ChatMount> {
  return mountOpenCodeClient(container, options);
}
