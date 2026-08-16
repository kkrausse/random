import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  MediaAsset,
  MediaInfo,
  MediaPage,
  NormalizedCrop,
  PlaybackSource,
  Project,
  ProjectSettings,
  TimelineItem,
} from "../../lib/types";
import { Slider } from "./components/ui/slider";
import "./styles.css";

type SaveState = "saved" | "saving" | "error";
type ViewerSelection = { context: "source"; mediaId: string } | { context: "timeline"; itemId: string };

const ACTIVE_PROJECT_KEY = "video-editor-active-project";
const PHOTO_DURATION = 4;
const MINIMUM_CROP = 0.05;
const MINIMUM_TRIM = 0.01;
const TIMELINE_PIXELS_PER_SECOND = 6;
const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
const PRESETS: Array<{ label: string; settings: Pick<ProjectSettings, "width" | "height"> }> = [
  { label: "16:9", settings: { width: 1920, height: 1080 } },
  { label: "9:16", settings: { width: 1080, height: 1920 } },
  { label: "1:1", settings: { width: 1080, height: 1080 } },
  { label: "4:3", settings: { width: 1440, height: 1080 } },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatTimelineTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const remainder = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

function normalizeDimension(value: number) {
  if (!Number.isFinite(value)) return 2;
  return clamp(Math.round(value / 2) * 2, 2, 8192);
}

function normalizeSettings(settings: ProjectSettings): ProjectSettings {
  return {
    width: normalizeDimension(settings.width),
    height: normalizeDimension(settings.height),
    fps: FPS_OPTIONS.includes(settings.fps as typeof FPS_OPTIONS[number]) ? settings.fps : 30,
  };
}

function itemDuration(item: TimelineItem) {
  return item.kind === "video" ? item.sourceOut - item.sourceIn : item.photoDuration;
}

function projectDuration(items: TimelineItem[]) {
  return items.reduce((total, item) => total + itemDuration(item), 0);
}

function itemStartTime(items: TimelineItem[], itemId: string) {
  const index = items.findIndex((item) => item.id === itemId);
  return index < 0 ? 0 : projectDuration(items.slice(0, index));
}

function timelineTickInterval() {
  return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((seconds) => seconds * TIMELINE_PIXELS_PER_SECOND >= 64) ?? 600;
}

function thumbnailUrl(id: string) {
  return `/api/media/thumbnail?id=${encodeURIComponent(id)}`;
}

function videoUrl(id: string, source: PlaybackSource) {
  return `/api/media/video?id=${encodeURIComponent(id)}&source=${source}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function centeredCrop(info: MediaInfo | undefined, settings: ProjectSettings): NormalizedCrop | undefined {
  if (!info?.width || !info.height) return undefined;
  const sourceAspect = info.width / info.height;
  const outputAspect = settings.width / settings.height;
  if (sourceAspect > outputAspect) {
    const width = outputAspect / sourceAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = sourceAspect / outputAspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

function cropMatchesProject(crop: NormalizedCrop | undefined, info: MediaInfo | undefined, settings: ProjectSettings | undefined) {
  if (!crop || !info || !settings) return true;
  const cropAspect = crop.width * info.width / (crop.height * info.height);
  return Math.abs(cropAspect / (settings.width / settings.height) - 1) <= 0.01;
}

function Thumbnail({ asset }: { asset: MediaAsset }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="thumbnail-missing">No thumbnail</span>;
  return <img src={thumbnailUrl(asset.id)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function App() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [nextMediaCursor, setNextMediaCursor] = useState<string | null>(null);
  const [includePhotos, setIncludePhotos] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, MediaInfo>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>();
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>();
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>("proxy");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string>();
  const [libraryError, setLibraryError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ message: string; percent: number }>();
  const [exportResult, setExportResult] = useState<{ filename: string; url: string }>();
  const [exportError, setExportError] = useState<string>();
  const [previewMode, setPreviewMode] = useState<"off" | "playing" | "paused">("off");
  const [cropMode, setCropMode] = useState(false);
  const [clipPreview, setClipPreview] = useState<{ key: string; url: string }>();
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [playbackError, setPlaybackError] = useState<string>();
  const [playheadTime, setPlayheadTime] = useState(0);
  const [timelinePlayhead, setTimelinePlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaFrame = useRef<HTMLDivElement>(null);
  const librarySentinel = useRef<HTMLDivElement>(null);
  const mediaRequest = useRef<AbortController | undefined>(undefined);
  const mediaGeneration = useRef(0);
  const projectRef = useRef<Project | undefined>(undefined);
  const serverRevision = useRef(0);
  const changeVersion = useRef(0);
  const savedVersion = useRef(0);
  const savePromise = useRef<Promise<boolean> | undefined>(undefined);
  const projectLoadGeneration = useRef(0);
  const projectLoadController = useRef<AbortController | undefined>(undefined);
  const photoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const photoProgressTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const photoDeadline = useRef(0);
  const photoRemaining = useRef(0);
  const dragItemId = useRef<string | undefined>(undefined);
  const viewerSelectionRef = useRef<ViewerSelection | undefined>(undefined);
  const previewModeRef = useRef(previewMode);
  const seekInteraction = useRef<number | undefined>(undefined);
  const timelineSeekInteraction = useRef<number | undefined>(undefined);
  const pendingTimelineSeek = useRef<{ itemId: string; sourceTime: number } | undefined>(undefined);
  const cropInteraction = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    crop: NormalizedCrop;
    direction?: string;
  } | undefined>(undefined);
  const previewPreparationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const selectedItem = viewerSelection?.context === "timeline"
    ? project?.items.find((item) => item.id === viewerSelection.itemId)
    : undefined;
  const selectedMediaId = selectedItem?.mediaId ?? (viewerSelection?.context === "source" ? viewerSelection.mediaId : undefined);
  const selectedAsset = media.find((asset) => asset.id === selectedMediaId) ?? (selectedItem ? {
    id: selectedItem.mediaId,
    relativePath: selectedItem.mediaId,
    filename: selectedItem.mediaId.split(/[\\/]/).at(-1) ?? selectedItem.mediaId,
    kind: selectedItem.kind,
  } : undefined);
  const selectedInfo = selectedAsset ? metadata[selectedAsset.id] : undefined;
  const activePlaybackSource: PlaybackSource = playbackSource === "proxy" && selectedInfo?.proxy ? "proxy" : "original";
  const previewKey = selectedItem?.kind === "video"
    ? `${selectedItem.id}:${activePlaybackSource}:${selectedItem.stabilize}:${cropMode ? "uncropped" : JSON.stringify(selectedItem.crop)}`
    : undefined;
  const readyClipPreview = clipPreview?.key === previewKey ? clipPreview : undefined;
  viewerSelectionRef.current = viewerSelection;
  previewModeRef.current = previewMode;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/projects", { signal: controller.signal }).then((response) => responseJson<{ projects: Project[] }>(response)).then(async (projectBody) => {
      if (controller.signal.aborted) return;
      setProjects(projectBody.projects);
      const storedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
      const initial = projectBody.projects.find((candidate) => candidate.id === storedId) ?? projectBody.projects[0];
      if (initial) await loadProject(initial.id, controller.signal);
    }).catch((error) => {
      if (error.name !== "AbortError") setLibraryError(error instanceof Error ? error.message : "Could not load projects");
    });
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    for (const timer of previewPreparationTimers.current.values()) clearTimeout(timer);
  }, []);

  useEffect(() => {
    const generation = ++mediaGeneration.current;
    mediaRequest.current?.abort();
    const controller = new AbortController();
    mediaRequest.current = controller;
    setMedia([]);
    setMediaTotal(0);
    setNextMediaCursor(null);
    setLibraryError(undefined);
    setLoadingMedia(true);
    fetch(`/api/media?limit=48&includePhotos=${includePhotos}`, { signal: controller.signal })
      .then((response) => responseJson<MediaPage>(response))
      .then((page) => {
        if (generation !== mediaGeneration.current) return;
        setMedia(page.media);
        setMediaTotal(page.total);
        setNextMediaCursor(page.nextCursor);
        void loadMediaInfo(page.media, controller.signal);
      }).catch((error) => {
        if (error.name !== "AbortError") setLibraryError(error instanceof Error ? error.message : "Could not load media");
      }).finally(() => {
        if (generation === mediaGeneration.current) setLoadingMedia(false);
      });
    return () => controller.abort();
  }, [includePhotos]);

  useEffect(() => {
    const sentinel = librarySentinel.current;
    if (!sentinel || loadingMedia || !nextMediaCursor || libraryError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadNextMediaPage();
    }, { root: sentinel.closest(".clip-list"), rootMargin: "300px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [libraryError, loadingMedia, nextMediaCursor]);

  useEffect(() => {
    if (!selectedAsset || metadata[selectedAsset.id]) return;
    const controller = new AbortController();
    void loadMediaInfo([selectedAsset], controller.signal);
    return () => controller.abort();
  }, [selectedAsset?.id, metadata[selectedAsset?.id ?? ""]]);

  useEffect(() => {
    setPlaybackError(undefined);
    const pending = selectedItem && pendingTimelineSeek.current?.itemId === selectedItem.id ? pendingTimelineSeek.current : undefined;
    setPlayheadTime(pending?.sourceTime ?? (selectedItem?.kind === "video" ? selectedItem.sourceIn : 0));
    if (selectedItem && !pending) setTimelinePlayhead(itemStartTime(projectRef.current?.items ?? [], selectedItem.id));
    if (selectedItem?.kind === "photo" && pending) pendingTimelineSeek.current = undefined;
  }, [viewerSelection?.context, viewerSelection?.context === "timeline" ? viewerSelection.itemId : viewerSelection?.mediaId]);

  useEffect(() => {
    if (selectedItem?.kind !== "video" || !previewKey) {
      setClipPreview(undefined);
      setPreparingPreview(false);
      return;
    }
    const controller = new AbortController();
    setClipPreview(undefined);
    setPreparingPreview(true);
    setPlaybackError(undefined);
    fetch("/api/media/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedItem.mediaId, source: activePlaybackSource, stabilize: selectedItem.stabilize,
        crop: cropMode ? undefined : selectedItem.crop }),
      signal: controller.signal,
    }).then((response) => responseJson<{ url: string }>(response)).then((result) => {
      setClipPreview({ ...result, key: previewKey });
    }).catch((error) => {
      if (error.name !== "AbortError") setPlaybackError(error instanceof Error ? error.message : "Preview failed");
    }).finally(() => {
      if (!controller.signal.aborted) setPreparingPreview(false);
    });
    return () => controller.abort();
  }, [previewKey]);

  useEffect(() => {
    clearTimeout(photoTimer.current);
    clearInterval(photoProgressTimer.current);
    if (previewMode !== "playing" || selectedItem?.kind !== "photo") return;
    const milliseconds = photoRemaining.current || selectedItem.photoDuration * 1000;
    const elapsedBeforeStart = selectedItem.photoDuration * 1000 - milliseconds;
    const timelineStart = itemStartTime(projectRef.current?.items ?? [], selectedItem.id);
    const startedAt = Date.now();
    photoRemaining.current = 0;
    photoDeadline.current = Date.now() + milliseconds;
    setTimelinePlayhead(timelineStart + elapsedBeforeStart / 1000);
    photoProgressTimer.current = setInterval(() => {
      setTimelinePlayhead(timelineStart + Math.min(selectedItem.photoDuration, (elapsedBeforeStart + Date.now() - startedAt) / 1000));
    }, 50);
    photoTimer.current = setTimeout(advancePreview, milliseconds);
    return () => {
      clearTimeout(photoTimer.current);
      clearInterval(photoProgressTimer.current);
    };
  }, [previewMode, selectedItem?.id, selectedItem?.kind === "photo" ? selectedItem.photoDuration : undefined,
    project?.items.map((item) => item.id).join(":")]);

  useEffect(() => {
    const video = videoRef.current;
    if (previewMode !== "playing" || selectedItem?.kind !== "video" || !video) return;
    if (!readyClipPreview) return;
    if (video.currentTime < selectedItem.sourceIn || video.currentTime >= selectedItem.sourceOut) {
      video.currentTime = selectedItem.sourceIn;
    }
    void video.play().catch(() => {
      // A newly-mounted video will retry from onLoadedMetadata.
    });
  }, [previewMode, selectedItem?.id, readyClipPreview?.url]);

  async function loadMediaInfo(assets: MediaAsset[], signal?: AbortSignal) {
    const entries = await Promise.all(assets.map(async (asset) => {
      try {
        const response = await fetch(`/api/media/info?id=${encodeURIComponent(asset.id)}`, { signal });
        return [asset.id, await responseJson<MediaInfo>(response)] as const;
      } catch (error) {
        if ((error as Error).name === "AbortError") return undefined;
        return undefined;
      }
    }));
    if (signal?.aborted) return;
    setMetadata((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry) => entry !== undefined)) }));
  }

  async function loadNextMediaPage() {
    if (loadingMedia || !nextMediaCursor) return;
    const generation = mediaGeneration.current;
    const controller = new AbortController();
    mediaRequest.current = controller;
    setLoadingMedia(true);
    setLibraryError(undefined);
    try {
      const query = new URLSearchParams({ limit: "48", cursor: nextMediaCursor, includePhotos: String(includePhotos) });
      const page = await fetch(`/api/media?${query}`, { signal: controller.signal }).then((response) => responseJson<MediaPage>(response));
      if (generation !== mediaGeneration.current) return;
      setMedia((current) => {
        const ids = new Set(current.map((asset) => asset.id));
        return [...current, ...page.media.filter((asset) => !ids.has(asset.id))];
      });
      setMediaTotal(page.total);
      setNextMediaCursor(page.nextCursor);
      void loadMediaInfo(page.media, controller.signal);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setLibraryError(error instanceof Error ? error.message : "Could not load more media");
    } finally {
      if (generation === mediaGeneration.current) setLoadingMedia(false);
    }
  }

  async function loadProject(id: string, signal?: AbortSignal) {
    const generation = ++projectLoadGeneration.current;
    projectLoadController.current?.abort();
    const controller = new AbortController();
    projectLoadController.current = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let loaded: Project;
    try {
      loaded = await fetch(`/api/projects/${encodeURIComponent(id)}`, { signal: controller.signal }).then((response) => responseJson<Project>(response));
    } finally {
      signal?.removeEventListener("abort", abort);
      if (projectLoadController.current === controller) projectLoadController.current = undefined;
    }
    if (controller.signal.aborted || generation !== projectLoadGeneration.current) return false;
    projectRef.current = loaded;
    serverRevision.current = loaded.revision;
    changeVersion.current = 0;
    savedVersion.current = 0;
    setProject(loaded);
    setSaveState("saved");
    setSaveError(undefined);
    setViewerSelection(loaded.items[0] ? { context: "timeline", itemId: loaded.items[0].id } : undefined);
    setPreviewMode("off");
    setCropMode(false);
    localStorage.setItem(ACTIVE_PROJECT_KEY, loaded.id);
    return true;
  }

  async function runSave(): Promise<boolean> {
    if (savePromise.current) {
      if (!(await savePromise.current)) return false;
      return savedVersion.current >= changeVersion.current ? true : runSave();
    }
    const task = (async () => {
      while (projectRef.current && savedVersion.current < changeVersion.current) {
        const activeId = projectRef.current.id;
        const version = changeVersion.current;
        const snapshot = { ...projectRef.current, revision: serverRevision.current };
        setSaveState("saving");
        setSaveError(undefined);
        try {
          const saved = await fetch(`/api/projects/${encodeURIComponent(activeId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snapshot),
          }).then((response) => responseJson<Project>(response));
          if (projectRef.current?.id !== activeId) return false;
          serverRevision.current = saved.revision;
          savedVersion.current = version;
          const merged = { ...projectRef.current, revision: saved.revision, updatedAt: saved.updatedAt };
          projectRef.current = merged;
          setProject(merged);
          setProjects((current) => current.map((candidate) => candidate.id === activeId ? merged : candidate));
        } catch (error) {
          setSaveState("error");
          setSaveError(error instanceof Error ? error.message : "Save failed");
          return false;
        }
      }
      setSaveState("saved");
      return true;
    })();
    savePromise.current = task;
    try {
      return await task;
    } finally {
      savePromise.current = undefined;
    }
  }

  function scheduleSave() {
    setSaveState("saving");
    void runSave();
  }

  async function flushSave() {
    return runSave();
  }

  function editProject(update: (current: Project) => Project) {
    const current = projectRef.current;
    if (!current) return;
    const next = update(current);
    projectRef.current = next;
    changeVersion.current += 1;
    setProject(next);
    setExportResult(undefined);
    setExportError(undefined);
    scheduleSave();
  }

  async function switchProject(id: string) {
    if (id === project?.id || !(await flushSave())) return;
    try {
      await loadProject(id);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Could not open project");
    }
  }

  async function createNewProject() {
    if (!(await flushSave())) return;
    const name = window.prompt("Project name", "Untitled Project")?.trim();
    if (!name) return;
    try {
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((response) => responseJson<Project>(response));
      setProjects((current) => [created, ...current]);
      await loadProject(created.id);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Could not create project");
    }
  }

  async function deleteActiveProject() {
    if (!project || !window.confirm(`Delete “${project.name}”?`)) return;
    if (!(await flushSave())) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}?revision=${serverRevision.current}`, { method: "DELETE" });
      if (!response.ok) await responseJson(response);
      const remaining = projects.filter((candidate) => candidate.id !== project.id);
      setProjects(remaining);
      projectRef.current = undefined;
      setProject(undefined);
      setViewerSelection(undefined);
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      if (remaining[0]) await loadProject(remaining[0].id);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Could not delete project");
    }
  }

  function selectSource(asset: MediaAsset) {
    setPreviewMode("off");
    setCropMode(false);
    setViewerSelection({ context: "source", mediaId: asset.id });
    setPlaybackError(undefined);
  }

  function addToTimeline(asset: MediaAsset) {
    const info = metadata[asset.id];
    if (!project || !info) {
      setLibraryError("Media metadata is unavailable; scan the library before adding this item.");
      return;
    }
    const common = { id: crypto.randomUUID(), mediaId: asset.id, stabilize: false, crop: centeredCrop(info, project.settings) };
    const item: TimelineItem = asset.kind === "video"
      ? { ...common, kind: "video", sourceIn: 0, sourceOut: info.duration }
      : { ...common, kind: "photo", photoDuration: PHOTO_DURATION };
    editProject((current) => ({ ...current, items: [...current.items, item] }));
    setViewerSelection({ context: "timeline", itemId: item.id });
  }

  function updateItem(id: string, update: (item: TimelineItem) => TimelineItem) {
    let updatedItem: TimelineItem | undefined;
    editProject((current) => ({ ...current, items: current.items.map((item) => {
      if (item.id !== id) return item;
      updatedItem = update(item);
      return updatedItem;
    }) }));
    if (updatedItem?.kind === "video") prepareClipPreview(updatedItem);
  }

  function prepareClipPreview(item: Extract<TimelineItem, { kind: "video" }>) {
    clearTimeout(previewPreparationTimers.current.get(item.id));
    const source: PlaybackSource = playbackSource === "proxy" && metadata[item.mediaId]?.proxy ? "proxy" : "original";
    previewPreparationTimers.current.set(item.id, setTimeout(() => {
      previewPreparationTimers.current.delete(item.id);
      void fetch("/api/media/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.mediaId, source, stabilize: item.stabilize, crop: item.crop }),
      }).catch(() => {
        // The visible preview request reports failures when this clip is opened.
      });
    }, 300));
  }

  function removeItem(id: string) {
    const index = project?.items.findIndex((item) => item.id === id) ?? -1;
    editProject((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    if (viewerSelection?.context === "timeline" && viewerSelection.itemId === id) {
      const next = project?.items[index + 1] ?? project?.items[index - 1];
      setViewerSelection(next ? { context: "timeline", itemId: next.id } : undefined);
    }
    setPreviewMode("off");
  }

  function moveItem(id: string, offset: number) {
    editProject((current) => {
      const from = current.items.findIndex((item) => item.id === id);
      const to = clamp(from + offset, 0, current.items.length - 1);
      if (from < 0 || from === to) return current;
      const items = [...current.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved!);
      return { ...current, items };
    });
  }

  function dropItem(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const sourceId = dragItemId.current;
    if (!sourceId || sourceId === targetId) return;
    editProject((current) => {
      const items = [...current.items];
      const from = items.findIndex((item) => item.id === sourceId);
      const to = items.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved!);
      return { ...current, items };
    });
  }

  function changeSettings(settings: ProjectSettings) {
    const normalized = normalizeSettings(settings);
    editProject((current) => ({
      ...current,
      settings: normalized,
      items: current.items.map((item) => ({ ...item, crop: centeredCrop(metadata[item.mediaId], normalized) ?? item.crop })),
    }));
  }

  function navigateLibrary(event: KeyboardEvent<HTMLDivElement>) {
    if (!event.key.startsWith("Arrow") && event.key !== "Home" && event.key !== "End") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".clip-row"));
    const current = (event.target as Element).closest<HTMLButtonElement>(".clip-row");
    const currentIndex = current ? buttons.indexOf(current) : -1;
    if (currentIndex < 0 || !buttons[0]) return;
    const firstNextRow = buttons.findIndex((button) => button.offsetTop !== buttons[0]!.offsetTop);
    const columns = firstNextRow === -1 ? buttons.length : firstNextRow;
    const next = { ArrowLeft: currentIndex - 1, ArrowRight: currentIndex + 1, ArrowUp: currentIndex - columns,
      ArrowDown: currentIndex + columns, Home: 0, End: buttons.length - 1 }[event.key];
    if (next === undefined || next < 0 || next >= buttons.length) return;
    event.preventDefault();
    buttons[next]!.focus();
    buttons[next]!.click();
  }

  function startPreview() {
    if (!project?.items[0]) return;
    const first = project.items[0];
    photoRemaining.current = 0;
    setCropMode(false);
    if (first.kind === "video") {
      pendingTimelineSeek.current = { itemId: first.id, sourceTime: first.sourceIn };
      if (viewerSelectionRef.current?.context === "timeline" && viewerSelectionRef.current.itemId === first.id && videoRef.current) {
        videoRef.current.currentTime = first.sourceIn;
        pendingTimelineSeek.current = undefined;
      }
    }
    setViewerSelection({ context: "timeline", itemId: first.id });
    setTimelinePlayhead(0);
    setPreviewMode("playing");
  }

  function togglePreviewPause() {
    if (previewMode === "playing") {
      if (selectedItem?.kind === "photo") photoRemaining.current = Math.max(0, photoDeadline.current - Date.now());
      videoRef.current?.pause();
      setPreviewMode("paused");
    } else if (previewMode === "paused") {
      setPreviewMode("playing");
      if (selectedItem?.kind === "video" && readyClipPreview) void videoRef.current?.play();
    }
  }

  function stopPreview() {
    clearTimeout(photoTimer.current);
    clearInterval(photoProgressTimer.current);
    photoRemaining.current = 0;
    videoRef.current?.pause();
    setPreviewMode("off");
  }

  function advancePreview() {
    const current = projectRef.current;
    const selection = viewerSelectionRef.current;
    if (!current || selection?.context !== "timeline") return stopPreview();
    const index = current.items.findIndex((item) => item.id === selection.itemId);
    const next = current.items[index + 1];
    photoRemaining.current = 0;
    if (!next) {
      setTimelinePlayhead(projectDuration(current.items));
      return stopPreview();
    }
    setTimelinePlayhead(itemStartTime(current.items, next.id));
    setViewerSelection({ context: "timeline", itemId: next.id });
  }

  function videoReady(video: HTMLVideoElement) {
    if (selectedItem?.kind === "video") {
      const pending = pendingTimelineSeek.current?.itemId === selectedItem.id ? pendingTimelineSeek.current : undefined;
      const sourceTime = pending?.sourceTime ?? selectedItem.sourceIn;
      video.currentTime = sourceTime;
      setPlayheadTime(sourceTime);
      pendingTimelineSeek.current = undefined;
      if (previewMode === "playing" && readyClipPreview) void video.play();
    }
  }

  function seekTimeline(time: number) {
    const current = projectRef.current;
    if (!current?.items.length) return;
    const total = projectDuration(current.items);
    const target = clamp(time, 0, total);
    let elapsed = 0;
    let item = current.items.at(-1)!;
    for (const candidate of current.items) {
      const end = elapsed + itemDuration(candidate);
      item = candidate;
      if (target < end || candidate === current.items.at(-1)) break;
      elapsed = end;
    }
    const localTime = clamp(target - elapsed, 0, itemDuration(item));
    setTimelinePlayhead(target);
    setViewerSelection({ context: "timeline", itemId: item.id });
    if (item.kind === "video") {
      const sourceTime = item.sourceIn + localTime;
      pendingTimelineSeek.current = { itemId: item.id, sourceTime };
      setPlayheadTime(sourceTime);
      if (viewerSelectionRef.current?.context === "timeline" && viewerSelectionRef.current.itemId === item.id && videoRef.current) {
        videoRef.current.currentTime = sourceTime;
        pendingTimelineSeek.current = undefined;
      }
    } else {
      pendingTimelineSeek.current = viewerSelectionRef.current?.context === "timeline" && viewerSelectionRef.current.itemId === item.id
        ? undefined
        : { itemId: item.id, sourceTime: 0 };
      photoRemaining.current = Math.max(0, item.photoDuration - localTime) * 1000;
    }
  }

  function moveTimelinePlayhead(event: PointerEvent<HTMLDivElement>) {
    if (timelineSeekInteraction.current !== event.pointerId || !project) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seekTimeline((event.clientX - bounds.left) / TIMELINE_PIXELS_PER_SECOND);
  }

  function beginTimelineSeek(event: PointerEvent<HTMLDivElement>) {
    if (!project?.items.length) return;
    event.preventDefault();
    stopPreview();
    timelineSeekInteraction.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTimelinePlayhead(event);
  }

  function endTimelineSeek(event: PointerEvent<HTMLDivElement>) {
    if (timelineSeekInteraction.current !== event.pointerId) return;
    timelineSeekInteraction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function updateTrim(values: number[]) {
    if (!selectedItem || selectedItem.kind !== "video" || !selectedInfo) return;
    const sourceIn = clamp(values[0] ?? selectedItem.sourceIn, 0, selectedInfo.duration - MINIMUM_TRIM);
    const sourceOut = clamp(values[1] ?? selectedItem.sourceOut, sourceIn + MINIMUM_TRIM, selectedInfo.duration);
    updateItem(selectedItem.id, (item) => item.kind === "video"
      ? { ...item, sourceIn, sourceOut }
      : item);
    if (videoRef.current) {
      const time = sourceIn !== selectedItem.sourceIn ? sourceIn : sourceOut;
      videoRef.current.currentTime = time;
      setPlayheadTime(time);
    }
  }

  function moveTrimPlayhead(event: PointerEvent<HTMLDivElement>) {
    if (seekInteraction.current !== event.pointerId || !selectedInfo?.duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const time = clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * selectedInfo.duration;
    if (videoRef.current) videoRef.current.currentTime = time;
    setPlayheadTime(time);
  }

  function beginTrimSeek(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".ui-slider-thumb")) return;
    event.preventDefault();
    event.stopPropagation();
    seekInteraction.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTrimPlayhead(event);
  }

  function endTrimSeek(event: PointerEvent<HTMLDivElement>) {
    if (seekInteraction.current !== event.pointerId) return;
    seekInteraction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function beginCrop(event: PointerEvent<HTMLDivElement>, direction?: string) {
    if (!selectedItem?.crop) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropInteraction.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      crop: selectedItem.crop, direction };
  }

  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    const interaction = cropInteraction.current;
    const bounds = mediaFrame.current?.getBoundingClientRect();
    if (!interaction || interaction.pointerId !== event.pointerId || !bounds || !selectedItem || !selectedInfo || !project) return;
    const dx = (event.clientX - interaction.startX) / bounds.width;
    const dy = (event.clientY - interaction.startY) / bounds.height;
    const start = interaction.crop;
    if (!interaction.direction) {
      updateItem(selectedItem.id, (item) => ({ ...item, crop: { ...start,
        x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) } }));
      return;
    }
    const ratio = (selectedInfo.width / selectedInfo.height) / (project.settings.width / project.settings.height);
    const direction = interaction.direction;
    const anchorX = direction.includes("w") ? start.x + start.width : start.x;
    const anchorY = direction.includes("n") ? start.y + start.height : start.y;
    const widthFromX = direction.includes("w") ? start.width - dx : start.width + dx;
    const heightFromY = direction.includes("n") ? start.height - dy : start.height + dy;
    let width = Math.abs(dx) > Math.abs(dy) ? widthFromX : heightFromY / ratio;
    const maxWidthX = direction.includes("w") ? anchorX : 1 - anchorX;
    const maxHeight = direction.includes("n") ? anchorY : 1 - anchorY;
    const minimumWidth = Math.max(MINIMUM_CROP, MINIMUM_CROP / ratio);
    width = clamp(width, minimumWidth, Math.min(maxWidthX, maxHeight / ratio));
    const height = width * ratio;
    updateItem(selectedItem.id, (item) => ({ ...item, crop: {
      x: direction.includes("w") ? anchorX - width : anchorX,
      y: direction.includes("n") ? anchorY - height : anchorY,
      width,
      height,
    } }));
  }

  function endCrop(event: PointerEvent<HTMLDivElement>) {
    if (cropInteraction.current?.pointerId !== event.pointerId) return;
    cropInteraction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function exportProject() {
    if (!project || !(await flushSave())) return;
    setExporting(true);
    setExportError(undefined);
    setExportResult(undefined);
    setExportProgress({ message: "Starting export", percent: 0 });
    try {
      const { jobId } = await fetch(`/api/projects/${encodeURIComponent(project.id)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: serverRevision.current }),
      }).then((response) => responseJson<{ jobId: string }>(response));
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = await fetch(`/api/projects/${encodeURIComponent(project.id)}/export?jobId=${encodeURIComponent(jobId)}`)
          .then((response) => responseJson<{ state: "running" | "complete" | "error"; message: string; percent: number;
            result?: { filename: string; url: string }; error?: string }>(response));
        setExportProgress({ message: status.message, percent: status.percent });
        if (status.state === "complete" && status.result) {
          setExportResult(status.result);
          break;
        }
        if (status.state === "error") throw new Error(status.error ?? "Export failed");
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
      setExportProgress(undefined);
    }
  }

  const viewerMediaUrl = selectedAsset?.kind === "video"
    ? selectedItem?.kind === "video"
      ? readyClipPreview?.url
      : videoUrl(selectedAsset.id, activePlaybackSource)
    : selectedAsset ? thumbnailUrl(selectedAsset.id) : undefined;
  const displayedCrop = selectedItem?.crop && !cropMode ? selectedItem.crop : undefined;
  const viewerAspect = selectedInfo && displayedCrop
    ? displayedCrop.width * selectedInfo.width / (displayedCrop.height * selectedInfo.height)
    : selectedInfo ? selectedInfo.width / selectedInfo.height : undefined;
  const croppedMediaStyle = displayedCrop && selectedAsset?.kind === "photo" ? {
    width: `${100 / displayedCrop.width}%`,
    height: `${100 / displayedCrop.height}%`,
    left: `${-displayedCrop.x / displayedCrop.width * 100}%`,
    top: `${-displayedCrop.y / displayedCrop.height * 100}%`,
  } : undefined;
  const totalTimelineDuration = projectDuration(project?.items ?? []);
  const tickInterval = timelineTickInterval();
  const timelineTicks = Array.from({ length: Math.floor(totalTimelineDuration / tickInterval) + 1 }, (_, index) => index * tickInterval);
  if (totalTimelineDuration > 0 && timelineTicks.at(-1) !== totalTimelineDuration) timelineTicks.push(totalTimelineDuration);

  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="project-controls">
          <h1>Video Editor</h1>
          <select aria-label="Open project" value={project?.id ?? ""} onChange={(event) => void switchProject(event.target.value)}>
            {!project && <option value="">No project</option>}
            {projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
          <button onClick={() => void createNewProject()}>New</button>
          <button onClick={() => void deleteActiveProject()} disabled={!project}>Delete</button>
        </div>
        <div className={`save-status ${saveState === "error" ? "error-text" : ""}`} title={saveError}>
          {saveState === "saving" ? "Saving..." : saveState === "error" ? `Error: ${saveError}` : "Saved"}
        </div>
      </header>

      <section className="workspace">
        <aside className="library-panel">
          <div className="panel-heading"><h2>Library</h2>
            <label className="library-filter"><input type="checkbox" checked={includePhotos} onChange={(event) => setIncludePhotos(event.target.checked)} /> Include photos</label>
            <span>{media.length} / {mediaTotal}</span></div>
          {libraryError && <p className="error-message">{libraryError}</p>}
          {!libraryError && loadingMedia && media.length === 0 && <p className="empty-message">Loading library...</p>}
          <div className="clip-list" role="group" aria-label="Source media" onKeyDown={navigateLibrary}>
            {media.map((asset, index) => {
              const selected = viewerSelection?.context === "source" && viewerSelection.mediaId === asset.id;
              return (
                <div className="library-item" key={asset.id}>
                  <button className={selected ? "clip-row selected" : "clip-row"} aria-pressed={selected}
                    tabIndex={selected || (!viewerSelection && index === 0) ? 0 : -1}
                    onClick={() => selectSource(asset)} onDoubleClick={() => addToTimeline(asset)}>
                    <span className="clip-thumbnail"><Thumbnail asset={asset} /></span>
                    <span className="clip-caption"><span className="clip-name" title={asset.relativePath}>{asset.filename}</span>
                      <span className="clip-index">{asset.kind} {metadata[asset.id] ? formatDuration(metadata[asset.id]!.duration) : ""}</span></span>
                  </button>
                  <button className="add-button" disabled={!project || !metadata[asset.id]} onClick={() => addToTimeline(asset)}>Add to Timeline</button>
                </div>
              );
            })}
            <div ref={librarySentinel} className="library-sentinel">{loadingMedia && media.length > 0 ? "Loading more..." : ""}</div>
          </div>
        </aside>

        <section className="editor-panel">
          <div className="viewer-heading">
            <div><p className="eyebrow">{viewerSelection?.context === "timeline" ? "Timeline item" : "Source"}</p>
              <h2>{selectedAsset?.filename ?? "Select media"}</h2></div>
            <div className="viewer-actions">
              {selectedAsset?.kind === "video" && <div className="source-toggle" aria-label="Playback source">
                <button className={activePlaybackSource === "proxy" ? "active" : ""} onClick={() => setPlaybackSource("proxy")} disabled={!selectedInfo?.proxy}>Proxy</button>
                <button className={activePlaybackSource === "original" ? "active" : ""} onClick={() => setPlaybackSource("original")}>Original</button>
              </div>}
              {selectedItem?.kind === "video" && <button className={selectedItem.stabilize ? "edit-toggle active" : "edit-toggle"}
                aria-pressed={selectedItem.stabilize} onClick={() => updateItem(selectedItem.id, (item) => ({ ...item, stabilize: !item.stabilize }))}>Stabilize</button>}
              {selectedAsset && viewerSelection?.context === "source" && <button onClick={() => addToTimeline(selectedAsset)}>Add to Timeline</button>}
              {preparingPreview && <span className="processing-badge">Preparing preview...</span>}
            </div>
          </div>

          <div className="viewer-stack">
            <div className="viewer-stage">
            {!selectedAsset && <div className="viewer-placeholder">Choose a source or timeline item</div>}
            {selectedAsset && selectedInfo && <div ref={mediaFrame} className={croppedMediaStyle ? "media-frame cropped" : "media-frame"}
              style={{ aspectRatio: viewerAspect }}>
              {selectedAsset.kind === "video" ? viewerMediaUrl ? <video ref={videoRef} key={`${selectedItem?.id ?? "source"}:${activePlaybackSource}:${readyClipPreview?.url ?? "direct"}`}
                src={viewerMediaUrl} controls autoPlay={viewerSelection?.context === "source"} playsInline preload="metadata" onLoadedMetadata={(event) => videoReady(event.currentTarget)}
                onPlay={() => { if (viewerSelection?.context === "timeline") setPreviewMode("playing"); }}
                onTimeUpdate={(event) => { setPlayheadTime(event.currentTarget.currentTime); if (selectedItem?.kind === "video") {
                  setTimelinePlayhead(itemStartTime(projectRef.current?.items ?? [], selectedItem.id) + clamp(event.currentTarget.currentTime - selectedItem.sourceIn, 0, itemDuration(selectedItem)));
                } if (selectedItem?.kind === "video" && event.currentTarget.currentTime >= selectedItem.sourceOut) {
                  if (previewModeRef.current === "playing") advancePreview(); else event.currentTarget.pause();
                } }} onEnded={() => { if (previewModeRef.current === "playing") advancePreview(); }}
                onError={() => setPlaybackError("This browser cannot play the selected video.")} />
                : <div className="viewer-placeholder">Preparing preview...</div>
                : <img src={viewerMediaUrl} alt={selectedAsset.filename} style={croppedMediaStyle} />}
              {viewerMediaUrl && cropMode && selectedItem?.crop && <div className="crop-rectangle" aria-label="Crop area. Drag to reposition; use corner handles to resize."
                onPointerDown={(event) => beginCrop(event, (event.target as HTMLElement).dataset.direction)} onPointerMove={moveCrop}
                onPointerUp={endCrop} onPointerCancel={endCrop} style={{ left: `${selectedItem.crop.x * 100}%`, top: `${selectedItem.crop.y * 100}%`,
                  width: `${selectedItem.crop.width * 100}%`, height: `${selectedItem.crop.height * 100}%` }}>
                {(["nw", "ne", "se", "sw"] as const).map((direction) => <span key={direction} className={`crop-handle crop-handle-${direction}`} data-direction={direction} />)}
              </div>}
            </div>}
            {playbackError && <div className="error-message playback-error">{playbackError}</div>}
            </div>

            {selectedItem?.kind === "video" && selectedInfo && selectedInfo.duration > 0 && <section className="trim-editor" aria-label="Trim clip">
              <div className="trim-control" onPointerDownCapture={beginTrimSeek} onPointerMove={moveTrimPlayhead}
                onPointerUp={endTrimSeek} onPointerCancel={endTrimSeek}>
                <Slider className="trim-slider" min={0} max={selectedInfo.duration} step={MINIMUM_TRIM} minStepsBetweenThumbs={1}
                  value={[selectedItem.sourceIn, selectedItem.sourceOut]} onValueChange={updateTrim} />
                <span className="trim-playhead" style={{ left: `${clamp(playheadTime / selectedInfo.duration, 0, 1) * 100}%` }} />
              </div>
            </section>}
          </div>

          <div className="edit-strip">
            {selectedItem && selectedInfo ? <>
              <span>Crop {Math.round((selectedItem.crop?.width ?? 1) * selectedInfo.width)} × {Math.round((selectedItem.crop?.height ?? 1) * selectedInfo.height)} px</span>
              {!cropMatchesProject(selectedItem.crop, selectedInfo, project?.settings)
                && <span className="invalid-crop-message">Crop does not match the project aspect ratio</span>}
              <button className={cropMode ? "active" : ""} aria-pressed={cropMode} onClick={() => {
                if (!cropMode) stopPreview();
                setCropMode(!cropMode);
              }}>{cropMode ? "Done cropping" : "Crop"}</button>
              {cropMode && <button onClick={() => updateItem(selectedItem.id, (item) => ({ ...item, crop: centeredCrop(selectedInfo, project!.settings) }))}>Reset crop</button>}
              {selectedItem.kind === "photo" && <label>Photo duration <input type="number" min="0.1" step="0.1" value={selectedItem.photoDuration}
                onChange={(event) => updateItem(selectedItem.id, (item) => item.kind === "photo" ? { ...item, photoDuration: Math.max(0.1, Number(event.target.value)) } : item)} /> sec</label>}
            </> : <span>{viewerSelection?.context === "source" ? "Source preview. Add it to edit crop, trim, or duration." : "Select a timeline item to edit."}</span>}
          </div>

          {project && <section className="project-settings" aria-label="Project settings">
            <strong>Output</strong>
            <input aria-label="Project name" value={project.name} onChange={(event) => editProject((current) => ({ ...current, name: event.target.value || "Untitled Project" }))} />
            <div className="preset-buttons">{PRESETS.map((preset) => <button key={preset.label}
              className={project.settings.width === preset.settings.width && project.settings.height === preset.settings.height ? "active" : ""}
              onClick={() => changeSettings({ ...project.settings, ...preset.settings })}>{preset.label}</button>)}</div>
            <label>W <input type="number" min="2" max="8192" step="2" value={project.settings.width} onChange={(event) => changeSettings({ ...project.settings, width: normalizeDimension(Number(event.target.value)) })} /></label>
            <label>H <input type="number" min="2" max="8192" step="2" value={project.settings.height} onChange={(event) => changeSettings({ ...project.settings, height: normalizeDimension(Number(event.target.value)) })} /></label>
            <label>FPS <select value={FPS_OPTIONS.includes(project.settings.fps as typeof FPS_OPTIONS[number]) ? project.settings.fps : 30}
              onChange={(event) => changeSettings({ ...project.settings, fps: Number(event.target.value) })}>
              {FPS_OPTIONS.map((fps) => <option key={fps}>{fps}</option>)}</select></label>
          </section>}

          <section className="timeline-section">
            <div className="timeline-heading"><div><h2>Timeline</h2><span>{project?.items.length ?? 0} items</span></div>
              <div className="timeline-actions">
                <button onClick={startPreview} disabled={!project?.items.length}>Play all</button>
                <button onClick={togglePreviewPause} disabled={previewMode === "off"}>{previewMode === "paused" ? "Resume" : "Pause"}</button>
                <button onClick={stopPreview} disabled={previewMode === "off"}>Stop</button>
                <button className="export-button" onClick={() => void exportProject()} disabled={!project?.items.length || exporting}>{exporting ? `Exporting ${exportProgress?.percent ?? 0}%` : "Export Project"}</button>
              </div></div>
            {exporting && exportProgress && <div className="export-progress" role="status">
              <progress max="100" value={exportProgress.percent} />
              <span>{exportProgress.message}</span>
            </div>}
            {exportError && <div className="error-message export-error-message" role="alert">Export failed: {exportError}</div>}
            <div className="timeline-scroll" aria-label="Project timeline">
              {project?.items.length ? <div className="timeline-content" style={{ width: `${totalTimelineDuration * TIMELINE_PIXELS_PER_SECOND}px` }}>
                <div className="timeline">
                  {project.items.map((item, index) => {
                    const asset = media.find((candidate) => candidate.id === item.mediaId);
                    const selected = viewerSelection?.context === "timeline" && viewerSelection.itemId === item.id;
                    const invalidCrop = !cropMatchesProject(item.crop, metadata[item.mediaId], project.settings);
                    const label = asset?.filename ?? item.mediaId;
                    return <article key={item.id} className={`timeline-card${selected ? " selected" : ""}${invalidCrop ? " invalid-crop" : ""}`}
                      aria-invalid={invalidCrop || undefined} title={`${label}${invalidCrop ? " - Crop does not match the project aspect ratio" : ""}`} draggable
                      style={{ width: `${itemDuration(item) * TIMELINE_PIXELS_PER_SECOND}px` }} onDragStart={() => { dragItemId.current = item.id; }}
                      onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropItem(event, item.id)}>
                      <button className="timeline-select" aria-label={`Select ${label}`} aria-pressed={selected}
                        onClick={() => { stopPreview(); setViewerSelection({ context: "timeline", itemId: item.id }); }}>
                        <img src={thumbnailUrl(item.mediaId)} alt="" />
                        <span className="timeline-duration">{formatDuration(itemDuration(item))}</span>
                      </button>
                      <div className="card-actions">
                        <div><button aria-label={`Move ${label} left`} disabled={index === 0} onClick={() => moveItem(item.id, -1)}>←</button>
                          <button aria-label={`Move ${label} right`} disabled={index === project.items.length - 1} onClick={() => moveItem(item.id, 1)}>→</button></div>
                        <button className="remove-button" aria-label={`Remove ${label}`} onClick={() => removeItem(item.id)}>Remove</button>
                      </div>
                    </article>;
                  })}
                </div>
                <div className="timeline-ruler" aria-label="Project playhead" onPointerDown={beginTimelineSeek} onPointerMove={moveTimelinePlayhead}
                  onPointerUp={endTimelineSeek} onPointerCancel={endTimelineSeek}>
                  {timelineTicks.map((time, index) => <span key={time} className={`timeline-tick${index === 0 ? " first" : time === totalTimelineDuration ? " last" : ""}`}
                    style={{ left: `${time * TIMELINE_PIXELS_PER_SECOND}px` }}><small>{formatTimelineTime(time)}</small></span>)}
                  <span className="timeline-playhead" style={{ left: `${clamp(timelinePlayhead, 0, totalTimelineDuration) * TIMELINE_PIXELS_PER_SECOND}px` }} />
                </div>
              </div> : <p className="empty-message">Add media from the library.</p>}
            </div>
            <div className="export-status">
              <span>Project exports preserve source audio and use silence for photos.</span>
              {exportResult && <a href={exportResult.url}>{exportResult.filename}</a>}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
