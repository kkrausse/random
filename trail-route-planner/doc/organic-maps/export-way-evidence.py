#!/usr/bin/env python3
"""Join OSM XML way evidence to Organic Maps' version-1 .mwm.osm2ft mapping.

This is a spike companion, not an MWM reader. Feature IDs are only valid for
the exact MWM whose mapping file was supplied. No inferred access is emitted.
"""

import argparse
import hashlib
import json
import struct
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


def varuint(data, offset):
    value = 0
    for shift in range(0, 35, 7):
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, offset
    raise ValueError("Invalid mapping length")


def way_features(path):
    data = path.read_bytes()
    if data[:5] != b"\xff\xff\xff\xff\x01":
        raise ValueError("Expected upstream OsmID2FeatureID V1 header")
    count, offset = varuint(data, 5)
    if len(data) - offset != count * 24:
        raise ValueError("Unexpected C++ pair<CompositeId,uint32_t> layout")
    result = defaultdict(set)
    for main, additional, feature_id in struct.iter_unpack("<QQI4x", data[offset:]):
        if main >> 56 == 0x80:  # base::GeoObjectId::ObsoleteOsmWay
            result[main & 0x0000FFFFFFFFFFFF].add(feature_id)
    return result


def source_ways(path, ids):
    for _, element in ET.iterparse(path, events=("end",)):
        if element.tag == "way":
            way_id = int(element.attrib["id"])
            if way_id in ids:
                yield way_id, {
                    "version": element.attrib.get("version"),
                    "timestamp": element.attrib.get("timestamp"),
                    "tags": {tag.attrib["k"]: tag.attrib["v"] for tag in element.iter("tag")},
                }
        if element.tag in ("way", "node", "relation"):
            element.clear()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm_xml", type=Path)
    parser.add_argument("mwm", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()
    mapping = way_features(Path(str(args.mwm) + ".osm2ft"))
    features = defaultdict(list)
    matched = 0
    for way_id, evidence in source_ways(args.osm_xml, mapping):
        matched += 1
        for feature_id in mapping[way_id]:
            features[feature_id].append({"osmWayId": str(way_id), **evidence})
    output = {
        "mwmSha256": sha256(args.mwm),
        "osmSha256": sha256(args.osm_xml),
        "features": {str(k): v for k, v in sorted(features.items())},
    }
    args.output_json.write_text(json.dumps(output, separators=(",", ":"), sort_keys=True))
    print(f"mapping ways={len(mapping)} matched source ways={matched} features={len(features)} "
          f"bytes={args.output_json.stat().st_size}")


if __name__ == "__main__":
    main()
