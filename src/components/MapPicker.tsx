"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type L from "leaflet";

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
  const [isFocused, setIsFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suggestionsRef = useRef<HTMLDivElement>(null);
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
  const suggestions = isFocused
    ? q.length > 0
      ? savedLocations.filter((loc) => loc.locationName.toLowerCase().includes(q))
      : savedLocations
    : [];
  const showSuggestions = suggestions.length > 0;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

    let map: L.Map;

    import("leaflet").then((leaflet) => {
      const Leaf = leaflet.default;
      leafletRef.current = Leaf;

      // Import CSS
      // CSS loaded via layout.tsx

      // Fix default icon
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

      if (!mapContainerRef.current) return;

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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`
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
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timerRef.current);
      handleSearch();
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    clearTimeout(timerRef.current);
    setHighlightIdx(-1);
    setIsFocused(true);

    if (value.trim().length > 2) {
      timerRef.current = setTimeout(handleSearch, 500);
    }
  };

  const handleSelectSuggestion = (loc: SavedLocation) => {
    const Leaf = leafletRef.current;
    setSearchQuery(loc.locationName);
    setPosition([loc.lat, loc.lng]);
    setLocationName(loc.locationName);
    setIsFocused(false);
    onLocationSelect(loc.lat, loc.lng, loc.locationName);
    if (markerRef.current) {
      markerRef.current.setLatLng([loc.lat, loc.lng]);
    } else if (mapRef.current && Leaf) {
      markerRef.current = Leaf.marker([loc.lat, loc.lng]).addTo(mapRef.current);
    }
    mapRef.current?.setView([loc.lat, loc.lng], 13);
  };

  const handleSuggestionKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[highlightIdx]);
    } else if (e.key === "Escape") {
      setIsFocused(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Location
      </label>
      <div className="relative z-[1000]" ref={suggestionsRef}>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              handleSuggestionKeyDown(e);
              if (!showSuggestions || highlightIdx < 0) handleSearchKeyDown(e);
            }}
            onFocus={() => setIsFocused(true)}
            placeholder="Search location..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={isSearching}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto -mt-1">
            {suggestions.map((loc, idx) => (
              <li
                key={`${loc.lat}-${loc.lng}-${idx}`}
                onClick={() => handleSelectSuggestion(loc)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={`px-3 py-2 cursor-pointer text-sm ${
                  idx === highlightIdx ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
              >
                {loc.locationName}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        ref={mapContainerRef}
        className="h-64 rounded-lg overflow-hidden border border-gray-300"
      />
      {locationName && (
        <p className="text-sm text-gray-600 mt-1">{locationName}</p>
      )}
    </div>
  );
}

import dynamic from "next/dynamic";
export default dynamic(() => Promise.resolve(MapPickerInner), { ssr: false });
