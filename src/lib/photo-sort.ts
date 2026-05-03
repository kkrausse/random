export const PHOTO_SORT_OPTIONS = [
  { value: "created-asc", label: "Date added ↑" },
  { value: "created-desc", label: "Date added ↓" },
  { value: "shuffle", label: "Shuffle" },
  { value: "species-az", label: "Species A-Z" },
  { value: "quality", label: "Image quality" },
] as const;

export type PhotoSort = (typeof PHOTO_SORT_OPTIONS)[number]["value"];

export const DEFAULT_PHOTO_SORT: PhotoSort = "created-asc";

export function parsePhotoSort(value: string | string[] | undefined): PhotoSort {
  const sortValue = Array.isArray(value) ? value[0] : value;
  return PHOTO_SORT_OPTIONS.some((option) => option.value === sortValue)
    ? (sortValue as PhotoSort)
    : DEFAULT_PHOTO_SORT;
}
