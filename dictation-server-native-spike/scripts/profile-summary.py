#!/usr/bin/env python3
"""Summarise an ONNX Runtime profile JSON: time per execution provider and per op type."""
import collections
import json
import sys

events = json.load(open(sys.argv[1]))
by_provider = collections.Counter()
by_op = collections.Counter()
count = collections.Counter()
runs = [e["dur"] for e in events if e.get("name") == "model_run"]
for event in events:
    if event.get("cat") != "Node" or not event["name"].endswith("_kernel_time"):
        continue
    args = event.get("args", {})
    key = (args.get("provider", "?"), args.get("op_name", "?"))
    by_provider[key[0]] += event["dur"]
    by_op[key] += event["dur"]
    count[key] += 1
print(f"runs={len(runs)} mean_run_ms={sum(runs) / max(len(runs), 1) / 1000:.1f}")
for provider, total in by_provider.most_common():
    print(f"{provider:28s} {total / 1000:10.1f} ms")
for (provider, op), total in by_op.most_common(15):
    print(f"  {provider:26s} {op:24s} {total / 1000:9.1f} ms  n={count[(provider, op)]}")
