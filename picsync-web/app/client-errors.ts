export function createClientErrorHandler(log = (report: Record<string, unknown>) =>
  console.error("[PicSync] Browser photo failure", report)) {
  let windowStart = 0;
  let count = 0;
  return async (request: Request) => {
    const response = (status: number) => new Response(null, {
      status, headers: { "Cache-Control": "no-store" },
    });
    if (request.headers.get("content-type") !== "application/json") return response(415);
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      count = 0;
    }
    if (++count > 60) return response(429);
    const reader = request.body?.getReader();
    if (!reader) return response(400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return response(413);
        }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object") return response(400);
      const report: Record<string, unknown> = {};
      for (const [key, limit] of [["path", 1024], ["mode", 16], ["stage", 128], ["error", 4000], ["browser", 256]] as const) {
        if (typeof data[key] !== "string" || data[key].length > limit) return response(400);
        report[key] = data[key];
      }
      for (const key of ["bytes", "expectedBytes"] as const) {
        if (data[key] !== null && (!Number.isSafeInteger(data[key]) || data[key] < 0)) return response(400);
        report[key] = data[key];
      }
      log(report);
      return response(204);
    } catch {
      return response(400);
    } finally {
      reader.releaseLock();
    }
  };
}
