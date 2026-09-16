import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type { Credentials } from "./credentials";

const lifetime = 30 * 24 * 60 * 60;
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Storage is supplied by the server; the guard itself does not access Keychain.
export class PicSyncAuth {
  readonly secret: string;
  private readonly signingKey: Buffer;
  private readonly origins: Map<string, string>;

  constructor(port: number, publicUrl: string | undefined, credentials: Credentials) {
    this.secret = credentials.secret;
    this.signingKey = Buffer.from(credentials.signingKey, "base64url");
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    if (publicUrl) {
      const url = new URL(publicUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("PICSYNC_PUBLIC_URL must be an HTTPS origin without credentials, path, query, or fragment");
      }
      origins.push(url.origin);
    }
    this.origins = new Map(origins.map(origin => [new URL(origin).host, origin]));
  }

  private cookieName(origin: string) {
    return origin.startsWith("https:") ? "__Host-picsync-session" : `picsync-local-session-${new URL(origin).port}`;
  }

  private signature(payload: string, origin: string) {
    return createHmac("sha256", this.signingKey).update(`${origin}\n${payload}`).digest("base64url");
  }

  sessionStatus(request: Request) {
    const origin = this.origins.get(new URL(request.url).host);
    if (!origin) return "untrusted-host";
    const prefix = `${this.cookieName(origin)}=`;
    const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length);
    if (!cookie) return "missing";
    if (cookie.length > 200) return "malformed";
    const [expiry, nonce, signature, extra] = cookie.split(".");
    if (!expiry || !nonce || !signature || extra !== undefined || !/^\d+$/.test(expiry)) return "malformed";
    if (Number(expiry) <= Date.now()) return "expired";
    return equal(signature, this.signature(`${expiry}.${nonce}`, origin)) ? "valid" : "invalid-signature";
  }

  // Called before ALL application handling, including assets and conditional requests.
  async guard(request: Request, peer?: string): Promise<Response | undefined> {
    const url = new URL(request.url);
    const origin = this.origins.get(url.host);
    if (!origin || (origin.startsWith("http:") && !loopback.has(peer ?? ""))
      || (request.headers.has("origin") && request.headers.get("origin") !== origin)) {
      return this.response("Forbidden", 403);
    }
    if (url.pathname === "/login" && request.method === "GET") return this.loginPage();
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
      return this.response("Forbidden", 403);
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (request.headers.get("origin") !== origin || request.headers.get("content-type") !== "text/plain") {
        return this.response("Forbidden", 403);
      }
      const reader = request.body?.getReader();
      if (!reader) return this.response("Invalid sign-in code", 401);
      let key = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (key.length + value.length > 128) {
            await reader.cancel();
            return this.response("Invalid sign-in code", 401);
          }
          key += Buffer.from(value).toString("latin1");
        }
      } catch {
        return this.response("Invalid sign-in code", 401);
      } finally {
        reader.releaseLock();
      }
      if (!equal(key, this.secret)) return this.response("Invalid sign-in code", 401);
      const payload = `${Date.now() + lifetime * 1000}.${randomBytes(16).toString("base64url")}`;
      return this.response("Signed in", 200, {
        "set-cookie": `${this.cookieName(origin)}=${payload}.${this.signature(payload, origin)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${origin.startsWith("https:") ? "; Secure" : ""}`,
      });
    }
    if (this.sessionStatus(request) === "valid") return;
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PicSync sign-in</title></head>
<body><h1>PicSync sign-in</h1><p id="status">Open the sign-in link printed in the server's terminal, or scan its QR code.</p>
<script nonce="${nonce}">
async function signIn() {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  history.replaceState(null, "", "/login");
  if (!key) return;
  const status = document.getElementById("status");
  status.textContent = "Signing in…";
  await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: key, credentials: "same-origin" })
    .then(response => {
      if (!response.ok) throw new Error("Invalid or expired sign-in link. Use the latest link from the server's terminal.");
      location.replace("/");
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

  async printSignIn(origin: string) {
    const url = new URL("/login", origin);
    url.hash = new URLSearchParams({ key: this.secret }).toString();
    console.log(`PicSync sign-in: ${url.href}`);
    console.log("This link grants gallery access. To revoke access: stop the server, run bun run auth:reset with the same PORT, then start it again.");
    console.log(await QRCode.toString(url.href, { type: "terminal", small: true }));
  }
}
