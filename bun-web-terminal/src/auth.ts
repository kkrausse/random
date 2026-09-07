import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const sessionLifetime = 30 * 24 * 60 * 60;
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class TerminalAuth {
  readonly secret = randomBytes(32).toString("base64url");
  private readonly signingKey = randomBytes(32);
  private readonly origins: Map<string, string>;

  constructor(port: number, publicUrl?: string) {
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    if (publicUrl) origins.push(new URL(publicUrl).origin);
    this.origins = new Map(origins.map((origin) => [new URL(origin).host, origin]));
  }

  // Host must be explicitly configured. Never trust client-supplied forwarded headers.
  private origin(request: Request, peer: string | undefined) {
    const origin = this.origins.get(new URL(request.url).host);
    if (!origin || (origin.startsWith("http:") && !loopback.has(peer ?? ""))) return;
    return origin;
  }

  isSameOrigin(request: Request, peer?: string) {
    const origin = this.origin(request, peer);
    return !!origin && (!request.headers.has("origin") || request.headers.get("origin") === origin);
  }

  private cookieName(origin: string) {
    return origin.startsWith("https:") ? "__Host-terminal-session" : `terminal-local-session-${new URL(origin).port}`;
  }

  private signature(payload: string, origin: string) {
    return createHmac("sha256", this.signingKey).update(`${origin}\n${payload}`).digest("base64url");
  }

  private authenticated(request: Request, origin: string) {
    const prefix = `${this.cookieName(origin)}=`;
    const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
    if (!cookie || cookie.length > 200) return false;
    const [expiry, nonce, signature, extra] = cookie.split(".");
    if (!expiry || !nonce || !signature || extra !== undefined || !/^\d+$/.test(expiry)) return false;
    return Number(expiry) > Date.now() && equal(signature, this.signature(`${expiry}.${nonce}`, origin));
  }

  // Runs before every application route, including assets and WebSocket upgrades.
  async guard(request: Request, peer?: string): Promise<Response | undefined> {
    const origin = this.origin(request, peer);
    if (!origin || !this.isSameOrigin(request, peer)) return this.response("Forbidden", 403);
    const url = new URL(request.url);
    if (url.pathname === "/login" && request.method === "GET") return this.loginPage();
    // SameSite cookies can still accompany requests from a sibling tailnet host.
    // Reject those too, including navigation to the legacy GET /sessions/new route.
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
      return this.response("Forbidden", 403);
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (request.headers.get("origin") !== origin || request.headers.get("content-type") !== "text/plain") {
        return this.response("Forbidden", 403);
      }
      const reader = request.body?.getReader();
      if (!reader) return this.response("Invalid sign-in link", 401);
      let key = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (key.length + value.length > 128) {
            await reader.cancel();
            return this.response("Invalid sign-in link", 401);
          }
          key += Buffer.from(value).toString("latin1");
        }
      } catch {
        return this.response("Invalid sign-in link", 401);
      } finally {
        reader.releaseLock();
      }
      if (!equal(key, this.secret)) return this.response("Invalid sign-in link", 401);
      const payload = `${Date.now() + sessionLifetime * 1000}.${randomBytes(16).toString("base64url")}`;
      return this.response("Signed in", 200, {
        "set-cookie": `${this.cookieName(origin)}=${payload}.${this.signature(payload, origin)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime}${origin.startsWith("https:") ? "; Secure" : ""}`,
      });
    }
    if (this.authenticated(request, origin)) return;
    if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") && !request.headers.has("upgrade") && !url.pathname.startsWith("/api/")) {
      return this.response("Sign in", 303, { location: "/login" });
    }
    return this.response("Authentication required", 401);
  }

  private response(body: string, status: number, headers: Record<string, string> = {}) {
    return new Response(body, { status, headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...headers,
    } });
  }

  private loginPage() {
    const nonce = randomBytes(16).toString("base64url");
    return this.response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terminal sign-in</title></head>
<body><h1>Terminal sign-in</h1><p id="status">Open the sign-in link printed in the Mac's terminal, or scan its QR code.</p>
<script nonce="${nonce}">
async function signIn() {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  history.replaceState(null, "", "/login");
  if (!key) return;
  const status = document.getElementById("status");
  status.textContent = "Signing in…";
  await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: key, credentials: "same-origin" })
    .then(response => {
      if (!response.ok) throw new Error("This sign-in link is invalid or expired. Use the latest link from the Mac's terminal.");
      location.replace("/sessions");
    })
    .catch(error => { status.textContent = error.message; });
}
window.addEventListener("hashchange", signIn);
void signIn();
</script></body></html>`, 200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    });
  }
}
