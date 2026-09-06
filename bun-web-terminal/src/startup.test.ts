import { expect, test } from "bun:test";
import { tailscaleSessionsUrl } from "./startup";

function status(proxy = "http://127.0.0.1:3000", https = true, path = "/", address = "machine.tail.ts.net:443") {
  return {
    TCP: { [address.split(":")[1]!]: { HTTPS: https } },
    Web: { [address]: { Handlers: { [path]: { Proxy: proxy } } } },
  };
}

test("detects the matching HTTPS Serve URL, including custom HTTPS ports", () => {
  expect(tailscaleSessionsUrl(status(), 3000)).toBe("https://machine.tail.ts.net/sessions");
  expect(tailscaleSessionsUrl(status("http://localhost:3107", true, "/", "machine.tail.ts.net:8443"), 3107))
    .toBe("https://machine.tail.ts.net:8443/sessions");
});

test("does not advertise another instance or an incompatible Serve route", () => {
  for (const config of [null, {}, status("http://127.0.0.1:3107"), status("http://example.com:3000"), status(undefined, false), status(undefined, true, "/other"), status("http://127.0.0.1:3000/other")]) {
    expect(tailscaleSessionsUrl(config, 3000)).toBeUndefined();
  }
});
