"use client";

import Link from "next/link";
import { useState, useRef, useEffect, useCallback } from "react";

interface PhotoItem {
  sightingId: number;
  species: string;
  date: string;
  locationName: string;
  photoFilename: string;
  width?: number;
  height?: number;
}

interface Dim { w: number; h: number }

const TARGET_HEIGHT = 220;
const GAP = 4;
const DEFAULT_ASPECT_RATIO = 1.5;

function getDim(item: PhotoItem): Dim | null {
  if (item.width && item.height) {
    return { w: item.width, h: item.height };
  }
  return null;
}

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
    const ar = d ? d.w / d.h : DEFAULT_ASPECT_RATIO;
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

function PhotoBox({
  item,
  width,
  height,
  priority,
}: {
  item: PhotoItem;
  width: number;
  height: number;
  priority?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Link
      href={`/sighting/${item.sightingId}`}
      className="relative block group overflow-hidden rounded-sm flex-none bg-gray-100"
      style={{ width, height }}
    >
      {!loaded && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
      <img
        src={`/api/uploads/${item.photoFilename}`}
        alt={item.species}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        decoding={priority ? "sync" : "async"}
      />
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
        <p className="text-white font-semibold text-sm">{item.species}</p>
        <p className="text-white/80 text-xs">{item.date}</p>
        <p className="text-white/80 text-xs">{item.locationName}</p>
      </div>
    </Link>
  );
}

export default function PhotoGrid({ items, singleColumn }: { items: PhotoItem[]; singleColumn?: boolean }) {
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

  // Derive dimensions immediately from props — no need to load images
  const dims = items.map(getDim);

  const rows =
    containerWidth > 0
      ? buildRows(items, dims, containerWidth)
      : null;

  // Determine which images get priority loading (first ~6 items)
  const getPriorityIndex = useCallback((itemIndex: number) => {
    if (!rows) return false;
    let count = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (count >= 6) return false;
        const idx = items.indexOf(rows[r][c].item);
        if (idx === itemIndex) return true;
        count++;
      }
    }
    return false;
  }, [rows, items]);

  if (singleColumn) {
    if (containerWidth === 0) {
      return (
        <div ref={containerRef} className="w-full flex flex-col" style={{ gap: GAP }}>
          {items.map((_, i) => (
            <div key={i} className="w-full aspect-[4/3] bg-gray-200 animate-pulse rounded-sm" />
          ))}
        </div>
      );
    }

    return (
      <div ref={containerRef} className="w-full flex flex-col" style={{ gap: GAP }}>
        {items.map((item, i) => {
          const d = dims[i];
          const height = d ? containerWidth / (d.w / d.h) : containerWidth * 0.75;
          return (
            <PhotoBox
              key={`${item.sightingId}-${item.photoFilename}-${i}`}
              item={item}
              width={containerWidth}
              height={height}
              priority={i < 3}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      {rows ? (
        rows.map((row, ri) => (
          <div
            key={ri}
            className="flex"
            style={{ gap: GAP, marginBottom: ri < rows.length - 1 ? GAP : 0 }}
          >
            {row.map(({ item, width, height }, ci) => {
              const itemIndex = items.indexOf(item);
              return (
                <PhotoBox
                  key={`${item.sightingId}-${item.photoFilename}-${ci}`}
                  item={item}
                  width={width}
                  height={height}
                  priority={getPriorityIndex(itemIndex)}
                />
              );
            })}
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
