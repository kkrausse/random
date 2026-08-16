import { StrictMode, useEffect, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import type { MediaAsset, MediaInfo } from "../../lib/types";
import "./styles.css";

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatBitrate(bitsPerSecond: number | undefined) {
  return bitsPerSecond ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mb/s` : undefined;
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
  const [playbackSource, setPlaybackSource] = useState<"proxy" | "original">("proxy");
  const [playbackError, setPlaybackError] = useState<string>();
  const [libraryError, setLibraryError] = useState<string>();

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

  function selectAsset(asset: MediaAsset) {
    setSelection(asset);
    setVideoInfo(undefined);
    setPlaybackError(undefined);
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

  const activePlaybackSource = playbackSource === "proxy" && mediaInfo?.proxy ? "proxy" : "original";

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
              {videoInfo && <span className="duration-badge">{formatDuration(videoInfo.duration)}</span>}
            </div>
          </div>

          <div className="viewer-stage">
            {!selection && <div className="viewer-placeholder"><span>Choose a clip from the library</span></div>}
            {selection && mediaInfoLoaded && (
              <video
                key={`${selection.id}:${activePlaybackSource}`}
                src={`/api/media/video?id=${encodeURIComponent(selection.id)}&source=${activePlaybackSource}`}
                controls
                autoPlay
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => setVideoInfo({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight,
                  duration: event.currentTarget.duration,
                })}
                onError={() => setPlaybackError("This browser cannot play the source file's container or codec.")}
              />
            )}
            {playbackError && <div className="error-message stage-error playback-error">{playbackError}</div>}
          </div>

          <footer className="viewer-meta">
            {mediaInfo || videoInfo ? (
              <>
                <span>{videoInfo?.width ?? mediaInfo?.width} × {videoInfo?.height ?? mediaInfo?.height}</span>
                {mediaInfo?.codec && <span>{mediaInfo.codec.toUpperCase()} {mediaInfo.profile}</span>}
                {mediaInfo?.pixelFormat && <span>{mediaInfo.pixelFormat}</span>}
                {mediaInfo?.videoBitrate && <span>Video {formatBitrate(mediaInfo.videoBitrate)}</span>}
                {mediaInfo && mediaInfo.fps > 0 && <span>{mediaInfo.fps.toFixed(2)} fps</span>}
                <span>{activePlaybackSource === "proxy" ? "1080p proxy" : "Original file"}</span>
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
