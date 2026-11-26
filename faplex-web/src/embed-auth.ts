// Sign-in for faplex shown inside the Walks app (walk-planner): Walks puts faplex in an iframe on
// its own page, where iOS blocks faplex's sign-in cookie (another site's frame). So there:
// - the app shell (index.html with ?embed=walks, and the built JS / CSS) loads without a cookie;
//   it is only client code, and frame-ancestors lets only faplex itself and the Walks app frame it;
// - the access key, typed once into faplex's own form (password managers can fill it), is swapped
//   for a signed token that the page keeps and sends as a header (fetch) or ?auth= (WebSocket).
//   Walks never sees the key or the token (cross-origin frame), and a token is never sent by the
//   browser on its own, so other sites can't use it.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const lifetimeMs = 90 * 24 * 3600_000;

export function createEmbedAuth(secret: string, signingKeyB64: string) {
  const key = Buffer.from(signingKeyB64, "base64url");
  const sign = (payload: string) => createHmac("sha256", key).update(`walks-embed\n${payload}`).digest("base64url");
  const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  return {
    /** The access key → a token, or undefined if the key is wrong. */
    issue(accessKey: string) {
      if (!equal(accessKey, secret)) return;
      const payload = `${Date.now() + lifetimeMs}.${randomBytes(16).toString("base64url")}`;
      return `${payload}.${sign(payload)}`;
    },
    valid(token: string | null | undefined) {
      if (!token || token.length > 200) return false;
      const [expiry, nonce, sig, extra] = token.split(".");
      if (!expiry || !nonce || !sig || extra !== undefined || !/^\d+$/.test(expiry)) return false;
      return Number(expiry) > Date.now() && equal(sig, sign(`${expiry}.${nonce}`));
    },
  };
}
