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
  NormalizedCrop,
  PlaybackSource,
  Project,
  ProjectSettings,
  TimelineItem,
} from "../../lib/types";
import "./styles.css";

type SaveState = "saved" | "saving" | "error";
type ViewerSelection = { context: "source"; mediaId: string } | { context: "timeline"; itemId: string };

const ACTIVE_PROJECT_KEY = "video-editor-active-project";
const PHOTO_DURATION = 4;
const MINIMUM_CROP = 0.05;
const MINIMUM_TRIM = 0.01;
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

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--.--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
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

function Thumbnail({ asset }: { asset: MediaAsset }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="thumbnail-missing">No thumbnail</span>;
  return <img src={thumbnailUrl(asset.id)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function App() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [metadata, setMetadata] = useState<Record<string, MediaInfo>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>();
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>();
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>("proxy");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string>();
  const [libraryError, setLibraryError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ filename: string; url: string }>();
  const [exportError, setExportError] = useState<string>();
  const [previewMode, setPreviewMode] = useState<"off" | "playing" | "paused">("off");
  const [stabilizedPreview, setStabilizedPreview] = useState<{ workId: string; url: string; itemId: string; source: PlaybackSource }>();
  const [stabilizing, setStabilizing] = useState(false);
  const [playbackError, setPlaybackError] = useState<string>();
  const [playheadTime, setPlayheadTime] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaFrame = useRef<HTMLDivElement>(null);
  const projectRef = useRef<Project | undefined>(undefined);
  const serverRevision = useRef(0);
  const changeVersion = useRef(0);
  const savedVersion = useRef(0);
  const savePromise = useRef<Promise<boolean> | undefined>(undefined);
  const projectLoadGeneration = useRef(0);
  const projectLoadController = useRef<AbortController | undefined>(undefined);
  const photoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const photoDeadline = useRef(0);
  const photoRemaining = useRef(0);
  const dragItemId = useRef<string | undefined>(undefined);
  const viewerSelectionRef = useRef<ViewerSelection | undefined>(undefined);
  const previewModeRef = useRef(previewMode);
  const trimInteraction = useRef<{
    pointerId: number;
    itemId: string;
    duration: number;
    action: "in" | "out" | "playhead";
  } | undefined>(undefined);
  const cropInteraction = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    crop: NormalizedCrop;
    direction?: string;
  } | undefined>(undefined);

  const selectedItem = viewerSelection?.context === "timeline"
    ? project?.items.find((item) => item.id === viewerSelection.itemId)
    : undefined;
  const selectedAsset = media.find((asset) => asset.id === (selectedItem?.mediaId
    ?? (viewerSelection?.context === "source" ? viewerSelection.mediaId : undefined)));
  const selectedInfo = selectedAsset ? metadata[selectedAsset.id] : undefined;
  const activePlaybackSource: PlaybackSource = playbackSource === "proxy" && selectedInfo?.proxy ? "proxy" : "original";
  const readyStabilizedPreview = selectedItem?.kind === "video"
    && stabilizedPreview?.itemId === selectedItem.id && stabilizedPreview.source === activePlaybackSource
    ? stabilizedPreview : undefined;
  viewerSelectionRef.current = viewerSelection;
  previewModeRef.current = previewMode;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/media", { signal: controller.signal }).then((response) => responseJson<{ media: MediaAsset[] }>(response)),
      fetch("/api/projects", { signal: controller.signal }).then((response) => responseJson<{ projects: Project[] }>(response)),
    ]).then(async ([mediaBody, projectBody]) => {
      if (controller.signal.aborted) return;
      setMedia(mediaBody.media);
      setProjects(projectBody.projects);
      const storedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
      const initial = projectBody.projects.find((candidate) => candidate.id === storedId) ?? projectBody.projects[0];
      const initialLoad = initial ? loadProject(initial.id, controller.signal) : Promise.resolve(false);
      const infoEntries = await Promise.all(mediaBody.media.map(async (asset) => {
        try {
          const info = await fetch(`/api/media/info?id=${encodeURIComponent(asset.id)}`, { signal: controller.signal });
          return [asset.id, await responseJson<MediaInfo>(info)] as const;
        } catch {
          return undefined;
        }
      }));
      if (!controller.signal.aborted) setMetadata(Object.fromEntries(infoEntries.filter((entry) => entry !== undefined)));
      await initialLoad;
    }).catch((error) => {
      if (error.name !== "AbortError") setLibraryError(error instanceof Error ? error.message : "Could not load editor data");
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setPlaybackError(undefined);
    setPlayheadTime(selectedItem?.kind === "video" ? selectedItem.sourceIn : 0);
    setBufferedTime(0);
  }, [viewerSelection?.context, viewerSelection?.context === "timeline" ? viewerSelection.itemId : viewerSelection?.mediaId]);

  useEffect(() => {
    if (selectedItem?.kind !== "video" || !selectedItem.stabilize || !selectedInfo) {
      setStabilizedPreview(undefined);
      setStabilizing(false);
      return;
    }
    const controller = new AbortController();
    let workId: string | undefined;
    setStabilizedPreview(undefined);
    setStabilizing(true);
    setPlaybackError(undefined);
    fetch("/api/media/stabilize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedItem.mediaId, source: activePlaybackSource }),
      signal: controller.signal,
    }).then((response) => responseJson<{ workId: string; url: string }>(response)).then((result) => {
      workId = result.workId;
      setStabilizedPreview({ ...result, itemId: selectedItem.id, source: activePlaybackSource });
    }).catch((error) => {
      if (error.name !== "AbortError") setPlaybackError(error instanceof Error ? error.message : "Stabilization failed");
    }).finally(() => {
      if (!controller.signal.aborted) setStabilizing(false);
    });
    return () => {
      controller.abort();
      if (workId) void fetch(`/api/media/work?id=${encodeURIComponent(workId)}`, { method: "DELETE" });
    };
  }, [activePlaybackSource, selectedInfo?.source, selectedItem?.id, selectedItem?.kind === "video" && selectedItem.stabilize]);

  useEffect(() => {
    clearTimeout(photoTimer.current);
    if (previewMode !== "playing" || selectedItem?.kind !== "photo") return;
    const milliseconds = photoRemaining.current || selectedItem.photoDuration * 1000;
    photoRemaining.current = 0;
    photoDeadline.current = Date.now() + milliseconds;
    photoTimer.current = setTimeout(advancePreview, milliseconds);
    return () => clearTimeout(photoTimer.current);
  }, [previewMode, selectedItem?.id, selectedItem?.kind === "photo" ? selectedItem.photoDuration : undefined,
    project?.items.map((item) => item.id).join(":")]);

  useEffect(() => {
    const video = videoRef.current;
    if (previewMode !== "playing" || selectedItem?.kind !== "video" || !video) return;
    if (selectedItem.stabilize && !readyStabilizedPreview) return;
    if (video.currentTime < selectedItem.sourceIn || video.currentTime >= selectedItem.sourceOut) {
      video.currentTime = selectedItem.sourceIn;
    }
    void video.play().catch(() => {
      // A newly-mounted video will retry from onLoadedMetadata.
    });
  }, [previewMode, selectedItem?.id, readyStabilizedPreview?.workId]);

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
    editProject((current) => ({ ...current, items: current.items.map((item) => item.id === id ? update(item) : item) }));
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
    photoRemaining.current = 0;
    setViewerSelection({ context: "timeline", itemId: project.items[0].id });
    setPreviewMode("playing");
  }

  function togglePreviewPause() {
    if (previewMode === "playing") {
      if (selectedItem?.kind === "photo") photoRemaining.current = Math.max(0, photoDeadline.current - Date.now());
      videoRef.current?.pause();
      setPreviewMode("paused");
    } else if (previewMode === "paused") {
      setPreviewMode("playing");
      if (selectedItem?.kind === "video" && (!selectedItem.stabilize || readyStabilizedPreview)) void videoRef.current?.play();
    }
  }

  function stopPreview() {
    clearTimeout(photoTimer.current);
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
    if (!next) return stopPreview();
    setViewerSelection({ context: "timeline", itemId: next.id });
  }

  function videoReady(video: HTMLVideoElement) {
    if (selectedItem?.kind === "video") {
      video.currentTime = selectedItem.sourceIn;
      setPlayheadTime(selectedItem.sourceIn);
      if (previewMode === "playing" && (!selectedItem.stabilize || readyStabilizedPreview)) void video.play();
    }
  }

  function updateVideoProgress(video: HTMLVideoElement) {
    setPlayheadTime(video.currentTime);
    let buffered = 0;
    for (let index = 0; index < video.buffered.length; index += 1) buffered = Math.max(buffered, video.buffered.end(index));
    setBufferedTime(buffered);
  }

  function moveTrim(event: PointerEvent<HTMLDivElement>) {
    const interaction = trimInteraction.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!interaction || interaction.pointerId !== event.pointerId || bounds.width <= 0) return;
    const time = clamp(((event.clientX - bounds.left) / bounds.width) * interaction.duration, 0, interaction.duration);
    const current = projectRef.current?.items.find((item) => item.id === interaction.itemId);
    if (!current || current.kind !== "video") return;
    let seekTime = time;
    if (interaction.action === "in") {
      seekTime = clamp(time, 0, current.sourceOut - MINIMUM_TRIM);
      updateItem(current.id, (item) => item.kind === "video" ? { ...item, sourceIn: seekTime } : item);
    } else if (interaction.action === "out") {
      seekTime = clamp(time, current.sourceIn + MINIMUM_TRIM, interaction.duration);
      updateItem(current.id, (item) => item.kind === "video" ? { ...item, sourceOut: seekTime } : item);
    }
    if (videoRef.current) videoRef.current.currentTime = seekTime;
    setPlayheadTime(seekTime);
  }

  function beginTrim(event: PointerEvent<HTMLDivElement>) {
    if (!selectedItem || selectedItem.kind !== "video" || !selectedInfo?.duration) return;
    event.preventDefault();
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-trim-action]")?.dataset.trimAction;
    trimInteraction.current = {
      pointerId: event.pointerId,
      itemId: selectedItem.id,
      duration: selectedInfo.duration,
      action: action === "in" || action === "out" ? action : "playhead",
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTrim(event);
  }

  function endTrim(event: PointerEvent<HTMLDivElement>) {
    if (trimInteraction.current?.pointerId !== event.pointerId) return;
    trimInteraction.current = undefined;
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
    try {
      const result = await fetch(`/api/projects/${encodeURIComponent(project.id)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: serverRevision.current }),
      }).then((response) => responseJson<{ filename: string; url: string }>(response));
      setExportResult(result);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const viewerMediaUrl = selectedAsset?.kind === "video"
    ? selectedItem?.kind === "video" && selectedItem.stabilize
      ? readyStabilizedPreview?.url
      : videoUrl(selectedAsset.id, activePlaybackSource)
    : selectedAsset ? thumbnailUrl(selectedAsset.id) : undefined;

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
          <div className="panel-heading"><h2>Library</h2><span>{media.length} sources</span></div>
          {libraryError && <p className="error-message">{libraryError}</p>}
          {!libraryError && media.length === 0 && <p className="empty-message">Scanning library...</p>}
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
              {stabilizing && <span className="processing-badge">Stabilizing...</span>}
            </div>
          </div>

          <div className="viewer-stage">
            {!selectedAsset && <div className="viewer-placeholder">Choose a source or timeline item</div>}
            {selectedAsset && selectedInfo && <div ref={mediaFrame} className="media-frame" style={{ aspectRatio: `${selectedInfo.width} / ${selectedInfo.height}` }}>
              {selectedAsset.kind === "video" ? viewerMediaUrl ? <video ref={videoRef} key={`${selectedItem?.id ?? "source"}:${activePlaybackSource}:${readyStabilizedPreview?.workId ?? "direct"}`}
                src={viewerMediaUrl} controls playsInline preload="metadata" onLoadedMetadata={(event) => videoReady(event.currentTarget)}
                onProgress={(event) => updateVideoProgress(event.currentTarget)} onDurationChange={(event) => updateVideoProgress(event.currentTarget)}
                onTimeUpdate={(event) => { updateVideoProgress(event.currentTarget); if (selectedItem?.kind === "video" && event.currentTarget.currentTime >= selectedItem.sourceOut) {
                  if (previewModeRef.current === "playing") advancePreview(); else event.currentTarget.pause();
                } }} onEnded={() => { if (previewModeRef.current === "playing") advancePreview(); }}
                onError={() => setPlaybackError("This browser cannot play the selected video.")} />
                : <div className="viewer-placeholder">Preparing stabilized preview...</div>
                : <img src={viewerMediaUrl} alt={selectedAsset.filename} />}
              {viewerMediaUrl && selectedItem?.crop && <div className="crop-rectangle" aria-label="Crop area. Drag to reposition; use corner handles to resize."
                onPointerDown={(event) => beginCrop(event, (event.target as HTMLElement).dataset.direction)} onPointerMove={moveCrop}
                onPointerUp={endCrop} onPointerCancel={endCrop} style={{ left: `${selectedItem.crop.x * 100}%`, top: `${selectedItem.crop.y * 100}%`,
                  width: `${selectedItem.crop.width * 100}%`, height: `${selectedItem.crop.height * 100}%` }}>
                {(["nw", "ne", "se", "sw"] as const).map((direction) => <span key={direction} className={`crop-handle crop-handle-${direction}`} data-direction={direction} />)}
              </div>}
              {viewerMediaUrl && selectedItem?.kind === "video" && selectedInfo.duration > 0 && <div className="trim-overlay">
                <div className="trim-readout">
                  <span>In {formatTime(selectedItem.sourceIn)}</span>
                  <span>Current {formatTime(playheadTime)}</span>
                  <span>Out {formatTime(selectedItem.sourceOut)}</span>
                </div>
                <div className="trim-track" aria-label="Source trim and playhead" onPointerDown={beginTrim} onPointerMove={moveTrim}
                  onPointerUp={endTrim} onPointerCancel={endTrim}>
                  <span className="trim-buffered" style={{ width: `${clamp(bufferedTime / selectedInfo.duration, 0, 1) * 100}%` }} />
                  <span className="trim-selection" style={{ left: `${selectedItem.sourceIn / selectedInfo.duration * 100}%`,
                    width: `${(selectedItem.sourceOut - selectedItem.sourceIn) / selectedInfo.duration * 100}%` }} />
                  <span className="trim-playhead" data-trim-action="playhead" style={{ left: `${clamp(playheadTime / selectedInfo.duration, 0, 1) * 100}%` }} />
                  <span className="trim-handle trim-handle-in" data-trim-action="in" role="slider" aria-label="Trim in"
                    aria-valuemin={0} aria-valuemax={selectedItem.sourceOut - MINIMUM_TRIM} aria-valuenow={selectedItem.sourceIn}
                    style={{ left: `${selectedItem.sourceIn / selectedInfo.duration * 100}%` }} />
                  <span className="trim-handle trim-handle-out" data-trim-action="out" role="slider" aria-label="Trim out"
                    aria-valuemin={selectedItem.sourceIn + MINIMUM_TRIM} aria-valuemax={selectedInfo.duration} aria-valuenow={selectedItem.sourceOut}
                    style={{ left: `${selectedItem.sourceOut / selectedInfo.duration * 100}%` }} />
                </div>
              </div>}
            </div>}
            {playbackError && <div className="error-message playback-error">{playbackError}</div>}
          </div>

          <div className="edit-strip">
            {selectedItem && selectedInfo ? <>
              <span>Crop {Math.round((selectedItem.crop?.width ?? 1) * selectedInfo.width)} × {Math.round((selectedItem.crop?.height ?? 1) * selectedInfo.height)} px</span>
              <button onClick={() => updateItem(selectedItem.id, (item) => ({ ...item, crop: centeredCrop(selectedInfo, project!.settings) }))}>Reset crop</button>
              {selectedItem.kind === "video" ? <>
                <label>In <input type="number" min="0" max={selectedItem.sourceOut - MINIMUM_TRIM} step="0.01" value={selectedItem.sourceIn}
                  onChange={(event) => { const value = clamp(Number(event.target.value), 0, selectedItem.sourceOut - MINIMUM_TRIM);
                    updateItem(selectedItem.id, (item) => item.kind === "video" ? { ...item, sourceIn: value } : item);
                    if (videoRef.current) videoRef.current.currentTime = value; setPlayheadTime(value); }} /></label>
                <label>Out <input type="number" min={selectedItem.sourceIn + MINIMUM_TRIM} max={selectedInfo.duration} step="0.01" value={selectedItem.sourceOut}
                  onChange={(event) => { const value = clamp(Number(event.target.value), selectedItem.sourceIn + MINIMUM_TRIM, selectedInfo.duration);
                    updateItem(selectedItem.id, (item) => item.kind === "video" ? { ...item, sourceOut: value } : item);
                    if (videoRef.current) videoRef.current.currentTime = value; setPlayheadTime(value); }} /></label>
                <output>{formatDuration(selectedItem.sourceOut - selectedItem.sourceIn)} of {formatDuration(selectedInfo.duration)}</output>
              </> : <label>Photo duration <input type="number" min="0.1" step="0.1" value={selectedItem.photoDuration}
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
                <button className="export-button" onClick={() => void exportProject()} disabled={!project?.items.length || exporting}>{exporting ? "Exporting..." : "Export Project"}</button>
              </div></div>
            <div className="timeline" aria-label="Project timeline">
              {project?.items.map((item, index) => {
                const asset = media.find((candidate) => candidate.id === item.mediaId);
                const selected = viewerSelection?.context === "timeline" && viewerSelection.itemId === item.id;
                return <article key={item.id} className={selected ? "timeline-card selected" : "timeline-card"} draggable
                  style={{ width: `${clamp(110 + itemDuration(item) * 5, 130, 300)}px` }} onDragStart={() => { dragItemId.current = item.id; }}
                  onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropItem(event, item.id)}>
                  <button className="timeline-select" aria-pressed={selected} onClick={() => { stopPreview(); setViewerSelection({ context: "timeline", itemId: item.id }); }}>
                    <img src={thumbnailUrl(item.mediaId)} alt="" /><span>{index + 1}. {asset?.filename ?? item.mediaId}</span><small>{formatDuration(itemDuration(item))} · {item.kind}</small>
                  </button>
                  <div className="card-actions"><button aria-label={`Move ${asset?.filename ?? "item"} left`} disabled={index === 0} onClick={() => moveItem(item.id, -1)}>←</button>
                    <button aria-label={`Move ${asset?.filename ?? "item"} right`} disabled={index === project.items.length - 1} onClick={() => moveItem(item.id, 1)}>→</button>
                    <button aria-label={`Remove ${asset?.filename ?? "item"}`} onClick={() => removeItem(item.id)}>Remove</button></div>
                </article>;
              })}
              {!project?.items.length && <p className="empty-message">Add media from the library.</p>}
            </div>
            <div className={exportError ? "export-status export-error" : "export-status"}>
              <span>Project exports use muted hard cuts; audio is not included yet.</span>
              {exportError && <span>{exportError}</span>}
              {exportResult && <a href={exportResult.url}>{exportResult.filename}</a>}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
