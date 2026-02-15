"use client";

import { useState, useRef } from "react";
import SightingCard from "@/components/SightingCard";

interface Photo {
  id: number;
  filename: string;
}

interface Sighting {
  id: number;
  species: string;
  speciesCode: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
  notes: string | null;
  photos: Photo[];
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Sighting[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data);
    setSearched(true);
    setLoading(false);
  };

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(value), 300);
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Search Sightings</h1>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search by species, location, or notes..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {loading && (
        <p className="text-gray-500 text-center">Searching...</p>
      )}
      {!loading && searched && results.length === 0 && (
        <p className="text-gray-500 text-center">No results found.</p>
      )}
      <div className="space-y-3">
        {results.map((sighting) => (
          <SightingCard key={sighting.id} sighting={sighting} />
        ))}
      </div>
    </div>
  );
}
