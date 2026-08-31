"use client";

import { useEffect, useRef } from "react";
import type L from "leaflet";

interface Sighting {
  id: number;
  species: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
}

interface Props {
  sightings: Sighting[];
}

function MapViewInner({ sightings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof L | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("leaflet").then((leaflet) => {
      const Leaf = leaflet.default;
      leafletRef.current = Leaf;

      // CSS loaded via layout.tsx

      delete (Leaf.Icon.Default.prototype as unknown as Record<string, unknown>)
        ._getIconUrl;
      Leaf.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      if (!containerRef.current) return;

      const map = Leaf.map(containerRef.current).setView([39.8283, -98.5795], 4);

      Leaf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      mapRef.current = map;

      // Add markers for initial sightings
      addMarkers(Leaf, map, sightings);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const Leaf = leafletRef.current;
    if (!map || !Leaf) return;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof Leaf.Marker) {
        map.removeLayer(layer);
      }
    });

    addMarkers(Leaf, map, sightings);
  }, [sightings]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden border border-gray-300"
      style={{ height: "calc(100vh - 120px)" }}
    />
  );
}

function addMarkers(Leaf: typeof L, map: L.Map, sightings: Sighting[]) {
  if (sightings.length === 0) return;

  const bounds = Leaf.latLngBounds([]);
  for (const s of sightings) {
    const marker = Leaf.marker([s.lat, s.lng]).addTo(map);
    marker.bindPopup(
      `<strong>${s.species}</strong><br/>${s.date}<br/>${s.locationName}`
    );
    bounds.extend([s.lat, s.lng]);
  }
  map.fitBounds(bounds, { padding: [50, 50] });
}

import dynamic from "next/dynamic";
export default dynamic(() => Promise.resolve(MapViewInner), { ssr: false });
