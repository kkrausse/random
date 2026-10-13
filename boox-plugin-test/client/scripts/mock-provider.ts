// Fake OpenAI-compatible chat-completions server, so the client can be exercised without any real
// model. It answers every request itself and never contacts a network.
//
// Directives inside the latest user message steer the reply:
//   [[slow]]                    stream for ~30 s (for interrupt tests)
//   [[reasoning]]               emit reasoning deltas before the text
//   [[tool:NAME {"json":"args"}]] call a tool once, then answer after its result arrives
//   [[fail]]                    answer with HTTP 500

export interface MockRequest {
  path: string;
  model: string;
  tools: string[];
  lastUserText: string;
}

export interface MockProvider {
  url: string;
  requests: MockRequest[];
  stop: () => void;
}

interface ChatMessage {
  role: string;
  content?: string | Array<{ type: string; text?: string }> | null;
}

function textOf(message: ChatMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return (message.content || []).map((part) => part.text || "").join("");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startMockProvider(port = 0): MockProvider {
  const requests: MockRequest[] = [];
  const encoder = new TextEncoder();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 120,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/chat/completions")) {
        requests.push({ path: `${request.method} ${path}`, model: "", tools: [], lastUserText: "" });
        return new Response(JSON.stringify({ error: { message: `mock provider: no route ${path}` } }),
          { status: 404, headers: { "content-type": "application/json" } });
      }
      const body = await request.json() as {
        model: string;
        stream?: boolean;
        messages: ChatMessage[];
        tools?: Array<{ function?: { name: string } }>;
      };
      const lastUser = textOf(body.messages.filter((message) => message.role === "user").pop());
      const lastRole = body.messages.at(-1)?.role;
      requests.push({
        path,
        model: body.model,
        tools: (body.tools || []).map((tool) => tool.function?.name || "?"),
        lastUserText: lastUser
      });
      if (lastUser.includes("[[fail]]")) {
        return new Response(JSON.stringify({ error: { message: "mock provider failure" } }),
          { status: 500, headers: { "content-type": "application/json" } });
      }

      const id = `chatcmpl-mock-${requests.length}`;
      const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra = {}) =>
        encoder.encode(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }], ...extra
        })}\n\n`);
      const usage = {
        prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 5 }
      };
      const tool = lastUser.match(/\[\[tool:(\w+)\s*(\{.*?\})?\]\]/);
      const slow = lastUser.includes("[[slow]]");
      const words = slow
        ? Array.from({ length: 300 }, (_, index) => `slow${index} `)
        : "Mock reply: the **highlighted passage** was received. Pip pip!".split(/(?<= )/);

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(chunk({ role: "assistant", content: "" }));
            if (tool && lastRole !== "tool") {
              controller.enqueue(chunk({ tool_calls: [{
                index: 0, id: `call_mock_${requests.length}`, type: "function",
                function: { name: tool[1], arguments: tool[2] || "{}" }
              }] }));
              controller.enqueue(chunk({}, "tool_calls"));
            } else {
              if (lastUser.includes("[[reasoning]]")) {
                for (const word of ["Pondering ", "the ", "passage."]) {
                  controller.enqueue(chunk({ reasoning_content: word }));
                  await sleep(20);
                }
              }
              for (const word of words) {
                if (request.signal.aborted) break;
                controller.enqueue(chunk({ content: word }));
                await sleep(slow ? 100 : 20);
              }
              controller.enqueue(chunk({}, "stop"));
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
              model: body.model, choices: [], usage
            })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            // The server hung up (interrupt); nothing left to send.
          }
        }
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, requests, stop: () => server.stop(true) };
}

if (import.meta.main) {
  const provider = startMockProvider(Number(process.env.MOCK_PROVIDER_PORT || 0));
  console.log(`mock provider listening on ${provider.url}`);
}
