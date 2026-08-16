import { StrictMode, useEffect, useState } from "react";
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
    if (!selection) return;
    const controller = new AbortController();
    fetch(`/api/media/info?id=${encodeURIComponent(selection.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Metadata unavailable");
        setMediaInfo(await response.json());
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      });
    return () => controller.abort();
  }, [selection]);

  function selectAsset(asset: MediaAsset) {
    setSelection(asset);
    setVideoInfo(undefined);
    setPlaybackError(undefined);
  }

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
          <div className="clip-list">
            {media.map((asset, index) => (
              <button
                className={selection?.id === asset.id ? "clip-row selected" : "clip-row"}
                key={asset.id}
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
            {videoInfo && <span className="duration-badge">{formatDuration(videoInfo.duration)}</span>}
          </div>

          <div className="viewer-stage">
            {!selection && <div className="viewer-placeholder"><span>Choose a clip from the library</span></div>}
            {selection && (
              <video
                key={selection.id}
                src={`/api/media/video?id=${encodeURIComponent(selection.id)}`}
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
                <span>{mediaInfo?.width ?? videoInfo?.width} × {mediaInfo?.height ?? videoInfo?.height}</span>
                {mediaInfo?.codec && <span>{mediaInfo.codec.toUpperCase()} {mediaInfo.profile}</span>}
                {mediaInfo?.pixelFormat && <span>{mediaInfo.pixelFormat}</span>}
                {mediaInfo?.videoBitrate && <span>Video {formatBitrate(mediaInfo.videoBitrate)}</span>}
                {mediaInfo && mediaInfo.fps > 0 && <span>{mediaInfo.fps.toFixed(2)} fps</span>}
                <span>Original file</span>
                <span>No proxy</span>
              </>
            ) : <span>Direct playback / no processing or copies</span>}
          </footer>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
