import { modelFromJson, messageFromJson } from "./common";
import type { Message, Model, ModelRef, Settings } from "./common";
import { recordDiagnostic } from "./diagnostics";

interface ApiSession {
  id: string;
  title?: string;
  time?: { updated?: number };
  model?: ModelRef;
}

export interface SessionEvent {
  type: string;
  properties?: {
    sessionID?: string;
    info?: {
      id: string;
      sessionID: string;
      role: "user" | "assistant";
      providerID?: string;
      modelID?: string;
      variant?: string;
      time?: { completed?: number };
    };
    messageID?: string;
    partID?: string;
    field?: string;
    part?: {
      id: string;
      sessionID: string;
      messageID: string;
      type: string;
      text?: string;
      tool?: string;
      state?: { status?: string };
    };
    delta?: string;
    status?: { type: string; message?: string };
    error?: unknown;
  };
}

interface ApiMessage {
  info: {
    id: string;
    role: "user" | "assistant";
    time: { completed?: number };
    providerID?: string;
    modelID?: string;
    variant?: string;
    cost?: number;
    tokens?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    };
  };
  parts: Array<{ type: string; text?: string }>;
}

export interface SessionUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export class OpenCodeClient {
  private baseUrl: string;
  private directory: string;
  private authorization: string;
  private model: { providerID: string; modelID: string };
  private variant: string;

  constructor(settings: Settings) {
    this.baseUrl = settings.serverUrl.replace(/\/+$/, "");
    this.directory = settings.directory.trim();
    this.model = { providerID: settings.modelProvider, modelID: settings.modelId };
    this.variant = settings.modelVariant.trim();
    if (settings.serverPassword) {
      const bytes = new TextEncoder().encode(`opencode:${settings.serverPassword.trim()}`);
      this.authorization = `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
    } else {
      this.authorization = "";
    }
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.authorization) headers.Authorization = this.authorization;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: AbortSignal.timeout(120_000),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      await recordDiagnostic("api-network-error", {
        method,
        path,
        message: String(error?.message || error)
      });
      throw error;
    }
    const text = await response.text();
    if (!response.ok) {
      await recordDiagnostic("api-http-error", { method, path, status: response.status });
      throw new Error(`OpenCode returned HTTP ${response.status}: ${text}`);
    }
    return text ? JSON.parse(text) as T : {} as T;
  }

  health() {
    return this.request("GET", "/global/health");
  }

  async models(): Promise<Model[]> {
    const directory = encodeURIComponent(this.directory);
    const response = await this.request<{
      providers: Array<{
        models: Record<string, Parameters<typeof modelFromJson>[0]>;
      }>;
    }>("GET", `/config/providers?directory=${directory}`);
    return response.providers.flatMap((provider) => Object.values(provider.models))
      .filter((model) => model.status === "active")
      .map(modelFromJson);
  }

  async sessions(): Promise<ApiSession[]> {
    const directory = encodeURIComponent(this.directory);
    const response = await this.request<ApiSession[]>("GET", `/session?directory=${directory}`);
    return response.slice(0, 50);
  }

  async createSession(): Promise<string> {
    const directory = encodeURIComponent(this.directory);
    const response = await this.request<{ id: string }>("POST", `/session?directory=${directory}`, {});
    return response.id;
  }

  sendMessage(sessionId: string, text: string): Promise<unknown> {
    const directory = encodeURIComponent(this.directory);
    const variant = this.variant ? { variant: this.variant } : {};
    return this.request("POST",
      `/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${directory}`, {
        model: this.model,
        ...variant,
        parts: [{ type: "text", text }]
      });
  }

  interruptSession(sessionId: string): Promise<unknown> {
    const directory = encodeURIComponent(this.directory);
    return this.request("POST", `/session/${encodeURIComponent(sessionId)}/abort?directory=${directory}`);
  }

  async messages(sessionId: string): Promise<Message[]> {
    return (await this.apiMessages(sessionId)).map(messageFromJson).filter(Boolean);
  }

  private apiMessages(sessionId: string): Promise<ApiMessage[]> {
    const directory = encodeURIComponent(this.directory);
    return this.request("GET",
      `/session/${encodeURIComponent(sessionId)}/message?directory=${directory}&limit=200`);
  }

  async sessionUsage(sessionId: string): Promise<SessionUsage> {
    const usage: SessionUsage = {
      input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0
    };
    for (const message of await this.apiMessages(sessionId)) {
      if (message.info.role !== "assistant") continue;
      const tokens = message.info.tokens || {};
      usage.input += tokens.input || 0;
      usage.output += tokens.output || 0;
      usage.reasoning += tokens.reasoning || 0;
      usage.cacheRead += tokens.cache?.read || 0;
      usage.cacheWrite += tokens.cache?.write || 0;
      usage.cost += message.info.cost || 0;
    }
    return usage;
  }

  async streamEvents(
    signal: AbortSignal,
    onEvent: (event: SessionEvent) => void,
    onOpen: () => void
  ): Promise<void> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.authorization) headers.Authorization = this.authorization;
    const directory = encodeURIComponent(this.directory);
    const response = await fetch(`${this.baseUrl}/event?directory=${directory}`, { headers, signal });
    if (!response.ok) {
      throw new Error(`OpenCode event stream returned HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.body) throw new Error("OpenCode event stream returned no response body.");
    onOpen();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const data = block.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onEvent(JSON.parse(data) as SessionEvent);
      }
      if (done) break;
    }
    if (!signal.aborted) throw new Error("OpenCode event stream disconnected.");
  }
}
