"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface ExistingPhoto {
  id: number;
  filename: string;
}

interface Props {
  onFilesChange: (files: File[]) => void;
  existingPhotos?: ExistingPhoto[];
  onRemoveExisting?: (photoId: number) => void;
}

export default function PhotoUpload({ onFilesChange, existingPhotos = [], onRemoveExisting }: Props) {
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const imageFiles = newFiles.filter((f) => f.type.startsWith("image/"));
      setPreviews((prev) => {
        const updated = [
          ...prev,
          ...imageFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
        ];
        onFilesChange(updated.map((p) => p.file));
        return updated;
      });
    },
    [onFilesChange]
  );

  const removeFile = (idx: number) => {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      const updated = prev.filter((_, i) => i !== idx);
      onFilesChange(updated.map((p) => p.file));
      return updated;
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
          onChange={(e) => addFiles(Array.from(e.target.files || []))}
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
                className="w-20 h-20 object-cover rounded-lg"
              />
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
