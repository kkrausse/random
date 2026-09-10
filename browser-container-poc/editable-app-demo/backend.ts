/** Tiny application-owned backend. State lives for the server lifetime, outside the workspace. */
export function createBackend() {
  let count = 0;
  const todos = new Map<string, { id: string; title: string; completed: boolean }>();
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return async (request: Request): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    if (path === "/api/todos" || path.startsWith("/api/todos/")) {
      const id = path.slice("/api/todos/".length);
      const collection = path === "/api/todos";
      const allowed = collection ? "GET, POST" : "PATCH, DELETE";
      if (!allowed.split(", ").includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: allowed } });
      if (collection && request.method === "GET") return json({ todos: [...todos.values()] });
      const todo = collection ? undefined : todos.get(id);
      if (!collection && !todo) return json({ error: "Todo not found" }, 404);
      if (request.method === "DELETE") { todos.delete(id); return new Response(null, { status: 204 }); }
      const value = await request.json().catch(() => null);
      if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "Expected a JSON object" }, 400);
      if (collection || "title" in value) {
        if (typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 200) return json({ error: "Title must contain 1–200 characters" }, 400);
      }
      if ("completed" in value && typeof value.completed !== "boolean") return json({ error: "Completed must be a boolean" }, 400);
      if (!collection && !("title" in value) && !("completed" in value)) return json({ error: "Provide title or completed" }, 400);
      const updated = collection
        ? { id: crypto.randomUUID(), title: value.title.trim(), completed: false }
        : { ...todo!, ...("title" in value ? { title: value.title.trim() } : {}), ...("completed" in value ? { completed: value.completed } : {}) };
      todos.set(updated.id, updated);
      return json({ todo: updated }, collection ? 201 : 200);
    }
    if (path === "/api/counter") {
      if (request.method === "POST") {
        const value = await request.json().catch(() => null);
        if (!Number.isSafeInteger(value?.count)) return new Response("Invalid count", { status: 400 });
        count = value.count;
      } else if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return Response.json({ count }, { headers: { "Cache-Control": "no-store", "Set-Cookie": "counter-session=local-fixture; Path=/; HttpOnly; SameSite=Lax" } });
    }
    if (path === "/api/echo") return new Response(request.body, { status: 207, headers: { "Content-Type": request.headers.get("content-type") ?? "application/octet-stream", "X-Echo-Method": request.method, "X-Echo-Header": request.headers.get("x-test") ?? "", "X-Echo-Cookie": request.headers.get("cookie") ?? "" } });
    if (path === "/api/stream") {
      let timer: ReturnType<typeof setTimeout>;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("first\n")); timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode("second\n")); controller.close(); }, 300); },
        cancel() { clearTimeout(timer); },
      }), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Backend": "host" } });
    }
  };
}
