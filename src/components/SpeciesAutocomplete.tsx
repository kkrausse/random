"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Species {
  commonName: string;
  scientificName: string;
  speciesCode: string;
}

interface Props {
  onSelect: (species: Species) => void;
  initialValue?: string;
}

export default function SpeciesAutocomplete({ onSelect, initialValue = "" }: Props) {
  const [query, setQuery] = useState(initialValue);
  const [results, setResults] = useState<Species[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/species?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(data);
    setIsOpen(true);
    setHighlightIdx(-1);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 300);
  };

  const handleSelect = (species: Species) => {
    setQuery(species.commonName);
    setIsOpen(false);
    onSelect(species);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      handleSelect(results[highlightIdx]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative z-10">
      <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder="Search for a species..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-lg max-h-60 overflow-y-auto">
          {results.map((species, idx) => (
            <li
              key={species.speciesCode}
              onClick={() => handleSelect(species)}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`px-3 py-2 cursor-pointer ${
                idx === highlightIdx ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="font-medium">{species.commonName}</div>
              <div className="text-sm text-gray-500 italic">{species.scientificName}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
