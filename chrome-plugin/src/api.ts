import { modelFromJson, messageFromJson } from "./common";
import type { Message, Model, Settings } from "./common";

interface ApiResponse<T> {
  data: T;
}

interface ApiSession {
  id: string;
  title?: string;
  time?: { updated?: number };
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
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(120_000),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
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
}
