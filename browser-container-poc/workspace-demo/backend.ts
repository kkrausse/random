/** Tiny application-owned backend. State lives for the server lifetime, outside the workspace. */
export function createBackend() {
  let count = 0;
  return async (request: Request): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
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
