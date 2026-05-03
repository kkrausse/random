"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Heart, MessageCircle } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MouseEvent, useState, useRef, useEffect, useCallback } from "react";

interface PhotoItem {
  photoId: number;
  sightingId: number;
  species: string;
  date: string;
  locationName: string;
  photoFilename: string;
  username?: string;
  width?: number;
  height?: number;
  likeCount?: number;
  commentCount?: number;
  likedByCurrentUser?: boolean;
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
  alwaysShowActions,
}: {
  item: PhotoItem;
  width: number;
  height: number;
  priority?: boolean;
  alwaysShowActions?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState(false);
  const [liked, setLiked] = useState(Boolean(item.likedByCurrentUser));
  const [likeCount, setLikeCount] = useState(item.likeCount ?? 0);
  const [likePending, setLikePending] = useState(false);
  const commentCount = item.commentCount ?? 0;

  function redirectToSignIn() {
    const query = searchParams.toString();
    const returnTo = `${pathname}${query ? `?${query}` : ""}`;
    router.push(
      `/sign-in?redirect_url=${encodeURIComponent(returnTo)}` as Route
    );
  }

  async function toggleLike(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (likePending) return;

    setLikePending(true);
    const nextLiked = !liked;
    try {
      const response = await fetch(`/api/photos/${item.photoId}/likes`, {
        method: nextLiked ? "POST" : "DELETE",
      });

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      if (response.ok) {
        setLiked(nextLiked);
        setLikeCount((count) => Math.max(0, count + (nextLiked ? 1 : -1)));
      }
    } finally {
      setLikePending(false);
    }
  }

  return (
    <div
      className="relative block group overflow-hidden rounded-sm flex-none bg-gray-100"
      style={{ width, height }}
    >
      <Link
        href={`/sighting/${item.sightingId}?photo=${item.photoId}`}
        className="absolute inset-0 z-10"
      >
        <span className="sr-only">View {item.species} sighting</span>
      </Link>
      {!loaded && (
        <Skeleton className="absolute inset-0 rounded-none" />
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
      <div className="pointer-events-none absolute inset-0 z-20 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 pr-24 pb-9">
        <p className="text-white font-semibold text-sm">{item.species}</p>
        <p className="text-white/80 text-xs">{item.date}</p>
        <p className="text-white/80 text-xs">{item.locationName}</p>
        {item.username && (
          <Link
            href={`/user/${item.username}`}
            className="pointer-events-auto relative z-10 mt-1 text-white/90 text-xs font-medium hover:text-white hover:underline"
          >
            @{item.username}
          </Link>
        )}
      </div>
      <div
        className={cn(
          "pointer-events-none absolute bottom-2 right-2 z-30 flex items-center gap-1.5 rounded-md bg-black/55 px-1.5 py-1 text-xs font-medium text-white opacity-100 shadow-sm backdrop-blur-sm transition-opacity",
          !alwaysShowActions && "md:opacity-0 md:group-hover:opacity-100"
        )}
      >
        <Link
          href={`/sighting/${item.sightingId}?photo=${item.photoId}#photo-${item.photoId}-comments`}
          className="pointer-events-auto flex min-w-0 items-center gap-1 rounded px-1 hover:bg-white/20"
          aria-label={`${commentCount} comments`}
        >
          <MessageCircle className="size-3.5" />
          <span className="min-w-[1.25rem] text-right tabular-nums">
            {commentCount}
          </span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={toggleLike}
          disabled={likePending}
          aria-pressed={liked}
          aria-label={liked ? "Unlike photo" : "Like photo"}
          className={cn(
            "pointer-events-auto h-6 gap-1 rounded px-1 text-xs text-white hover:bg-white/20 hover:text-white",
            liked && "text-red-400 hover:text-red-300"
          )}
        >
          <Heart className={cn("size-3.5", liked && "fill-current")} />
          <span className="min-w-[1.25rem] text-right tabular-nums">
            {likeCount}
          </span>
        </Button>
      </div>
    </div>
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
  const isOneAcross = Boolean(singleColumn || (rows && rows.every((row) => row.length === 1)));

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
              alwaysShowActions
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
                  alwaysShowActions={isOneAcross}
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
