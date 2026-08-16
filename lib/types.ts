export type AppConfig = {
  mediaRoot: string;
  derivedRoot: string;
  projectRoot: string;

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
};

export type MediaInfo = {
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
