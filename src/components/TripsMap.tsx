"use client";

import { useEffect, useRef } from "react";
import type L from "leaflet";

interface Trip {
  id: string;
  startDate: string;
  endDate: string;
  locationName: string;
  speciesCount: number;
  lat: number;
  lng: number;
}

interface Props {
  trips: Trip[];
}

function TripsMapInner({ trips }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof L | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("leaflet").then((leaflet) => {
      const Leaf = leaflet.default;
      leafletRef.current = Leaf;

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
      addMarkers(Leaf, map, trips);
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

    map.eachLayer((layer) => {
      if (layer instanceof Leaf.Marker) {
        map.removeLayer(layer);
      }
    });

    addMarkers(Leaf, map, trips);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden border border-gray-300"
      style={{ height: "400px" }}
    />
  );
}

function addMarkers(Leaf: typeof L, map: L.Map, trips: Trip[]) {
  if (trips.length === 0) return;

  const bounds = Leaf.latLngBounds([]);
  for (const trip of trips) {
    const label =
      trip.startDate === trip.endDate
        ? trip.startDate
        : `${trip.startDate} – ${trip.endDate}`;
    const marker = Leaf.marker([trip.lat, trip.lng]).addTo(map);
    marker.bindPopup(
      `<strong>${trip.locationName}</strong><br/>${label}<br/>${trip.speciesCount} species<br/><a href="/trips/${encodeURIComponent(trip.id)}" style="color:#166534;font-weight:600;">View trip →</a>`
    );
    marker.on("click", () => {
      marker.openPopup();
    });
    bounds.extend([trip.lat, trip.lng]);
  }
  map.fitBounds(bounds, { padding: [50, 50] });
}

import dynamic from "next/dynamic";
export default dynamic(() => Promise.resolve(TripsMapInner), { ssr: false });
