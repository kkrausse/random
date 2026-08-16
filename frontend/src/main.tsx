import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MediaAsset } from "../../lib/types";
import "./styles.css";

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function App() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [selection, setSelection] = useState<MediaAsset>();
  const [videoInfo, setVideoInfo] = useState<{ width: number; height: number; duration: number }>();
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

  function selectAsset(asset: MediaAsset) {
    setSelection(asset);
    setVideoInfo(undefined);
    setPlaybackError(undefined);
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Local media desk</p>
          <h1>Field Cut</h1>
        </div>
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
                <span className="clip-index">{String(index + 1).padStart(3, "0")}</span>
                <span className="clip-name" title={asset.relativePath}>{asset.filename}</span>
                <span className="clip-arrow">›</span>
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
            {videoInfo ? (
              <>
                <span>{videoInfo.width} × {videoInfo.height}</span>
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
