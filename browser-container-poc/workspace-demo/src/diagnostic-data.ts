export function safeText(value: string): string {
  return value.slice(0, 6000)
    .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, "$1 [redacted]")
    .replace(/((?:authorization|password|token|secret|api[_-]?key|cookie)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, "$1?[redacted]");
}
export function safeData(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[bounded]";
  if (value instanceof Error) return safeData({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, depth + 1);
  if (typeof value === "string") return safeText(value);
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => safeData(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, /authorization|cookie|password|token|secret|headers|body|prompt|source|contents|api[_-]?key/i.test(key) ? "[redacted]" : safeData(item, depth + 1)]));
  return String(value);
}
