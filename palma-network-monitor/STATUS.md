# Palma monitoring — current configuration and session handoff

## Evening review — September 11, approximately 22:30 PDT

SSH review after the user reported returning to the Palma and opening Kindle:

- AP and capture services are active. The recording has continued since
  September 10 at 21:39:54, with approximately 49 MB in the ring. The AP guard
  is present, including internal-network and IPv6 denials. Final capture-loss
  statistics remain unavailable while recording continues.
- One station is associated. Its association age at 22:30 corresponds to the
  morning 07:36 reconnect, rather than a fresh evening association.
- The detailed evening snapshot covers **22:20:11–22:31:10 PDT**. The only
  public IP peers were the existing Tailscale relay and control-plane streams,
  identified by their earlier TLS handshakes in the same capture. Their captured
  outbound frame bytes totaled about 1.7 KB; outbound TCP payload totaled only
  67 bytes (encrypted/control data, not an application-content measurement).
- At **22:28:22** and **22:30:01**, the Palma queried the Pi's DNS resolver for
  `sync.datamate.kindle.amazon.dev`. DNS replies returned Amazon addresses, but
  the snapshot contains no subsequent packets to those addresses and no direct
  Amazon application connection. This supports Kindle connection blocking while
  demonstrating that Kindle-related DNS metadata is still exposed to the local
  resolver. Gateway evidence alone cannot identify the process making the query.
- No BOOX traffic, new public peers, device-originated local scanning, or IPv6
  traffic appeared in that evening snapshot. Device local traffic was DNS and
  ARP replies. Pi-originated broadcast traffic is not Palma activity.
- A broader MAC-filtered metadata review from **08:00:08–22:30:15** found only
  Tailscale relay/control/logging public peers and a Google connection on port
  5228, plus local DNS/link traffic. No visible BOOX names or connections to the
  previously observed BOOX addresses appeared. Approximately 1.03 MB of outbound
  captured frames went to Tailscale logging peers in this broader window.

**Assessment:** no evidence of a successful direct Kindle sync or suspicious
BOOX transfer in the evening window. Tailscale infrastructure remains connected;
the observations are consistent with the previously verified app restrictions.
This is not a fresh device-side verification: no USB/ADB device was available,
so current inclusion settings, lockdown, and exit-node selection were not read
back. Encrypted relay contents are not visible. The last verified setup had no
exit node, so it does not promise full-tunnel public Internet or DNS privacy.

Private extracted metadata is in `private/latest-metadata.tsv`,
`private/latest-name-history.tsv`, and `private/evening-window.tsv` (Git-ignored).
Capture remains running. This summary is local to the Mac project.

## Local Mac update — September 11, approximately 07:37 PDT

USB/ADB investigation identified the morning BOOX exchanges as Android
NetworkMonitor connectivity probes to `/generate_204`, with logged HTTP 204
responses matching the capture timestamps. See [ADB-FINDINGS.md](ADB-FINDINGS.md).

At the user's request, the connectivity-check configuration was changed from
BOOX to Google and Wi-Fi was briefly reconnected. Android logged successful
Google HTTPS probes at 07:36:49; the Pi capture independently showed the Google
TLS connections and no traffic to the previously observed BOOX IP or visible
BOOX DNS/TLS names in this short post-change snapshot. Wi-Fi and Tailscale VPN
both remained connected/validated; always-on Tailscale and lockdown remained set.
Reboot persistence and end-to-end app tests after this change remain untested.
See [CONNECTIVITY-CHECK.md](CONNECTIVITY-CHECK.md) for values and rollback.

This update and its evidence are local to the Mac project; the Pi project copy
has not been updated. The older handoff below describes the preceding state.

Updated September 11, 2026. Times below are PDT (UTC−07:00).
Device settings and app tests are user-reported; packet observations are from
the Pi. This is a sanitized summary: device identifiers, IP addresses, packet
captures, and raw DNS logs remain outside the repository.

## Current device configuration

- **Active VPN: Tailscale.** RethinkDNS is no longer being used as the VPN/firewall.
- Android **Always-on VPN** and **Block connections without VPN** are enabled
  for the current setup, as reported by the user.
- **No Tailscale exit node is selected.**
- On Tailscale's **App split tunneling** page, the user switched to
  **Included apps** mode. This is an inclusion list, not an exclusion list.
- Currently included apps:
  - Custom **opencode2 reader** app
  - **Gmail**
  - **1Password**
- **Kindle is now excluded/blocked.** It was allowed earlier; the exact time of
  removal is unknown. Do not attribute earlier Amazon traffic to a failure of
  the current policy.
- The user tested an excluded browser and Kindle: both behave as though they
  have no Internet access. This supports enforcement for those tested apps.
- Exact time of the switch from RethinkDNS to Tailscale is unknown. Tailscale
  infrastructure traffic becomes visible around 23:13 on September 10, but
  this is not a verified settings-change timestamp.

### Interpretation

Without an exit node, Tailscale does not tunnel all public Internet traffic
through a remote gateway. Direct public connections visible on the Pi are not,
by themselves, evidence of a VPN bypass. App inclusion and Android lockdown
are a separate question: excluded apps should ordinarily be denied network
access, consistent with the browser and Kindle tests.

