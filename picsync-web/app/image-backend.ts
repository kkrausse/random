/** Keep transport/RAW development selectable without changing the viewer. */
export type ImageBackend = "server" | "browser";

export function imageBackend(search = typeof location === "undefined" ? "" : location.search): ImageBackend {
  return new URLSearchParams(search).get("decoder") === "browser" ? "browser" : "server";
}

export function renderURL(path: string, full: boolean, priority: number) {
  return `/api/render?${new URLSearchParams({ path, size: full ? "full" : "thumb", priority: String(priority) })}`;
}
