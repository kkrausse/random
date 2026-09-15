#!/usr/bin/env python3
"""Reproduce sanitized September 15 review metrics from preserved tshark TSVs.

Usage: python3 palma-network-monitor/analyze-review.py
Raw addresses and complete frame lists stay in private/. Output contains only
domain-level totals and source frame/line references, never device identifiers.
TCP payload totals still include TLS handshakes and retransmissions.
"""
import collections
import csv
import datetime
import ipaddress
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
DATA = ROOT / 'private/diagnostics-20260915'
TZ = ZoneInfo('America/Los_Angeles')


def rows(name):
    with (DATA / name).open() as source:
        return list(csv.DictReader(source, delimiter='\t'))


def stamp(row):
    return datetime.datetime.fromtimestamp(float(row['frame.time_epoch']), TZ).isoformat()


def is_public(value):
    if not value:
        return False
    address = ipaddress.ip_address(value.split(',')[0])
    return address.is_global and not address.is_multicast


def main():
    policy = (DATA / 'routes.txt').read_text()
    device_mac = re.search(r'\d+: wlan0:.*?link/ether ([0-9a-f:]+)', policy, re.S).group(1)
    derps = json.loads((DATA / 'derpmap.json').read_text())
    derp_ips = {n.get('IPv4') for region in derps['Regions'].values() for n in region['Nodes']}
    result = {'units': 'bytes; frame lengths include all captured overhead; TCP lengths include TLS and retransmissions'}
    for label in ('baseline', 'followup'):
        packets = [r for r in rows(label + '.tsv') if device_mac in (r['eth.src'], r['eth.dst'])]
        stream_names = {}
        for row in packets:
            name = row['tls.handshake.extensions_server_name'] or row['http.host']
            if name:
                stream_names[row['tcp.stream']] = name.removesuffix(':80')
        if label == 'baseline':
            totals = collections.defaultdict(lambda: {'out_frame_bytes': 0, 'in_frame_bytes': 0, 'out_tcp_payload_bytes': 0, 'out_retransmission_tcp_bytes': 0, 'stream_ids': set(), 'handshake_or_http_frames': []})
            discovery = []
            for row in packets:
                name = stream_names.get(row['tcp.stream'], '')
                if name.endswith('.boox.com'):
                    entry = totals[name]
                    outbound = row['eth.src'] == device_mac
                    entry['out_frame_bytes' if outbound else 'in_frame_bytes'] += int(row['frame.len'])
                    entry['stream_ids'].add(row['tcp.stream'])
                    if outbound:
                        payload = int(row['tcp.len'] or 0)
                        entry['out_tcp_payload_bytes'] += payload
                        if any(row[k] for k in ('tcp.analysis.retransmission', 'tcp.analysis.fast_retransmission', 'tcp.analysis.spurious_retransmission')):
                            entry['out_retransmission_tcp_bytes'] += payload
                    if row['tls.handshake.extensions_server_name'] or row['http.host']:
                        entry['handshake_or_http_frames'].append(int(row['frame.number']))
                if row['eth.src'] == device_mac and '_meshcop._udp.local' in row['dns.qry.name']:
                    discovery.append(int(row['frame.number']))
            for entry in totals.values():
                entry['stream_ids'] = sorted(entry['stream_ids'], key=int)
            result['baseline'] = {'packets': len(packets), 'first': stamp(packets[0]), 'last': stamp(packets[-1]), 'boox': dict(sorted(totals.items())), 'thread_discovery_frames': discovery}
        else:
            cutoff = datetime.datetime.fromisoformat('2026-09-15T08:18:30-07:00').timestamp()
            latest = [r for r in packets if float(r['frame.time_epoch']) >= cutoff]
            totals = collections.defaultdict(lambda: [0, 0])
            dns_frames, ipv6_frames, syn_frames, derp_names = [], [], [], set()
            for row in latest:
                outbound = row['eth.src'] == device_mac
                ip = row['ip.dst'] if outbound else row['ip.src']
                name = stream_names.get(row['tcp.stream'], '')
                if name.startswith('derp') and name.endswith('.tailscale.com'):
                    derp_names.add(name)
                if is_public(ip):
                    if name.endswith('.tailscale.com'):
                        group = 'Tailscale TCP'
                    elif ip in derp_ips and '3478' in (row['udp.srcport'], row['udp.dstport']):
                        group = 'Tailscale STUN'
                    else:
                        group = name or 'unattributed public peer'
                    totals[group][0 if outbound else 1] += int(row['frame.len'])
                if outbound and row['dns.qry.name'] == 'sync.datamate.kindle.amazon.dev':
                    dns_frames.append(int(row['frame.number']))
                if outbound and row['ipv6.src']:
                    ipv6_frames.append(int(row['frame.number']))
                if outbound and row['tcp.dstport'] == '853':
                    syn_frames.append(int(row['frame.number']))
            result['followup_today'] = {'packets': len(latest), 'first': stamp(latest[0]), 'last': stamp(latest[-1]), 'public_out_in_frame_bytes': dict(totals), 'named_derp_hosts': len(derp_names), 'kindle_dns_query_frames': dns_frames, 'outbound_ipv6_frames': ipv6_frames, 'outbound_dot_frames': syn_frames}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
