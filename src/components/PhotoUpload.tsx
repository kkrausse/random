"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface ExistingPhoto {
  id: number;
  filename: string;
}

export interface UploadedPhoto {
  id: string;
  filename: string;
  width?: number;
  height?: number;
}

interface Props {
  onUploadsChange: (uploads: UploadedPhoto[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  onError?: (error: string) => void;
  existingPhotos?: ExistingPhoto[];
  onRemoveExisting?: (photoId: number) => void;
}

interface Preview {
  key: string;
  file: File;
  url: string;
  status: "uploading" | "uploaded" | "error";
  upload?: UploadedPhoto;
}

export default function PhotoUpload({
  onUploadsChange,
  onUploadingChange,
  onError,
  existingPhotos = [],
  onRemoveExisting,
}: Props) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onUploadsChange(previews.flatMap((preview) => (preview.upload ? [preview.upload] : [])));
    onUploadingChange?.(previews.some((preview) => preview.status === "uploading"));
  }, [onUploadingChange, onUploadsChange, previews]);

  const uploadFile = useCallback(
    async (key: string, file: File) => {
      try {
        const formData = new FormData();
        formData.set("photo", file);
        const res = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to upload photo");
        }

        setPreviews((prev) => {
          return prev.map((preview) =>
            preview.key === key
              ? { ...preview, status: "uploaded" as const, upload: data as UploadedPhoto }
              : preview
          );
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to upload photo";
        setPreviews((prev) => {
          return prev.map((preview) =>
            preview.key === key ? { ...preview, status: "error" as const } : preview
          );
        });
        onError?.(message);
      }
    },
    [onError]
  );

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const imageFiles = newFiles.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length !== newFiles.length) {
        onError?.("Only image files can be uploaded");
      }
      const newPreviews = imageFiles.map((file) => ({
        key: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        status: "uploading" as const,
      }));

      setPreviews((prev) => {
        return [...prev, ...newPreviews];
      });

      newPreviews.forEach((preview) => {
        void uploadFile(preview.key, preview.file);
      });
    },
    [onError, uploadFile]
  );

  const removeFile = (idx: number) => {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length > 0) {
        addFiles(files);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [addFiles]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Photos</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <p className="text-gray-500">
          Drop photos here, click to browse, or paste from clipboard
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            addFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>
      {(existingPhotos.length > 0 || previews.length > 0) && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {existingPhotos.map((photo) => (
            <div key={`existing-${photo.id}`} className="relative group">
              <img
                src={`/api/uploads/${photo.filename}`}
                alt="Existing"
                className="w-20 h-20 object-cover rounded-lg"
              />
              {onRemoveExisting && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveExisting(photo.id);
                  }}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  x
                </button>
              )}
            </div>
          ))}
          {previews.map((preview, idx) => (
            <div key={`new-${idx}`} className="relative group">
              <img
                src={preview.url}
                alt="Preview"
                className={`w-20 h-20 object-cover rounded-lg ${
                  preview.status === "uploading" ? "opacity-60" : ""
                }`}
              />
              {preview.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 text-xs text-white">
                  Uploading
                </div>
              )}
              {preview.status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-600/80 text-xs text-white">
                  Failed
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(idx);
                }}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
