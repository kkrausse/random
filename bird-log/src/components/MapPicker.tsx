"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type L from "leaflet";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  onLocationSelect: (lat: number, lng: number, name: string) => void;
  initialLat?: number;
  initialLng?: number;
}

interface SavedLocation {
  locationName: string;
  lat: number;
  lng: number;
}

function MapPickerInner({ onLocationSelect, initialLat, initialLng }: Props) {
  const [position, setPosition] = useState<[number, number] | null>(
    initialLat && initialLng ? [initialLat, initialLng] : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [locationName, setLocationName] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const leafletRef = useRef<typeof L | null>(null);

  useEffect(() => {
    fetch("/api/locations")
      .then((res) => res.json())
      .then(setSavedLocations)
      .catch(() => {});
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const suggestions =
    q.length > 0
      ? savedLocations.filter((loc) =>
          loc.locationName.toLowerCase().includes(q)
        )
      : savedLocations;

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await res.json();
        const name =
          data.display_name?.split(",").slice(0, 3).join(",").trim() ||
          `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setLocationName(name);
        onLocationSelect(lat, lng, name);
      } catch {
        const name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setLocationName(name);
        onLocationSelect(lat, lng, name);
      }
    },
    [onLocationSelect]
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;
    let map: L.Map;

    import("leaflet").then((leaflet) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

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

      map = Leaf.map(mapContainerRef.current).setView(
        position || [39.8283, -98.5795],
        position ? 13 : 4
      );

      Leaf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      if (position) {
        markerRef.current = Leaf.marker(position).addTo(map);
      }

      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        setPosition([lat, lng]);
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = Leaf.marker([lat, lng]).addTo(map);
        }
        reverseGeocode(lat, lng);
      });

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doNominatimSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
        );
        const data = await res.json();
        if (data.length > 0) {
          const Leaf = leafletRef.current;
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          const name =
            data[0].display_name?.split(",").slice(0, 3).join(",").trim() ||
            `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          setPosition([lat, lng]);
          setLocationName(name);
          onLocationSelect(lat, lng, name);
          if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
          } else if (mapRef.current && Leaf) {
            markerRef.current = Leaf.marker([lat, lng]).addTo(mapRef.current);
          }
          mapRef.current?.setView([lat, lng], 13);
        }
      } finally {
        setIsSearching(false);
      }
    },
    [onLocationSelect]
  );

  const handleChange = (value: string) => {
    setSearchQuery(value);
    clearTimeout(timerRef.current);
    const newQ = value.trim().toLowerCase();
    const filtered =
      newQ.length > 0
        ? savedLocations.filter((loc) =>
            loc.locationName.toLowerCase().includes(newQ)
          )
        : savedLocations;
    setIsOpen(filtered.length > 0);
    if (value.trim().length > 2) {
      timerRef.current = setTimeout(() => doNominatimSearch(value), 500);
    }
  };

  const handleSearch = () => {
    clearTimeout(timerRef.current);
    setIsOpen(false);
    doNominatimSearch(searchQuery);
  };

  const handleSelectSuggestion = (loc: SavedLocation) => {
    const Leaf = leafletRef.current;
    setSearchQuery(loc.locationName);
    setPosition([loc.lat, loc.lng]);
    setLocationName(loc.locationName);
    setIsOpen(false);
    onLocationSelect(loc.lat, loc.lng, loc.locationName);
    if (markerRef.current) {
      markerRef.current.setLatLng([loc.lat, loc.lng]);
    } else if (mapRef.current && Leaf) {
      markerRef.current = Leaf.marker([loc.lat, loc.lng]).addTo(mapRef.current);
    }
    mapRef.current?.setView([loc.lat, loc.lng], 13);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Location
      </label>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex gap-2 mb-2">
          <PopoverAnchor asChild>
            <Input
              value={searchQuery}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              onFocus={() => suggestions.length > 0 && setIsOpen(true)}
              placeholder="Search location..."
              className="flex-1"
            />
          </PopoverAnchor>
          <Button
            type="button"
            onClick={handleSearch}
            disabled={isSearching}
            variant="secondary"
          >
            {isSearching ? "..." : "Search"}
          </Button>
        </div>
        <PopoverContent
          className="w-[var(--radix-popover-anchor-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              <CommandGroup>
                {suggestions.map((loc, idx) => (
                  <CommandItem
                    key={`${loc.lat}-${loc.lng}-${idx}`}
                    value={loc.locationName}
                    onSelect={() => handleSelectSuggestion(loc)}
                  >
                    {loc.locationName}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div
        ref={mapContainerRef}
        className="h-64 rounded-lg overflow-hidden border border-gray-300 relative z-0"
      />
      {locationName && (
        <p className="text-sm text-gray-600 mt-1">{locationName}</p>
      )}
    </div>
  );
}

import dynamic from "next/dynamic";
export default dynamic(() => Promise.resolve(MapPickerInner), { ssr: false });
