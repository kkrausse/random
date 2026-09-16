// WASM bindings can throw plain objects or numeric codes, not just Errors.
export function errorMessage(error) {
  if (typeof error === "string") return error;
  if (error == null) return String(error);
  const seen = new WeakSet();
  try {
    const details = JSON.stringify(error, (_, value) => {
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        if (value instanceof Error)
          return Object.fromEntries(Object.getOwnPropertyNames(value).map(key => [key, value[key]]));
      }
      return typeof value === "bigint" ? String(value) : value;
    });
    return details?.slice(0, 4000) ?? String(error);
  } catch {
    return error.message || String(error);
  }
}
