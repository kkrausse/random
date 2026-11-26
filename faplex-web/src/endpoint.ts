// Where faplex's server is and how to sign requests. On faplex's own site: same origin, cookie
// (defaults below, nothing changes). Inside another app (<FaplexEmbed>, src/embed): the server's
// address and a token from the access key, sent as a header (fetch) or ?auth= (WebSocket).
let base = "";
let token: string | null = null;
let unauthorized: (() => void) | null = null;

export const embedded = () => base !== "";

export function configureEndpoint(opts: { base: string; token: string | null; onUnauthorized: () => void }) {
  base = opts.base.replace(/\/+$/, "");
  token = opts.token;
  unauthorized = opts.onUnauthorized;
}

export const apiUrl = (path: string) => base + path;

export function wsUrl(path: string) {
  const u = new URL(apiUrl(path), location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (token) u.searchParams.set("auth", token);
  return u.href;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const r = await fetch(apiUrl(path), { ...init, headers });
  if (r.status === 401 && token) unauthorized?.();
  return r;
}

/** Signed out (on our own site: the sign-in page; embedded: the host shows the key form). */
export function signedOut() {
  if (embedded()) unauthorized?.();
  else location.reload();
}
