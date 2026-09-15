# Latest Palma2 report

**[September 15, 2026 — packet review, USB diagnostics, and evidence citations](REVIEW-2026-09-15.md)**

## TL;DR

Privacy concerns, yes; proven personal-data theft, no. Before restrictions, the
Palma sent **65.3 KB to four BOOX service domains** (**70.0 KB including BOOX
connectivity checks**) and contacted Amazon metrics/Kindle diagnostics and Google
location-related endpoints. Those byte counts include protocol overhead; the
encrypted contents are unknown.

Today is quieter: **USB confirms Tailscale lockdown and the selected-app policy**,
with **no visible BOOX connection** in the reviewed reconnect window. Kindle DNS
still reaches the local resolver, and **no exit node is configured**, so this is
not full-tunnel Internet privacy. Historical local discovery was observed;
successful LAN inventory uploading or broad scanning was not established.

See the linked report's inline citations, BOOX domain-by-domain table, current
UID/route evidence, and reproduction notes. Raw evidence remains local/private.
