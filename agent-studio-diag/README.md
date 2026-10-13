# agent-studio-diag

A collector on diesel2 for agent-studio's opt-in live diagnostics, reachable only on
the tailnet:

```
https://diesel2.guineafowl-truck.ts.net:4806/
```

agent-studio sends nothing anywhere unless its address has `?diag=1`; with it, the page
posts what the visit is doing as it happens (its log, steps, every session's messages and
tool calls, heartbeats from the page and from a worker), so that a run in a browser on
the tailnet can be read here, including after the tab froze. What exactly is sent, and
what never is, is in autoanimate's `agent-studio/README.md`, "Diagnostics".

```
https://zu4tgfuxau5n.opentunnel.xyz/artifacts/agent-studio/?relay=wss://diesel2.guineafowl-truck.ts.net:4805/&diag=1
```

The page is public; the browser that opens it has to be on the tailnet, or the posts fail
(the page says so in its log and carries on).

## Reading a run

A run is one file, `~/devfs/cache/agent-studio-diag/<date>-<run id>.jsonl`: one JSON
record a line, `at` (when it arrived here) first, then the page's `t`, `n`, `kind`.

```sh
bun latest.ts --follow          # the newest run, readably, as it arrives
bun latest.ts                   # the newest run, whole
bun latest.ts --list            # the runs there are, newest last
bun latest.ts --follow 2325     # the newest run whose file name has "2325"
bun latest.ts --all             # every heartbeat (by default only late ones, and one a minute)
tail -f "$(ls -t ~/devfs/cache/agent-studio-diag/*.jsonl | head -1)"    # the records themselves
```

What a freeze looks like: `beat` lines stop and `wbeat` lines say `WORKER: no ping from
the page for N s`, growing, while the main thread is held; when it comes back, a `beat`
says `MAIN THREAD HELD N s`. Both stopping is the tab gone. A page's first load (it
registers its service worker and reloads) is a short run of its own.

## What it is

- `server.ts`: `Bun.serve` on `127.0.0.1:4806`. `POST /<run id>` with newline-delimited
  JSON, appended to the run's file. Its header lists the environment variables.
- `agent-studio-diag.service`: systemd user unit (linger is on), `Restart=on-failure`.
- `sudo tailscale serve --bg --https=4806 4806`: the tailnet's certificate and TLS in
  front. Not Funnel; nothing public.
- `setup.sh` installs all three and can be re-run. The unit runs `server.ts` from the
  checkout `setup.sh` was run in, so re-run it if that checkout moves.
- `latest.ts`: the reader above.

```sh
systemctl --user status agent-studio-diag
systemctl --user restart agent-studio-diag     # stop | start
journalctl --user -u agent-studio-diag -f      # one line per new run and per refusal, never content
sudo tailscale serve --https=4806 off          # take the route away
rm ~/devfs/cache/agent-studio-diag/*.jsonl     # forget the runs (then restart the service)
```

## What it refuses

| Enforced | By |
| --- | --- |
| Reachable from the tailnet only | listens on loopback; Tailscale Serve, no Funnel |
| A browser must come from an allowed page origin (`DIAG_ORIGINS` in the unit: the opentunnel shelf, `*.guineafowl-truck.ts.net`, `localhost`, `127.0.0.1`); others get 403 and no CORS headers | `originAllowed` in `server.ts` |
| A body is at most 1 MiB (413) | `maxRequestBodySize`, and a check |
| A run's file is at most 64 MiB (413, and a last `capped` line in it) | `DIAG_MAX_RUN` |
| The directory is at most 4 GiB (507) | `DIAG_MAX_TOTAL` |
| A run id is 1 to 64 of `A-Za-z0-9_.-`, not starting with a dot: it is part of a file name | the route |
| Nothing is read back over HTTP | there is no route for it |

Not enforced: who on the tailnet (any device the tailnet's ACLs let reach diesel2,
including a script that sends no `Origin`) may append to any run. Nothing deletes old
runs: they are small (a text run of ten seconds is 30 KB; an hour is a few MB).

To let another page post, add its origin to `ORIGINS` in `setup.sh` and re-run it.
