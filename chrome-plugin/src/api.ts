import { modelFromJson, messageFromJson } from "./common";
import type { Message, Model, ModelRef, Settings } from "./common";
import { recordDiagnostic } from "./diagnostics";

interface ApiResponse<T> {
  data: T;
}

interface ApiSession {
  id: string;
  title?: string;
  time?: { updated?: number };
  model?: ModelRef;
}

export interface SessionEvent {
  type: string;
  data?: {
    sessionID?: string;
    assistantMessageID?: string;
    delta?: string;
    name?: string;
    model?: ModelRef;
  };
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

  constructor(settings: Settings) {
    this.baseUrl = settings.serverUrl.replace(/\/+$/, "");
    this.directory = settings.directory.trim();
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
    return this.request("GET", "/api/health");
  }

  async models(): Promise<Model[]> {
    const location = encodeURIComponent(this.directory);
    const response = await this.request<ApiResponse<Parameters<typeof modelFromJson>[0][]>>(
      "GET", `/api/model?location%5Bdirectory%5D=${location}`);
    return response.data.filter((model) => model.enabled && model.status === "active")
      .map(modelFromJson);
  }

  async sessions(): Promise<ApiSession[]> {
    const directory = encodeURIComponent(this.directory);
    const response = await this.request<ApiResponse<ApiSession[]>>(
      "GET", `/api/session?limit=50&order=desc&directory=${directory}`);
    return response.data;
  }

  async createSession(settings: Settings): Promise<string> {
    const model: { providerID: string; id: string; variant?: string } = {
      providerID: settings.modelProvider,
      id: settings.modelId
    };
    if (settings.modelVariant) model.variant = settings.modelVariant;
    const response = await this.request<ApiResponse<{ id: string }>>("POST", "/api/session", {
      location: { directory: this.directory },
      model
    });
    return response.data.id;
  }

  sendMessage(sessionId: string, text: string): Promise<unknown> {
    return this.request("POST", `/api/session/${encodeURIComponent(sessionId)}/prompt`, { text });
  }

  async messages(sessionId: string): Promise<Message[]> {
    const response = await this.request<ApiResponse<Parameters<typeof messageFromJson>[0][]>>("GET",
      `/api/session/${encodeURIComponent(sessionId)}/message?limit=200&order=desc`);
    return response.data.reverse().map(messageFromJson).filter(Boolean);
  }

  async sessionUsage(sessionId: string): Promise<SessionUsage> {
    const response = await this.request<ApiResponse<{
      cost?: number;
      tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
      };
    }>>("GET", `/api/session/${encodeURIComponent(sessionId)}`);
    const tokens = response.data.tokens || {};
    return {
      input: tokens.input || 0,
      output: tokens.output || 0,
      reasoning: tokens.reasoning || 0,
      cacheRead: tokens.cache?.read || 0,
      cacheWrite: tokens.cache?.write || 0,
      cost: response.data.cost || 0
    };
  }

  async streamEvents(
    signal: AbortSignal,
    onEvent: (event: SessionEvent) => void,
    onOpen: () => void
  ): Promise<void> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.authorization) headers.Authorization = this.authorization;
    const response = await fetch(`${this.baseUrl}/api/event`, { headers, signal });
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
