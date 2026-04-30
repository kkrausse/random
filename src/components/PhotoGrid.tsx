"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";

interface PhotoItem {
  sightingId: number;
  species: string;
  date: string;
  locationName: string;
  photoFilename: string;
}

interface Dim { w: number; h: number }

const TARGET_HEIGHT = 220;
const GAP = 4;

function buildRows(
  items: PhotoItem[],
  dims: (Dim | null)[],
  containerWidth: number
) {
  type RowItem = { item: PhotoItem; width: number; height: number };
  const rows: RowItem[][] = [];
  let currentRow: { item: PhotoItem; ar: number }[] = [];

  const flush = (row: typeof currentRow, last: boolean) => {
    if (!row.length) return;
    const totalGaps = (row.length - 1) * GAP;
    const totalAr = row.reduce((s, r) => s + r.ar, 0);
    const height =
      last && row.length <= 2
        ? TARGET_HEIGHT
        : (containerWidth - totalGaps) / totalAr;
    rows.push(row.map(({ item, ar }) => ({ item, width: ar * height, height })));
  };

  for (let i = 0; i < items.length; i++) {
    const d = dims[i];
    const ar = d ? d.w / d.h : 1;
    const scaledW = ar * TARGET_HEIGHT;
    const usedW = currentRow.reduce((s, r) => s + r.ar * TARGET_HEIGHT, 0);
    const gaps = currentRow.length * GAP;

    if (currentRow.length > 0 && usedW + gaps + scaledW > containerWidth) {
      flush(currentRow, false);
      currentRow = [];
    }
    currentRow.push({ item: items[i], ar });
  }
  flush(currentRow, true);
  return rows;
}

export default function PhotoGrid({ items }: { items: PhotoItem[] }) {
  const [dims, setDims] = useState<(Dim | null)[]>(() => items.map(() => null));
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    setContainerWidth(containerRef.current.offsetWidth);
    const ro = new ResizeObserver(([e]) =>
      setContainerWidth(e.contentRect.width)
    );
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setDims(items.map(() => null));
    const images: HTMLImageElement[] = [];
    items.forEach((item, i) => {
      const img = new window.Image();
      images.push(img);
      img.onload = () => {
        setDims((prev) => {
          const next = [...prev];
          next[i] = { w: img.naturalWidth, h: img.naturalHeight };
          return next;
        });
      };
      img.src = `/api/uploads/${item.photoFilename}`;
    });
    return () => {
      images.forEach((img) => { img.onload = null; });
    };
  }, [items]);

  const allLoaded = dims.every(Boolean);
  const rows =
    allLoaded && containerWidth > 0
      ? buildRows(items, dims, containerWidth)
      : null;

  return (
    <div ref={containerRef} className="w-full">
      {rows ? (
        rows.map((row, ri) => (
          <div
            key={ri}
            className="flex"
            style={{ gap: GAP, marginBottom: ri < rows.length - 1 ? GAP : 0 }}
          >
            {row.map(({ item, width, height }, ci) => (
              <Link
                key={`${item.sightingId}-${item.photoFilename}-${ci}`}
                href={`/sighting/${item.sightingId}`}
                className="relative block group overflow-hidden rounded-sm flex-none"
                style={{ width, height }}
              >
                <img
                  src={`/api/uploads/${item.photoFilename}`}
                  alt={item.species}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                  <p className="text-white font-semibold text-sm">{item.species}</p>
                  <p className="text-white/80 text-xs">{item.date}</p>
                  <p className="text-white/80 text-xs">{item.locationName}</p>
                </div>
              </Link>
            ))}
          </div>
        ))
      ) : (
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
        >
          {items.map((_, i) => (
            <div
              key={i}
              className="aspect-square bg-gray-200 animate-pulse rounded-sm"
            />
          ))}
        </div>
      )}
    </div>
  );
}
