import { StrictMode, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import type { MediaAsset, MediaInfo, NormalizedCrop, PlaybackSource } from "../../lib/types";
import "./styles.css";

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatBitrate(bitsPerSecond: number | undefined) {
  return bitsPerSecond ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mb/s` : undefined;
}

const defaultCrop: NormalizedCrop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const minimumCropSize = 0.05;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function Thumbnail({ asset }: { asset: MediaAsset }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="thumbnail-missing">No thumbnail</span>;
  return (
    <img
      src={`/api/media/thumbnail?id=${encodeURIComponent(asset.id)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function App() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [selection, setSelection] = useState<MediaAsset>();
  const [videoInfo, setVideoInfo] = useState<{ width: number; height: number; duration: number }>();
  const [mediaInfo, setMediaInfo] = useState<MediaInfo>();
  const [mediaInfoLoaded, setMediaInfoLoaded] = useState(false);
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>("proxy");
  const [stabilize, setStabilize] = useState(false);
  const [stabilizedPreview, setStabilizedPreview] = useState<{ workId: string; url: string }>();
  const [stabilizing, setStabilizing] = useState(false);
  const [crop, setCrop] = useState<NormalizedCrop>();
  const [playbackError, setPlaybackError] = useState<string>();
  const [libraryError, setLibraryError] = useState<string>();
  const videoFrame = useRef<HTMLDivElement>(null);
  const cropInteraction = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    crop: NormalizedCrop;
    direction?: string;
  } | undefined>(undefined);

  useEffect(() => {
    fetch("/api/media")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setMedia(body.media);
      })
      .catch((error) => setLibraryError(error instanceof Error ? error.message : "Could not load library"));
  }, []);

  useEffect(() => {
    setMediaInfo(undefined);
    setMediaInfoLoaded(false);
    if (!selection) return;
    const controller = new AbortController();
    fetch(`/api/media/info?id=${encodeURIComponent(selection.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Metadata unavailable");
        setMediaInfo(await response.json());
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMediaInfoLoaded(true);
      });
    return () => controller.abort();
  }, [selection]);

  const activePlaybackSource: PlaybackSource = playbackSource === "proxy" && mediaInfo?.proxy ? "proxy" : "original";

  useEffect(() => {
    setStabilizedPreview(undefined);
    if (!stabilize || !selection || !mediaInfoLoaded) {
      setStabilizing(false);
      return;
    }

    const controller = new AbortController();
    let workId: string | undefined;
    setStabilizing(true);
    setPlaybackError(undefined);
    fetch("/api/media/stabilize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selection.id, source: activePlaybackSource }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Stabilization failed");
        workId = body.workId;
        setStabilizedPreview(body);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setPlaybackError(error instanceof Error ? error.message : "Stabilization failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setStabilizing(false);
      });

    return () => {
      controller.abort();
      if (workId) void fetch(`/api/media/work?id=${encodeURIComponent(workId)}`, { method: "DELETE" });
    };
  }, [activePlaybackSource, mediaInfoLoaded, selection, stabilize]);

  function selectAsset(asset: MediaAsset) {
    setSelection(asset);
    setVideoInfo(undefined);
    setPlaybackError(undefined);
    setStabilize(false);
    setCrop(undefined);
  }

  function navigateLibrary(event: KeyboardEvent<HTMLDivElement>) {
    if (!event.key.startsWith("Arrow") && event.key !== "Home" && event.key !== "End") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".clip-row"));
    const current = (event.target as Element).closest<HTMLButtonElement>(".clip-row");
    const currentIndex = current ? buttons.indexOf(current) : -1;
    if (currentIndex < 0 || !buttons[0]) return;

    const columns = buttons.findIndex((button) => button.offsetTop !== buttons[0]!.offsetTop);
    const columnCount = columns === -1 ? buttons.length : columns;
    const nextIndex = {
      ArrowLeft: currentIndex - 1,
      ArrowRight: currentIndex + 1,
      ArrowUp: currentIndex - columnCount,
      ArrowDown: currentIndex + columnCount,
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (nextIndex === undefined || nextIndex < 0 || nextIndex >= buttons.length) return;
    event.preventDefault();
    buttons[nextIndex]!.focus();
    buttons[nextIndex]!.click();
  }

  function beginCropInteraction(event: PointerEvent<HTMLDivElement>, direction?: string) {
    if (!crop) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropInteraction.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      crop,
      direction,
    };
  }

  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    const interaction = cropInteraction.current;
    const frameBounds = videoFrame.current?.getBoundingClientRect();
    if (!interaction || interaction.pointerId !== event.pointerId || !frameBounds) return;

    const dx = (event.clientX - interaction.startX) / frameBounds.width;
    const dy = (event.clientY - interaction.startY) / frameBounds.height;
    const start = interaction.crop;
    if (!interaction.direction) {
      setCrop({
        ...start,
        x: clamp(start.x + dx, 0, 1 - start.width),
        y: clamp(start.y + dy, 0, 1 - start.height),
      });
      return;
    }

    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (interaction.direction.includes("w")) left = clamp(start.x + dx, 0, right - minimumCropSize);
    if (interaction.direction.includes("e")) right = clamp(right + dx, left + minimumCropSize, 1);
    if (interaction.direction.includes("n")) top = clamp(start.y + dy, 0, bottom - minimumCropSize);
    if (interaction.direction.includes("s")) bottom = clamp(bottom + dy, top + minimumCropSize, 1);
    setCrop({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function endCropInteraction(event: PointerEvent<HTMLDivElement>) {
    if (cropInteraction.current?.pointerId !== event.pointerId) return;
    cropInteraction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const videoUrl = stabilizedPreview?.url
    ?? (selection ? `/api/media/video?id=${encodeURIComponent(selection.id)}&source=${activePlaybackSource}` : undefined);

  return (
    <main className="app-shell">
      <header className="masthead">
        <h1>Video Library</h1>
        <div className="library-count"><strong>{media.length}</strong><span>source clips</span></div>
      </header>

      <section className="workspace">
        <aside className="library-panel">
          <div className="panel-heading">
            <h2>Library</h2>
            <span>Originals / read only</span>
          </div>
          {libraryError && <p className="error-message">{libraryError}</p>}
          {!libraryError && media.length === 0 && <p className="empty-message">Scanning library...</p>}
          <div className="clip-list" role="group" aria-label="Source clips" onKeyDown={navigateLibrary}>
            {media.map((asset, index) => (
              <button
                className={selection?.id === asset.id ? "clip-row selected" : "clip-row"}
                key={asset.id}
                aria-pressed={selection?.id === asset.id}
                tabIndex={selection?.id === asset.id || (!selection && index === 0) ? 0 : -1}
                onClick={() => selectAsset(asset)}
              >
                <span className="clip-thumbnail"><Thumbnail asset={asset} /></span>
                <span className="clip-caption">
                  <span className="clip-name" title={asset.relativePath}>{asset.filename}</span>
                  <span className="clip-index">Clip {String(index + 1).padStart(3, "0")}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="viewer-panel">
          <div className="viewer-heading">
            <div>
              <p className="eyebrow">Viewer</p>
              <h2>{selection?.filename ?? "Select a source clip"}</h2>
            </div>
            <div className="viewer-actions">
              {selection && (
                <div className="source-toggle" aria-label="Playback source">
                  <button className={activePlaybackSource === "proxy" ? "active" : ""} onClick={() => setPlaybackSource("proxy")} disabled={!mediaInfo?.proxy}>Proxy</button>
                  <button className={activePlaybackSource === "original" ? "active" : ""} onClick={() => setPlaybackSource("original")}>Original</button>
                </div>
              )}
              {selection && <button className={stabilize ? "edit-toggle active" : "edit-toggle"} aria-pressed={stabilize} onClick={() => setStabilize((value) => !value)}>Stabilize</button>}
              {selection && <button className={crop ? "edit-toggle active" : "edit-toggle"} aria-pressed={Boolean(crop)} onClick={() => setCrop((value) => value ? undefined : defaultCrop)}>Crop</button>}
              {stabilizing && <span className="processing-badge">Stabilizing...</span>}
              {videoInfo && <span className="duration-badge">{formatDuration(videoInfo.duration)}</span>}
            </div>
          </div>

          <div className="viewer-stage">
            {!selection && <div className="viewer-placeholder"><span>Choose a clip from the library</span></div>}
            {selection && mediaInfoLoaded && (
              <div ref={videoFrame} className="video-frame" style={{ aspectRatio: `${videoInfo?.width ?? mediaInfo?.width ?? 16} / ${videoInfo?.height ?? mediaInfo?.height ?? 9}` }}>
                <video
                  key={`${selection.id}:${activePlaybackSource}:${stabilizedPreview?.workId ?? "direct"}`}
                  src={videoUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => setVideoInfo({
                    width: event.currentTarget.videoWidth,
                    height: event.currentTarget.videoHeight,
                    duration: event.currentTarget.duration,
                  })}
                  onError={() => setPlaybackError("This browser cannot play the selected video pipeline output.")}
                />
                {crop && (
                  <div
                    className="crop-rectangle"
                    aria-label="Crop area. Drag to reposition and use the handles to resize."
                    onPointerDown={(event) => beginCropInteraction(event, (event.target as HTMLElement).dataset.direction)}
                    onPointerMove={moveCrop}
                    onPointerUp={endCropInteraction}
                    onPointerCancel={endCropInteraction}
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  >
                    {(["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const).map((direction) => (
                      <span key={direction} className={`crop-handle crop-handle-${direction}`} data-direction={direction} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {playbackError && <div className="error-message stage-error playback-error">{playbackError}</div>}
          </div>

          {crop && (
            <div className="crop-controls">
              <span>Drag to move. Resize from any edge or corner.</span>
              <output>{Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%</output>
              <button onClick={() => setCrop(defaultCrop)}>Reset</button>
            </div>
          )}

          <footer className="viewer-meta">
            {mediaInfo || videoInfo ? (
              <>
                <span>{videoInfo?.width ?? mediaInfo?.width} × {videoInfo?.height ?? mediaInfo?.height}</span>
                {mediaInfo?.codec && <span>{mediaInfo.codec.toUpperCase()} {mediaInfo.profile}</span>}
                {mediaInfo?.pixelFormat && <span>{mediaInfo.pixelFormat}</span>}
                {mediaInfo?.videoBitrate && <span>Video {formatBitrate(mediaInfo.videoBitrate)}</span>}
                {mediaInfo && mediaInfo.fps > 0 && <span>{mediaInfo.fps.toFixed(2)} fps</span>}
                <span>{activePlaybackSource === "proxy" ? "1080p proxy" : "Original file"}</span>
                {stabilizedPreview && <span>Stabilized preview</span>}
                <span>{mediaInfo?.proxy ? "Proxy available" : "No proxy"}</span>
              </>
            ) : <span>Direct playback / no processing or copies</span>}
          </footer>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
