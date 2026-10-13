# wisp-relay

A private [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) server on diesel2,
reachable only on the tailnet:

```
wss://diesel2.guineafowl-truck.ts.net:4805/
```

For pages that make their own HTTPS requests with TLS done in the tab and need
something to carry the TCP bytes: agent-studio (`?relay=<that URL>`; a path that does
not end in `/tcp` is taken as Wisp) and browser-agent-toolkit's terminal example
(`?wisp=`). It replaces Mercury Workshop's public `wss://wisp.mercurywork.shop/`. The
relay sees which host was called, when, and how many bytes; the bytes are TLS between
the tab and that host.

```
https://zu4tgfuxau5n.opentunnel.xyz/artifacts/agent-studio/?relay=wss://diesel2.guineafowl-truck.ts.net:4805/
```

The page may be served from anywhere (that address is public), but the browser that
opens it has to be on the tailnet: the relay's name resolves and answers only there.
Off the tailnet the page loads and the relay fails ("tunnel via ...").

## What it is

- `server.ts`: [`@mercuryworkshop/wisp-js`](https://github.com/MercuryWorkshop/wisp-js)
  0.5.0 (the reference server; Wisp v1, and v2 for a client that asks) behind a Bun
  `node:http` server on `127.0.0.1:4805`. Its header lists the environment variables.
- `wisp-relay.service`: systemd user unit (linger is on), `Restart=on-failure`.
- `sudo tailscale serve --bg --https=4805 4805`: the tailnet's certificate and TLS in
  front. Not Funnel; nothing public.
- `setup.sh` installs all three and can be re-run. The unit runs `server.ts` from the
  checkout `setup.sh` was run in, so re-run it if that checkout moves.

```sh
systemctl --user status wisp-relay
systemctl --user restart wisp-relay      # stop | start
journalctl --user -u wisp-relay -f       # one line per stream: host and port, never content
bun verify.ts                            # the checks below, against the tailnet URL
sudo tailscale serve --https=4805 off    # take the route away
```

## What it will connect to

It is a TCP proxy for whoever can reach it, so:

| Enforced | By |
| --- | --- |
| Reachable from the tailnet only | listens on loopback; Tailscale Serve, no Funnel |
| TCP only, no UDP | wisp-js `allow_udp_streams: false` |
| Destination port 443 only (`WISP_PORTS`) | wisp-js `port_whitelist` |
| Names only, no literal addresses | wisp-js `allow_direct_ip: false` |
| The name must resolve only to public addresses: not loopback, private (10/8, 172.16/12, 192.168/16), link-local, CGNAT/tailnet (100.64/10), IPv6 unique-local (the tailnet's `fd7a:`), multicast or reserved; and the connection goes to the address that was checked | `resolvePublic` in `server.ts`, given to wisp-js as its resolver |
| A browser must come from an allowed page origin (`WISP_ORIGINS` in the unit: the opentunnel shelf, `*.guineafowl-truck.ts.net`, `localhost`) | the upgrade handler in `server.ts` |
| Only `/` is served; wisp-js's wsproxy paths are off | the upgrade handler |
| 64 streams per WebSocket | wisp-js `stream_limit_total` |

Not enforced: which public hosts (any name on 443); how many WebSockets, bytes or how
long; who on the tailnet (any device the tailnet's ACLs let reach diesel2, including a
script that sends no `Origin`). Port 80 is closed on purpose: agent-studio's
`guest/link.ts` sends only https through the relay.

To let another page use it, add its origin to `ORIGINS` in `setup.sh` and re-run it.

## Why wisp-js and not browser-agent-toolkit's `packages/relay`

The toolkit's relay allows exact `host:port` pairs only, and agent-studio follows links
to hosts nobody can list ahead of time. Wisp is also what the page already speaks to the
public server, so nothing changes on the page but the address. wisp-js's own address
check misses IPv6 unique-local and IPv4-mapped addresses, which is why the resolver is
replaced with the toolkit relay's stricter `isPublicAddress`.
