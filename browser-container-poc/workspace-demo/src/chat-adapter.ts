import { mountOpenCodeClient } from "../../opencode-client-demo/src/client";

/** Types come directly from the independently owned component's export. */
export type ChatOptions = NonNullable<Parameters<typeof mountOpenCodeClient>[1]>;
export type ChatMount = ReturnType<typeof mountOpenCodeClient>;
export async function mountChat(container: HTMLElement, options: ChatOptions): Promise<ChatMount> {
  return mountOpenCodeClient(container, options);
}
