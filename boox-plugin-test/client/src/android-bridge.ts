// Android entry point. Built by build-android.ts into one classic script
// (app/src/main/assets/reading-client.js) that the app loads in a hidden WebView whose page base URL
// is the OpenCode server, so every fetch here is same-origin.
//
// Java -> JS:  window.ReadingBridge.call(callId, method, argsJson)
// JS -> Java:  window.AndroidHost.resolve(callId, resultJson)
//              window.AndroidHost.reject(callId, errorMessage)
//              window.AndroidHost.event(subscriptionId, eventJson)
//
// The contract is documented in client/README.md.

import { createReadingClient } from "./index";
import type { ConnectionConfig, ModelRef, ReadingClient, Subscription } from "./index";

interface AndroidHost {
  resolve: (callId: string, resultJson: string) => void;
  reject: (callId: string, errorMessage: string) => void;
  event: (subscriptionId: string, eventJson: string) => void;
}

interface ReadingBridge {
  call: (callId: string, method: string, argsJson: string) => void;
}

declare global {
  interface Window {
    AndroidHost: AndroidHost;
    ReadingBridge: ReadingBridge;
  }
}

interface CallArgs {
  baseUrl?: string;
  password?: string;
  directory?: string;
  sessionId?: string;
  subscriptionId?: string;
  pendingMessageId?: string;
  readyTimeoutMs?: number;
  text?: string;
  title?: string;
  limit?: number;
  model?: ModelRef;
}

// The official client needs this ES2024 helper; older Android System WebViews lack it.
const promiseStatics = Promise as unknown as { withResolvers?: () => unknown };
if (!promiseStatics.withResolvers) {
  promiseStatics.withResolvers = () => {
    let resolve: (value: unknown) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    return { promise, resolve, reject };
  };
}

let client: ReadingClient | null = null;
const subscriptions = new Map<string, Subscription>();

function closeSubscription(subscriptionId: string) {
  subscriptions.get(subscriptionId)?.close();
  subscriptions.delete(subscriptionId);
}

function required(args: CallArgs, name: "sessionId" | "subscriptionId" | "text"): string {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing argument: ${name}`);
  return value;
}

function configured(): ReadingClient {
  if (!client) throw new Error("Call configure first.");
  return client;
}

async function dispatch(method: string, args: CallArgs): Promise<unknown> {
  switch (method) {
    case "configure": {
      for (const subscriptionId of [...subscriptions.keys()]) closeSubscription(subscriptionId);
      const config: ConnectionConfig = {
        baseUrl: args.baseUrl || window.location.origin,
        password: args.password || "",
        directory: args.directory || ""
      };
      client = createReadingClient(config);
      return { configured: true };
    }
    case "checkConnection":
      return configured().checkConnection();
    case "listModels":
      return configured().listModels();
    case "listSessions":
      return configured().listSessions(args.limit ? { limit: args.limit } : undefined);
    case "createSession":
      return configured().createSession({ model: args.model, title: args.title });
    case "getSession":
      return configured().getSession(required(args, "sessionId"));
    case "setModel":
      if (!args.model) throw new Error("Missing argument: model");
      await configured().setModel(required(args, "sessionId"), args.model);
      return null;
    case "sendPrompt":
      return configured().sendPrompt(required(args, "sessionId"), required(args, "text"));
    case "interrupt":
      return configured().interrupt(required(args, "sessionId"));
    case "listMessages":
      return configured().listMessages(required(args, "sessionId"));
    case "loadConversation":
      return configured().loadConversation(required(args, "sessionId"),
        args.pendingMessageId ? { pendingMessageId: args.pendingMessageId } : undefined);
    case "subscribe": {
      const subscriptionId = required(args, "subscriptionId");
      const sessionId = required(args, "sessionId");
      closeSubscription(subscriptionId);
      const subscription = configured().subscribe(sessionId, (event) => {
        // A late event from a replaced or closed subscription must not reach Java.
        if (subscriptions.get(subscriptionId) !== subscription) return;
        window.AndroidHost.event(subscriptionId, JSON.stringify(event));
      });
      subscriptions.set(subscriptionId, subscription);
      // Resolve once events are flowing, so a prompt sent next cannot outrun the stream. A slow
      // connection resolves anyway; the subscription keeps connecting in the background.
      const connected = await Promise.race([
        subscription.ready,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), args.readyTimeoutMs ?? 5_000))
      ]);
      return { connected };
    }
    case "unsubscribe":
      closeSubscription(required(args, "subscriptionId"));
      return null;
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

window.ReadingBridge = {
  call(callId, method, argsJson) {
    void (async () => {
      try {
        const args = (argsJson ? JSON.parse(argsJson) : {}) as CallArgs;
        const result = await dispatch(method, args || {});
        window.AndroidHost.resolve(callId, JSON.stringify(result === undefined ? null : result));
      } catch (error) {
        window.AndroidHost.reject(callId, error instanceof Error ? error.message : String(error));
      }
    })();
  }
};
