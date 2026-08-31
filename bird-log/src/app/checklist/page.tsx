"use client";

import { useEffect, useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { type Species } from "@/lib/fuzzy";
import { useMirroredUser } from "@/lib/use-mirrored-user";

export default function ChecklistPage() {
  const { user } = useMirroredUser();
  const [allSpecies, setAllSpecies] = useState<Species[]>([]);
  const [seenCodes, setSeenCodes] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [showSeen, setShowSeen] = useState<"all" | "seen" | "unseen">("seen");
  const [loading, setLoading] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      import("@/data/species.json").then(m => m.default as Species[]),
      fetch("/api/sightings").then((r) => r.json()),
    ]).then(([species, sightings]) => {
      const seen = new Set<string>(
        sightings.map((s: { speciesCode: string }) => s.speciesCode)
      );
      setAllSpecies(species);
      setSeenCodes(seen);
      setLoading(false);
    });
  }, []);

  const filtered = allSpecies.filter((s) => {
    const matchesFilter =
      !filter ||
      s.commonName.toLowerCase().includes(filter.toLowerCase()) ||
      s.scientificName.toLowerCase().includes(filter.toLowerCase());
    const matchesShow =
      showSeen === "all" ||
      (showSeen === "seen" && seenCodes.has(s.speciesCode)) ||
      (showSeen === "unseen" && !seenCodes.has(s.speciesCode));
    return matchesFilter && matchesShow;
  });

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 20,
  });

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading checklist...</div>;
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">BirdMog Checklist</h1>
        {user?.username && (
          <Link
            href={`/user/${user.username}/checklist`}
            className="text-sm text-green-700 hover:underline"
          >
            Switch to my list
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-3">
        {seenCodes.size} of {allSpecies.length} species seen by BirdMog users
      </p>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter species..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={showSeen}
          onChange={(e) =>
            setShowSeen(e.target.value as "all" | "seen" | "unseen")
          }
          className="border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value="all">All</option>
          <option value="seen">Seen by BirdMog</option>
          <option value="unseen">Not seen on BirdMog</option>
        </select>
      </div>

      <p className="text-xs text-gray-400 mb-2">
        Showing {filtered.length} species
      </p>

      <div
        ref={parentRef}
        className="h-[calc(100vh-280px)] overflow-auto border border-gray-200 rounded-lg"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const species = filtered[virtualItem.index];
            const isSeen = seenCodes.has(species.speciesCode);
            return (
              <Link
                key={species.speciesCode}
                href={`/species/${species.speciesCode}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className={`flex items-center px-3 border-b border-gray-100 hover:bg-opacity-80 ${
                  isSeen ? "bg-green-50 hover:bg-green-100" : "hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs mr-3 flex-shrink-0 ${
                    isSeen
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-400"
                  }`}
                >
                  {isSeen ? "\u2713" : ""}
                </span>
                <div className="min-w-0">
                  <div
                    className={`font-medium truncate ${
                      isSeen ? "text-green-800" : "text-gray-700"
                    }`}
                  >
                    {species.commonName}
                  </div>
                  <div className="text-xs text-gray-400 italic truncate">
                    {species.scientificName}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
