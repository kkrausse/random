export type AppConfig = {
  mediaRoot: string;
  derivedRoot: string;
  savedProjectsRoot: string;
  ffmpegPath: string;

  thumbnail: {
    maxWidth: number;
    quality: number;
  };

  proxy: {
    enabled: boolean;
    maxHeight: number;
    codec: "h264";
    crf: number;
    audioCodec: "aac";
  };
  export: {
    codec: "h264";
    quality: number;
  };
};

export type MediaAsset = {
  id: string;
  filename: string;
  relativePath: string;
  kind: "video" | "photo";
};

export type PlaybackSource = "proxy" | "original";

export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MediaInfo = {
  kind: MediaAsset["kind"];
  scanVersion: number;
  source: string;
  sourceMtimeMs: number;
  sourceSize: number;
  width: number;
  height: number;
  fps: number;
  duration: number;
  codec?: string;
  profile?: string;
  pixelFormat?: string;
  videoBitrate?: number;
  containerBitrate?: number;
  thumbnail: AppConfig["thumbnail"];
  proxy?: AppConfig["proxy"];
};

export type ProjectSettings = {
  width: number;
  height: number;
  fps: number;
};

type TimelineItemBase = {
  id: string;
  mediaId: string;
  stabilize: boolean;
  crop?: NormalizedCrop;
};

export type TimelineItem =
  | TimelineItemBase & {
    kind: "video";
    sourceIn: number;
    sourceOut: number;
  }
  | TimelineItemBase & {
    kind: "photo";
    photoDuration: number;
  };

export type Project = {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  settings: ProjectSettings;
  items: TimelineItem[];
};
