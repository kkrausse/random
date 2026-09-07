import { expect, spyOn, test } from "bun:test";
import { TerminalAuth } from "./auth";
import { signInUrl } from "./startup";

const local = "http://127.0.0.1:3000";
const remote = "https://terminal.tail.ts.net";
const peer = "127.0.0.1";
const fixture = () => new TerminalAuth(3000, remote);

async function login(auth: TerminalAuth, origin = local, key = auth.secret) {
  return (await auth.guard(new Request(`${origin}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "text/plain" }, body: key,
  }), peer))!;
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

test("all pages, APIs, assets and websocket paths require authentication", async () => {
  const auth = fixture();
  for (const path of ["/", "/sessions", "/sessions/new", "/terminal/$0", "/api/sessions", "/api/dictation/status", "/api/dictation/stream", "/ws/$0", "/client.js", "/ghostty-vt.wasm"]) {
    expect((await auth.guard(new Request(local + path), peer))?.status).toBe(401);
  }
  expect((await auth.guard(new Request(`${local}/sessions`, { headers: { accept: "text/html" } }), peer))?.headers.get("location")).toBe("/login");
  for (const method of ["POST", "PATCH", "DELETE"]) {
    expect((await auth.guard(new Request(`${local}/api/sessions`, { method }), peer))?.status).toBe(401);
  }
  expect((await auth.guard(new Request(`${local}/ws/$0`, { headers: { upgrade: "websocket", accept: "text/html" } }), peer))?.status).toBe(401);
});

test("secret exchange issues HttpOnly cookies, secure on HTTPS and usable on loopback HTTP", async () => {
  const auth = fixture();
  for (const origin of [local, remote]) {
    const response = await login(auth, origin);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly; SameSite=Strict; Max-Age=2592000");
    expect(setCookie.includes("; Secure")).toBe(origin === remote);
    expect(setCookie).not.toContain(auth.secret);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await auth.guard(new Request(`${origin}/api/sessions`, { headers: { cookie: cookie(response) } }), peer)).toBeUndefined();
    expect(await auth.guard(new Request(`${origin}/ws/$0`, { headers: { cookie: cookie(response), origin, upgrade: "websocket" } }), peer)).toBeUndefined();
  }
});

test("rejects wrong/oversized keys and cross-origin or originless exchanges", async () => {
  const auth = fixture();
  for (const key of ["", "wrong", "x".repeat(129)]) expect((await login(auth, local, key)).status).toBe(401);
  for (const origin of [undefined, "https://evil.example"]) {
    const headers: Record<string, string> = { "content-type": "text/plain" };
    if (origin) headers.origin = origin;
    const response = await auth.guard(new Request(`${local}/api/auth/login`, { method: "POST", headers, body: auth.secret }), peer);
    expect(response?.status).toBe(403);
    expect(response?.headers.has("set-cookie")).toBe(false);
  }
});

test("rejects forged cookies, expired sessions, cross-origin reuse and pre-restart credentials", async () => {
  const auth = fixture();
  const signedIn = cookie(await login(auth));
  const request = (value: string, origin = local) => new Request(`${origin}/api/sessions`, { headers: { cookie: value } });
  expect((await auth.guard(request(`${signedIn}tampered`), peer))?.status).toBe(401);
  expect((await auth.guard(request(signedIn.replace(/=\d+\./, "=1.")), peer))?.status).toBe(401);
  expect((await auth.guard(request(signedIn, remote), peer))?.status).toBe(401);
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 24 * 60 * 60 * 1000);
  try {
    expect((await auth.guard(request(signedIn), peer))?.status).toBe(401);
  } finally {
    clock.mockRestore();
  }
  const restarted = fixture();
  expect((await restarted.guard(request(signedIn), peer))?.status).toBe(401);
  expect((await login(restarted, local, auth.secret)).status).toBe(401);
});

test("HTTPS proxy requests work with a preserved Host and configured Origin", async () => {
  const auth = fixture();
  const response = (await auth.guard(new Request("http://terminal.tail.ts.net/api/auth/login", {
    method: "POST", headers: { origin: remote, "content-type": "text/plain" }, body: auth.secret,
  }), peer))!;
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("__Host-terminal-session=");
  expect(response.headers.get("set-cookie")).toContain("; Secure");
  expect(await auth.guard(new Request("http://terminal.tail.ts.net/api/sessions", {
    headers: { cookie: cookie(response), origin: remote },
  }), peer)).toBeUndefined();
});

test("does not trust arbitrary hosts, forwarded headers, remote loopback claims or cross-origin WebSockets", async () => {
  const auth = fixture();
  const signedIn = cookie(await login(auth));
  for (const request of [
    new Request("http://evil.example:3000/api/sessions", { headers: { cookie: signedIn } }),
    new Request(`${local}/ws/$0`, { headers: { cookie: signedIn, origin: "https://evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", upgrade: "websocket" } }),
  ]) expect((await auth.guard(request, peer))?.status).toBe(403);
  expect((await auth.guard(new Request(`${local}/api/sessions`, { headers: { cookie: signedIn } }), "100.64.0.5"))?.status).toBe(403);
});

test("sign-in uses a fragment and a no-store, non-frameable page without embedding the secret", async () => {
  const auth = fixture();
  const url = new URL(signInUrl(`${remote}/sessions`, auth.secret));
  expect(url.pathname).toBe("/login");
  expect(url.search).toBe("");
  expect(new URLSearchParams(url.hash.slice(1)).get("key")).toBe(auth.secret);
  const response = (await auth.guard(new Request(url), peer))!;
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(await response.text()).not.toContain(auth.secret);
});

test("blocks originless sibling-site requests even with cookies, while allowing QR entry", async () => {
  const auth = fixture();
  const signedIn = cookie(await login(auth, remote));
  for (const site of ["same-site", "cross-site"]) {
    const headers = { cookie: signedIn, "sec-fetch-site": site };
    for (const path of ["/sessions/new", "/api/sessions", "/ws/$0"]) {
      expect((await auth.guard(new Request(remote + path, { headers }), peer))?.status).toBe(403);
    }
    expect((await auth.guard(new Request(`${remote}/login`, { headers }), peer))?.status).toBe(200);
  }
});
