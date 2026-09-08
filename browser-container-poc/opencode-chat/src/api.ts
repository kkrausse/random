import type {
  ModelRef,
  SessionInfo,
  SessionMessageInfo as Message,
  V2Event as NativeEvent,
} from "./vendor/types";
export type { ModelRef, SessionInfo, Message, NativeEvent };
export interface ClientEndpoint {
  url: string;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface ModelInfo extends ModelRef {
  id: string;
  name: string;
  enabled: boolean;
}
export interface Page<T> {
  data: T[];
  cursor: { next?: string | null };
}

/** Deliberately has no default URL or native-service discovery. */
export class OpenCodeAPI {
  constructor(
    readonly endpoint: ClientEndpoint,
    readonly directory = "/workspace",
  ) {}
  async response(path: string, init: RequestInit = {}) {
    const base = new URL(this.endpoint.url);
    base.hash = "";
    base.pathname = base.pathname.replace(/\/$/, "") + "/";
    const url = new URL(`api/${path}`, base);
    // Preserve caller routing/auth query values while allowing API pagination
    // and filters to supply their own values. Fetch remains caller-owned.
    for (const key of new Set(base.searchParams.keys())) {
      if (!url.searchParams.has(key))
        for (const value of base.searchParams.getAll(key)) url.searchParams.append(key, value);
    }
    const response = await this.endpoint.fetch(
      url.href,
      init,
    );
    if (!response.ok)
      throw new Error(
        `OpenCode HTTP ${response.status}: ${(await response.text()).slice(0, 1500)}`,
      );
    return response;
  }
  async request<T>(
    path: string,
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    const response = await this.response(path, {
      signal,
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return response.status === 204 ? (undefined as T) : response.json();
  }
  async pages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined | null;
    const seen = new Set<string>();
    do {
      const url = new URL(path, "https://placeholder.invalid/");
      if (cursor) {
        url.searchParams.delete("order");
        url.searchParams.set("cursor", cursor);
      }
      const page = await this.request<Page<T>>(
        url.pathname.slice(1) + url.search,
        signal,
      );
      if (!Array.isArray(page.data) || !page.cursor)
        throw new Error("Invalid V2 paginated response");
      items.push(...page.data);
      cursor = page.cursor.next;
      if (cursor && seen.has(cursor))
        throw new Error("Repeated V2 pagination cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
  list(signal?: AbortSignal) {
    return this.pages<SessionInfo>(
      `session?directory=${encodeURIComponent(this.directory)}&order=desc`,
      signal,
    );
  }
  history(id: string, signal?: AbortSignal) {
    return this.pages<Message>(
      `session/${encodeURIComponent(id)}/message?order=asc`,
      signal,
    );
  }
  async models(signal?: AbortSignal) {
    const location = `location[directory]=${encodeURIComponent(this.directory)}`;
    // Matched V2 model.default awaits catalog activation; model.list alone can
    // return an empty catalog immediately after the first Location is created.
    await this.request(`model/default?${location}`, signal);
    return (
      await this.request<{ data: ModelInfo[] }>(`model?${location}`, signal)
    ).data;
  }
  async create(title: string, signal?: AbortSignal) {
    return (
      await this.request<{ data: SessionInfo }>("session", signal, {
        title: title || undefined,
        location: { directory: this.directory },
      })
    ).data;
  }
  model(id: string, model: ModelRef, signal?: AbortSignal) {
    return this.request(`session/${encodeURIComponent(id)}/model`, signal, {
      model,
    });
  }
  prompt(id: string, text: string, signal?: AbortSignal) {
    return this.request(`session/${encodeURIComponent(id)}/prompt`, signal, {
      text,
    });
  }
  interrupt(id: string, signal?: AbortSignal) {
    return this.response(`session/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
      signal,
    });
  }
  async events(
    signal: AbortSignal,
    ready: () => void,
    event: (value: NativeEvent) => void,
  ) {
    const response = await this.response("event", {
      signal,
      headers: { Accept: "text/event-stream" },
    });
    if (
      !response.headers.get("content-type")?.includes("text/event-stream") ||
      !response.body
    )
      throw new Error("Expected V2 SSE response");
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    const decoder = new TextDecoder();
    let buffer = "",
      data: string[] = [],
      kind = "";
    const line = (text: string) => {
      if (!text) {
        if (data.length) {
          if (kind === "effect/httpapi/stream/failure")
            throw new Error(`V2 event stream failed: ${data.join("\n")}`);
          const value = JSON.parse(data.join("\n")) as NativeEvent;
          if (typeof value.type !== "string" || !value.data)
            throw new Error("Invalid V2 event envelope");
          if (value.type === "server.connected") ready();
          event(value);
        }
        data = [];
        kind = "";
      } else if (text.startsWith("data:"))
        data.push(text.slice(5).replace(/^ /, ""));
      else if (text.startsWith("event:")) kind = text.slice(6).trim();
    };
    try {
      signal.throwIfAborted();
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, newline).replace(/\r$/, ""));
          buffer = buffer.slice(newline + 1);
        }
      }
      if (!signal.aborted)
        throw new Error(
          "OpenCode event connection closed. Reconnect to reload history.",
        );
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
