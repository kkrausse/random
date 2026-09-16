import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./components/ui/button";
import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  Grid2X2,
  HardDrive,
  Image,
  Minus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { Pipeline, type Photo } from "./pipeline";

type Listing = {
  path: string;
  folders: { name: string; path: string }[];
  photos: Photo[];
};
function App() {
  const [path, setPath] = useState(
    new URLSearchParams(location.search).get("folder") ?? "",
  );
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, refresh] = useState(0);
  const [reload, setReload] = useState(0);
  const [selected, select] = useState<number | null>(null);
  const [density, setDensity] = useState(160);
  const [search, setSearch] = useState("");
  const pipeline = useRef<Pipeline>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gridTouches = useRef(new Map<number, { x: number; y: number }>());
  const gridGesture = useRef({
    distance: 0,
    density: 180,
    photo: 0,
    lastPinch: 0,
  });
  const [activity, setActivity] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const engine = new Pipeline(() => refresh((n) => n + 1));
    pipeline.current = engine;
    setLoading(true);
    setListing(undefined);
    setError("");
    select(null);
    setSearch("");
    fetch(`/api/folder?path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            "Could not open this folder. Check that the archive is mounted and available.",
          );
        const data = await r.json();
        setListing(data);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    const pagehide = () => engine.dispose();
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) setReload((n) => n + 1);
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      controller.abort();
      engine.dispose();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [path, reload]);
  useEffect(() => {
    const pop = () =>
      setPath(new URLSearchParams(location.search).get("folder") ?? "");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = (value: string) => {
    history.pushState(null, "", `?folder=${encodeURIComponent(value)}`);
    setPath(value);
  };
  const photos =
    listing?.photos.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  useEffect(() => {
    const engine = pipeline.current;
    if (!listing || !engine) return;
    const nearby = new Map<string, Photo>();
    const byPath = new Map(listing.photos.map((p) => [p.path, p]));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const path = (entry.target as HTMLElement).dataset.path!;
          const p = byPath.get(path);
          if (entry.isIntersecting && p) nearby.set(path, p);
          else nearby.delete(path);
        });
        engine.previews([...nearby.values()]);
      },
      { rootMargin: `${engine.limits.previewMargin}px` },
    );
    grid.current
      ?.querySelectorAll("[data-path]")
      .forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      engine.previews([]);
    };
  }, [listing, search]);
  useEffect(() => {
    const engine = pipeline.current;
    if (!engine) return;
    engine.pin(selected === null ? undefined : photos[selected]);
    if (selected === null || !photos[selected]) return;
    engine.reprioritize();
    engine.request(photos[selected], true, 0);
    if (engine.limits.prefetchFull)
      for (const i of [selected + 1, selected - 1])
        if (photos[i]) engine.request(photos[i], true, 1);
  }, [selected, listing, search]);
  useEffect(() => {
    setActivity(pipeline.current?.activity ?? "");
  }, [revision]);
  const engine = pipeline.current;
  const photo = selected === null ? undefined : photos[selected];
  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("");
          }}
        >
          <span className="brand-icon">
            <Grid2X2 size={20} />
          </span>
          PicSync<span className="muted desktop">/ Archive</span>
        </a>
        <div className="connection">
          <span className="dot" />
          Archive browser
        </div>
      </header>
      <main>
        <nav className="breadcrumbs" aria-label="Folder path">
          <Button onClick={() => navigate("")}>
            <HardDrive size={16} /> Archive
          </Button>
          {path
            .split("/")
            .filter(Boolean)
            .map((part, i, all) => (
              <React.Fragment key={i}>
                <ChevronRight size={14} />
                <Button onClick={() => navigate(all.slice(0, i + 1).join("/"))}>
                  {part}
                </Button>
              </React.Fragment>
            ))}
        </nav>
        <div className="heading">
          <div>
            <p className="eyebrow">YOUR PHOTO LIBRARY</p>
            <h1>{path.split("/").pop() || "Archive"}</h1>
            <p className="muted">
              {loading
                ? "Opening archive…"
                : `${listing?.folders.length ?? 0} folders · ${listing?.photos.length ?? 0} photos`}{" "}
              <span className="desktop"> · Originals, beautifully close.</span>
            </p>
          </div>
          <Button
            aria-label="Refresh folder"
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={18} />
          </Button>
        </div>
        {!crossOriginIsolated && (
          <p className="notice">
            RAW photos need a secure connection. Open this app over trusted
            HTTPS (or localhost) to enable LibRaw 1.6 development.
          </p>
        )}
        {error && (
          <div className="empty">
            <Folder size={32} />
            <p role="alert">{error}</p>
            <Button onClick={() => navigate("")}>Open archive root</Button>
          </div>
        )}
        {!!listing?.folders.length && (
          <section aria-label="Folders" className="folders">
            {listing.folders.map((folder) => (
              <Button
                className="folder"
                key={folder.path}
                onClick={() => navigate(folder.path)}
              >
                <Folder size={25} />
                <span>{folder.name}</span>
                <ChevronRight size={16} />
              </Button>
            ))}
          </section>
        )}
        {!!listing?.photos.length && (
          <>
            <div className="toolbar">
              <input
                aria-label="Find photos"
                placeholder="Find a photo…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  select(null);
                }}
              />
              <div className="density">
                <Grid2X2 size={17} />
                <input
                  aria-label="Grid tile size"
                  type="range"
                  min="100"
                  max="320"
                  value={density}
                  onChange={(e) => setDensity(Number(e.target.value))}
                />
              </div>
            </div>
            <div
              ref={grid}
              className="grid"
              style={{ "--tile": `${density}px` } as React.CSSProperties}
              onPointerDown={(e) => {
                gridTouches.current.set(e.pointerId, {
                  x: e.clientX,
                  y: e.clientY,
                });
                if (gridTouches.current.size === 1)
                  gridGesture.current.photo = Math.max(
                    0,
                    photos.findIndex(
                      (p) =>
                        p.path ===
                        (e.target as HTMLElement).closest<HTMLElement>(
                          "[data-path]",
                        )?.dataset.path,
                    ),
                  );
                if (gridTouches.current.size === 2) {
                  const [a, b] = [...gridTouches.current.values()];
                  Object.assign(gridGesture.current, {
                    distance: Math.hypot(a.x - b.x, a.y - b.y),
                    density,
                  });
                }
              }}
              onPointerMove={(e) => {
                if (!gridTouches.current.has(e.pointerId)) return;
                gridTouches.current.set(e.pointerId, {
                  x: e.clientX,
                  y: e.clientY,
                });
                if (gridTouches.current.size !== 2) return;
                const [a, b] = [...gridTouches.current.values()],
                  g = gridGesture.current;
                const next =
                  (g.density * Math.hypot(a.x - b.x, a.y - b.y)) /
                  Math.max(1, g.distance);
                g.lastPinch = Date.now();
                setDensity(Math.max(100, Math.min(320, next)));
                if (next > 350) {
                  select(g.photo);
                  gridTouches.current.clear();
                }
              }}
              onPointerUp={(e) => gridTouches.current.delete(e.pointerId)}
              onPointerCancel={() => gridTouches.current.clear()}
              onClickCapture={(e) => {
                if (Date.now() - gridGesture.current.lastPinch < 400) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              {photos.map((p, i) => {
                const render = engine?.get(p),
                  key = engine?.key(p),
                  failure = key && engine?.errors.get(key);
                return (
                  <button
                    className="tile"
                    data-path={p.path}
                    key={p.path}
                    onClick={() => select(i)}
                    aria-label={`Open ${p.name}`}
                    title={failure || p.name}
                  >
                    {render ? (
                      <img src={render.url} alt={p.name} loading="lazy" />
                    ) : (
                      <div
                        className={`placeholder ${failure ? "" : "skeleton"}`}
                        aria-busy={!failure}
                      >
                        <Image size={26} />
                        <span>
                          {failure
                            ? `Preview unavailable: ${failure}`
                            : (key && engine?.states.get(key)) || "Queued"}
                        </span>
                      </div>
                    )}
                    <span className="filetype">{p.name.split(".").pop()}</span>
                    <span className="caption">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {!loading && !error && !listing?.photos.length && (
          <div className="empty">
            <Image size={36} />
            <h2>
              {listing?.folders.length
                ? "Choose a folder to explore"
                : "No photos in this folder"}
            </h2>
            <p className="muted">ARW, DNG, JPEG, HEIC, PNG, WebP and AVIF</p>
          </div>
        )}
        <footer>
          <span>
            <span className="dot" /> {activity || "Ready to explore"}
          </span>
          <span>LibRaw 1.6 · {engine?.limits.workers ?? 10}-worker pool</span>
        </footer>
      </main>
      <Dialog.Root
        open={!!photo}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="backdrop" />
          <Dialog.Popup className="viewer">
            {photo && engine && (
              <Viewer
                key={photo.path}
                photo={photo}
                engine={engine}
                revision={revision}
                index={selected!}
                count={photos.length}
                close={() => select(null)}
                move={(delta) =>
                  select((i) =>
                    i === null
                      ? null
                      : Math.max(0, Math.min(photos.length - 1, i + delta)),
                  )
                }
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
function Viewer({
  photo,
  engine,
  index,
  count,
  close,
  move,
}: {
  photo: Photo;
  engine: Pipeline;
  revision: number;
  index: number;
  count: number;
  close: () => void;
  move: (d: number) => void;
}) {
  const full = engine.get(photo, true),
    preview = engine.get(photo),
    render = full ?? preview;
  const error = engine.errors.get(engine.key(photo, true));
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    distance: 0,
    zoom: 1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    pinch: false,
  });
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node || !full?.bitmap) return;
    node.width = full.width;
    node.height = full.height;
    node.getContext("2d")?.drawImage(full.bitmap, 0, 0);
    return () => {
      node.width = node.height = 0;
    };
  }, [full]);
  const clampPan = (x: number, y: number) => {
    const image = stage.current?.querySelector<HTMLElement>(".full-photo");
    const bounds = stage.current;
    if (!image || !bounds) return { x: 0, y: 0 };
    const maxX = Math.max(
      0,
      (image.clientWidth * zoom - bounds.clientWidth) / 2,
    );
    const maxY = Math.max(
      0,
      (image.clientHeight * zoom - bounds.clientHeight) / 2,
    );
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };
  const applyZoom = (value: number) => {
    setZoom(Math.max(0.65, Math.min(64, value)));
    if (value <= 1) setPan({ x: 0, y: 0 });
  };
  const actualPixels = () => {
    const image = stage.current?.querySelector<HTMLElement>(".full-photo");
    if (image && full)
      applyZoom(
        Math.max(
          full.width / image.clientWidth,
          full.height / image.clientHeight,
        ) / window.devicePixelRatio,
      );
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") move(1);
      if (e.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index]);
  useEffect(() => {
    const node = stage.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) =>
        Math.max(0.65, Math.min(64, z * Math.exp(-e.deltaY * 0.003))),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (zoom < 0.72) close();
    setPan((p) => clampPan(p.x, p.y));
  }, [zoom]);
  return (
    <>
      <div className="viewer-top">
        <Button onClick={close}>
          <ArrowLeft size={18} />
          <span className="desktop">All photos</span>
        </Button>
        <div className="viewer-title">
          <Dialog.Title>{photo.name}</Dialog.Title>
          <Dialog.Description>
            {index + 1} of {count} · {(photo.bytes / 1048576).toFixed(1)} MB
          </Dialog.Description>
        </div>
        <Dialog.Close className="button" aria-label="Close photo">
          <X size={20} />
        </Dialog.Close>
      </div>
      <div
        ref={stage}
        className={`stage ${zoom > 1 ? (dragging ? "grabbing" : "grab") : ""}`}
        onDoubleClick={() => applyZoom(zoom > 1 ? 1 : 2.5)}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture.current;
          if (pointers.current.size === 1)
            Object.assign(g, {
              startX: e.clientX,
              startY: e.clientY,
              lastX: e.clientX,
              lastY: e.clientY,
              pinch: false,
            });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            Object.assign(g, {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              zoom,
              pinch: true,
            });
          }
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture.current;
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            applyZoom(
              (g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
                Math.max(1, g.distance),
            );
          } else if (zoom > 1 && !g.pinch) {
            const dx = e.clientX - g.lastX,
              dy = e.clientY - g.lastY;
            setPan((p) => clampPan(p.x + dx, p.y + dy));
          }
          g.lastX = e.clientX;
          g.lastY = e.clientY;
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          const g = gesture.current;
          if (pointers.current.size) return;
          setDragging(false);
          if (zoom < 0.8) close();
          else if (
            !g.pinch &&
            zoom <= 1 &&
            Math.abs(e.clientX - g.startX) > 60 &&
            Math.abs(e.clientX - g.startX) > Math.abs(e.clientY - g.startY)
          )
            move(e.clientX < g.startX ? 1 : -1);
          else if (zoom < 1) applyZoom(1);
        }}
        onPointerCancel={() => {
          setDragging(false);
          pointers.current.clear();
          applyZoom(1);
        }}
      >
        {full ? (
          <canvas
            ref={canvas}
            className="full-photo"
            role="img"
            aria-label={photo.name}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          />
        ) : render ? (
          <img
            className="full-photo"
            src={render.url}
            alt={photo.name}
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          />
        ) : (
          <div
            className={`placeholder photo-skeleton ${error ? "" : "skeleton"}`}
            aria-busy={!error}
          >
            <Image size={44} />
            <p>{error ? "Photo unavailable" : "Preparing your photo…"}</p>
          </div>
        )}
      </div>
      <Button
        className="previous arrow"
        aria-label="Previous photo"
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        className="next arrow"
        aria-label="Next photo"
        disabled={index === count - 1}
        onClick={() => move(1)}
      >
        <ChevronRight />
      </Button>
      <div className="viewer-bottom">
        <div className="render-status" role="status">
          {full ? (
            <>
              <span className="dot" />
              Full resolution · {full.width} × {full.height}
            </>
          ) : error ? (
            <>
              <span>{error}</span>
              <Button onClick={() => engine.retry(photo, true)}>Retry</Button>
            </>
          ) : (
            <>
              <span className="dot pulse" />
              {engine.states.get(engine.key(photo, true)) ||
                "Queued for full resolution"}
            </>
          )}
        </div>
        <div className="zoom-controls">
          <Button
            aria-label="Zoom out"
            onClick={() => (zoom <= 1 ? close() : applyZoom(zoom / 1.5))}
          >
            <Minus size={18} />
          </Button>
          <Button aria-label="Fit photo" onClick={() => applyZoom(1)}>
            {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
          </Button>
          <Button aria-label="Zoom in" onClick={() => applyZoom(zoom * 1.5)}>
            <Plus size={18} />
          </Button>
          <Button
            aria-label="Actual pixels"
            disabled={!full}
            onClick={actualPixels}
          >
            1:1
          </Button>
          <Button onClick={close} aria-label="Return to grid">
            <Grid2X2 size={18} />
          </Button>
          <a
            className="button"
            href={`/api/photo?path=${encodeURIComponent(photo.path)}`}
            download={photo.name}
            aria-label="Download original"
          >
            <Download size={18} />
          </a>
        </div>
        <span className="muted hint">
          Pinch to zoom · Swipe to browse · Zoom out for grid
        </span>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