The gateway cannot identify the originating Android app/UID, inspect the active
VPN configuration, or establish how a particular system process is handled.
A BOOX destination is not sufficient evidence that an excluded BOOX app bypassed
lockdown. Earlier suggestions that the observed traffic established a bypass
were too strong.

## Pi monitoring status

- At 06:32 on September 11, `palma-capture.service` was active and had been
  running continuously since September 10 at 21:39:54.
- The live ring contained approximately 45 MB at that check, below its roughly
  1 GB limit. One Wi-Fi station was associated; its association age was
  consistent with the approximately 06:30 reconnect.
- The AP-scoped `inet palma_guard` table was present when inspected. Its rules
  still deny AP access to internal destinations and Pi services other than
  DHCP/DNS, and deny IPv6. Counters show drops, but are cumulative and do not
  assign individual attempts to a particular observation window.
- Capture was left running. No routing, firewall, VPN, or app-policy changes
  were made during this session. No BOOX-specific gateway block was installed.
- Final capture-loss statistics have not been collected because recording
  has not been stopped.

## Observations from this session

The main review covered September 10 at 22:33:13 through September 11 at
06:32:16. A follow-up read at approximately 06:52 examined the observed BOOX
destination after 06:30. These are bounded reviews, not a claim that all traffic
through 06:52 received a full analysis.

### Overnight quiet and morning reconnect

- No IPv4 packets to or from the Palma's assigned address were observed between
  midnight and 06:30. Other interface traffic existed; do not describe the whole
  capture as silent or equate device silence with proof of firewall enforcement.
- The Palma reconnected around 06:30, consistent with the user reporting that
  they had just opened it.

### BOOX endpoint remains reachable

- Fresh HTTPS connections to the previously identified BOOX connectivity-check
  endpoint occurred after the earlier lockdown marker, including two at
  06:30:08 and another pair at 06:37:57.
- In the main review window there were 14 distinct TLS connections to this
  endpoint: approximately 24 KB outbound and 90 KB inbound in captured frame
  bytes, including transport/TLS overhead and any retransmissions.
- Each of the four connections examined at 06:30 and 06:37 carried one
  **237-byte outbound TLS application-data record** and one **129-byte inbound
  record**, then closed. These are encrypted record lengths, not plaintext
  request/response sizes.
- The earlier passive baseline included a plaintext `/generate_204` request
  to the same hostname. The small repeated exchanges are consistent with
  connectivity validation; their encrypted paths, contents, and originating
  process remain unknown.
- No DNS/TLS-name sightings of the other previously noted BOOX data, push,
  index, or callback endpoints appeared in the main review window. This is
  limited to visible metadata, not proof of complete absence or blocking.
- No document upload or broader BOOX telemetry transfer was established.

### Tailscale and allowed-app-related activity

- Tailscale control, logging, and relay infrastructure appeared around 23:13,
  with additional relay activity on the morning wake.
- Roughly 1.98 MB outbound was attributed to its logging endpoint in the main
  review window, using visible TLS names and captured frame bytes. This includes
  overhead/retransmissions and does not reveal log contents.
- The wide spread of named Tailscale relay destinations and STUN activity is
  consistent with relay discovery/connectivity testing, rather than sufficient
  evidence of an unexplained scan.
- UDP attempts to private destinations on Tailscale's usual port were visible.
  Capturing an outbound attempt on the AP interface does not establish successful
  forwarding; the Pi's internal-network isolation remains in place.
- Amazon metrics traffic continued last night: approximately 98 KB outbound to
  the previously identified metrics endpoint, plus Kindle diagnostic connections.
  Kindle's later exclusion time is unknown; this does not demonstrate traffic
  after Kindle was blocked.
- Google messaging/API and encrypted DNS traffic were also visible. Gateway
  metadata does not reliably assign these connections to an Android app.

## Current assessment

The browser and Kindle tests are reassuring evidence that excluded-app blocking
works for those apps. The small BOOX wake exchange is an unresolved, potentially
system-level exception, not a demonstrated general bypass. Tailscale traffic
fits the newly clarified configuration. Originating UID and network-validation
configuration are the most useful missing evidence.

## Proposed next checks — not yet performed

1. With user-enabled USB debugging and an authorized ADB connection, inspect
   Android's connectivity-check URLs, active VPN/lockdown configuration,
   applicable UID ranges, and network-validation logs around wake. Availability
   depends on the firmware; root is not required for many of these diagnostics.
2. Repeat excluded-browser and Kindle tests immediately after reboot and after
   sleep/wake, recording action times for correlation with the capture.
3. Optionally install a temporary, Palma-scoped Pi firewall block for the
   observed BOOX destination, then test wake and the included apps. Observe
   retries, alternative destinations, connectivity indicators, and app behavior.
   This would cover that IP on this AP only. No such rule has been installed.

## Private evidence and earlier notes

Captures are under `/var/lib/palma-network-monitor/captures/`. Earlier private
reviews and the historical RethinkDNS action log are under
`/var/lib/palma-network-monitor/reviews/` and
`/var/lib/palma-network-monitor/rethink-run-notes.txt`. Those earlier settings
describe the historical trial, not the current device policy. Keep raw evidence
and exact device/network identifiers out of this public repository.
