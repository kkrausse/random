export type AppConfig = {
  mediaRoot: string;
  derivedRoot: string;
  projectRoot: string;
  proxy: {
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
