import { expect, test } from "bun:test";
import { PicSyncAuth } from "./auth";
import { decodeCredentials, generateCredentials } from "./credentials";

const local = "http://127.0.0.1:8789";
const remote = "https://photos.example.com";
const peer = "127.0.0.1";
const paths = ["/", "/app.js", "/app.css", "/strip-worker.js", "/error-details.js", "/decode-strip.js", "/strip-plan.js", "/stitch-strips.js", "/modern/libraw.js", "/modern/libraw.wasm", "/api/folder", "/api/photo?path=private.ARW", "/api/preview?path=private.ARW", "/api/render?path=private.ARW&size=full", "/api/client-error", "/unknown"];
const fixture = () => new PicSyncAuth(8789, remote, generateCredentials());
async function login(auth: PicSyncAuth, origin = remote, key = auth.secret) {
  return (await auth.guard(new Request(`${origin}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "text/plain" }, body: key,
  }), peer))!;
}
const cookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0]!;

test("every application path is gated, including HEAD and conditional asset/photo requests", async () => {
  const auth = fixture();
  for (const path of paths) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await auth.guard(new Request(remote + path, { method, headers: { "if-none-match": '"cached"' } }), peer);
      expect(response?.status).toBe(401);
      expect(response?.headers.get("cache-control")).toBe("no-store");
    }
  }
  const navigation = await auth.guard(new Request(remote, { headers: { accept: "text/html" } }), peer);
  expect(navigation?.status).toBe(303);
  expect(navigation?.headers.get("location")).toBe("/login");
  expect((await auth.guard(new Request(remote, { headers: { accept: "text/html", upgrade: "websocket" } }), peer))?.status).toBe(401);
});

test("only standalone sign-in HTML is public; fragment is cleared and app opens after login", async () => {
  const response = await fixture().guard(new Request(remote + "/login"), peer);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("content-security-policy")).toContain("default-src 'none'");
  const html = await response!.text();
  expect(html).toContain('history.replaceState(null, "", "/login")');
  expect(html).toContain('location.replace("/")');
  expect(html).not.toContain("app.js");
});

test("valid code issues origin-bound secure cookie and permits all application paths", async () => {
  const auth = fixture();
  const response = await login(auth);
  expect(response.status).toBe(200);
  const header = response.headers.get("set-cookie")!;
  for (const flag of ["__Host-picsync-session=", "HttpOnly", "SameSite=Strict", "Secure", "Path=/"]) expect(header).toContain(flag);
  expect(header).not.toContain(auth.secret);
  for (const path of paths) expect(await auth.guard(new Request(remote + path, { headers: { cookie: cookie(response) } }), peer)).toBeUndefined();
  expect((await auth.guard(new Request(local, { headers: { cookie: cookie(response) } }), peer))?.status).toBe(401);
});

test("saved credentials preserve sign-ins across restart; rotation revokes links and cookies", async () => {
  const credentials = generateCredentials();
  const auth = new PicSyncAuth(8789, remote, credentials);
  const saved = decodeCredentials(Buffer.from(JSON.stringify({ version: 1, ...credentials })).toString("base64"));
  const restarted = new PicSyncAuth(8789, remote, saved);
  const request = new Request(remote, { headers: { cookie: cookie(await login(auth)) } });
  expect(await restarted.guard(request, peer)).toBeUndefined();
  expect((await login(restarted, remote, auth.secret)).status).toBe(200);
  const rotated = fixture();
  expect((await rotated.guard(request, peer))?.status).toBe(401);
  for (const path of paths) {
    const revalidation = new Request(remote + path, {
      headers: { cookie: request.headers.get("cookie")!, "if-none-match": '"cached"' },
    });
    expect(await restarted.guard(revalidation, peer)).toBeUndefined();
    const denied = await rotated.guard(revalidation, peer);
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("cache-control")).toBe("no-store");
  }
  expect((await login(rotated, remote, auth.secret)).status).toBe(401);
  for (const value of ["garbage", "e30="]) expect(() => decodeCredentials(value)).toThrow();
});

test("invalid codes, tampered and expired cookies fail", async () => {
  const auth = fixture();
  expect(auth.sessionStatus(new Request(remote))).toBe("missing");
  for (const key of ["", "wrong", "x".repeat(129)]) expect((await login(auth, remote, key)).status).toBe(401);
  const valid = cookie(await login(auth));
  expect(auth.sessionStatus(new Request(remote, { headers: { cookie: valid } }))).toBe("valid");
  expect(auth.sessionStatus(new Request(remote, { headers: { cookie: valid + "tampered" } }))).toBe("invalid-signature");
  expect(auth.sessionStatus(new Request(remote, { headers: { cookie: valid.replace(/=\d+\./, "=1.") } }))).toBe("expired");
  expect(auth.sessionStatus(new Request(remote, { headers: { cookie: "__Host-picsync-session=broken" } }))).toBe("malformed");
  for (const value of [valid + "tampered", valid.replace(/=\d+\./, "=1.")]) {
    expect((await auth.guard(new Request(remote, { headers: { cookie: value } }), peer))?.status).toBe(401);
  }
});

test("host, remote plaintext, cross-origin and sibling-site requests are denied", async () => {
  const auth = fixture();
  const signedIn = cookie(await login(auth));
  for (const [name, value] of [["origin", "https://evil.example.com"], ["sec-fetch-site", "same-site"], ["sec-fetch-site", "cross-site"]] as const) {
    expect((await auth.guard(new Request(remote, { headers: { [name]: value, cookie: signedIn } }), peer))?.status).toBe(403);
  }
  expect((await auth.guard(new Request("https://evil.example.com", { headers: { "x-forwarded-host": "photos.example.com" } }), peer))?.status).toBe(403);
  expect((await auth.guard(new Request(local), "192.168.1.2"))?.status).toBe(403);
  expect((await auth.guard(new Request(remote + "/api/auth/login", { method: "POST", body: auth.secret }), peer))?.status).toBe(403);
  expect(() => new PicSyncAuth(8789, "http://photos.example.com", generateCredentials())).toThrow();
  // TLS termination at the explicitly configured reverse proxy is supported.
  expect(await auth.guard(new Request("http://photos.example.com/app.js", { headers: { cookie: signedIn } }), peer)).toBeUndefined();
});

test("explicit LAN origin signs in LAN peers without accepting other hosts or subnets", async () => {
  const origin = "http://192.168.1.184:8789";
  const auth = new PicSyncAuth(8789, undefined, generateCredentials(), { origin, cidr: "192.168.1.0/24" });
  const request = () => new Request(`${origin}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "text/plain" }, body: auth.secret,
  });
  const response = (await auth.guard(request(), "192.168.1.25"))!;
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).not.toContain("Secure");
  const signedIn = cookie(response);
  expect(await auth.guard(new Request(origin + "/api/render?path=a.ARW&size=full", { headers: { cookie: signedIn } }), "192.168.1.25")).toBeUndefined();
  for (const peer of ["192.168.2.25", "203.0.113.25"]) expect((await auth.guard(request(), peer))?.status).toBe(403);
  expect((await auth.guard(new Request("http://192.168.1.185:8789/", { headers: { cookie: signedIn } }), "192.168.1.25"))?.status).toBe(403);
  expect((await auth.guard(new Request(local, { headers: { cookie: signedIn } }), "127.0.0.1"))?.status).toBe(401);
  for (const url of ["http://8.8.8.8:8789", "http://photos.example.com:8789", "http://192.168.1.184:9999", origin + "/path"]) {
    expect(() => new PicSyncAuth(8789, undefined, generateCredentials(), { origin: url, cidr: "192.168.1.0/24" })).toThrow();
  }
});
