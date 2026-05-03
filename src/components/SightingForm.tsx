"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import SpeciesAutocomplete from "./SpeciesAutocomplete";
import MapPicker from "./MapPicker";
import PhotoUpload, { type UploadedPhoto } from "./PhotoUpload";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface SpeciesSelection {
  commonName: string;
  scientificName: string;
  speciesCode: string;
}

interface ExistingPhoto {
  id: number;
  filename: string;
}

interface SightingData {
  id: number;
  species: string;
  speciesCode: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
  notes: string | null;
  photos: ExistingPhoto[];
}

interface Prefill {
  date?: string;
  lat?: number;
  lng?: number;
  locationName?: string;
}

interface Props {
  sighting?: SightingData;
  prefill?: Prefill;
}

interface SavedSighting {
  id: number;
}

export default function SightingForm({ sighting, prefill }: Props) {
  const router = useRouter();
  const isEditing = !!sighting;

  const [species, setSpecies] = useState<SpeciesSelection | null>(
    sighting
      ? { commonName: sighting.species, scientificName: "", speciesCode: sighting.speciesCode }
      : null
  );
  const [date, setDate] = useState(sighting?.date ?? prefill?.date ?? new Date().toISOString().split("T")[0]);
  const [lat, setLat] = useState<number | null>(sighting?.lat ?? prefill?.lat ?? null);
  const [lng, setLng] = useState<number | null>(sighting?.lng ?? prefill?.lng ?? null);
  const [locationName, setLocationName] = useState(sighting?.locationName ?? prefill?.locationName ?? "");
  const [notes, setNotes] = useState(sighting?.notes ?? "");
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[]>(sighting?.photos ?? []);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleLocationSelect = useCallback(
    (lat: number, lng: number, name: string) => {
      setLat(lat);
      setLng(lng);
      setLocationName(name);
    },
    []
  );

  const handleRemoveExisting = (photoId: number) => {
    setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setRemovedPhotoIds((prev) => [...prev, photoId]);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!species) {
      setError("Please select a species");
      return;
    }
    if (lat === null || lng === null) {
      setError("Please select a location on the map");
      return;
    }
    if (uploadingPhotos) {
      setError("Please wait for photos to finish uploading");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      if (isEditing) {
        const res = await fetch(`/api/sightings/${sighting.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            species: species.commonName,
            speciesCode: species.speciesCode,
            date,
            lat,
            lng,
            locationName,
            notes,
            removedPhotoIds,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update sighting");
        }

        if (uploadedPhotos.length > 0) {
          const photoRes = await fetch(`/api/sightings/${sighting.id}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uploadedPhotoIds: uploadedPhotos.map((photo) => photo.id),
            }),
          });
          if (!photoRes.ok) {
            const data = await photoRes.json();
            throw new Error(data.error || "Failed to attach photos");
          }
        }
      } else {
        const res = await fetch("/api/sightings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            species: species.commonName,
            speciesCode: species.speciesCode,
            date,
            lat,
            lng,
            locationName,
            notes,
            uploadedPhotoIds: uploadedPhotos.map((photo) => photo.id),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save sighting");
        }

        const savedSighting = (await res.json()) as SavedSighting;
        window.history.replaceState(window.history.state, "", "/add");
        router.push(`/sighting/${savedSighting.id}`);
        router.refresh();
        return;
      }

      router.push(`/sighting/${sighting.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl mx-auto">
      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg">
          {error}
        </div>
      )}

      <SpeciesAutocomplete onSelect={setSpecies} initialValue={sighting?.species} />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Date
        </label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <MapPicker
        onLocationSelect={handleLocationSelect}
        initialLat={sighting?.lat ?? prefill?.lat}
        initialLng={sighting?.lng ?? prefill?.lng}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes..."
        />
      </div>

      <PhotoUpload
        onUploadsChange={setUploadedPhotos}
        onUploadingChange={setUploadingPhotos}
        onError={setError}
        existingPhotos={existingPhotos}
        onRemoveExisting={handleRemoveExisting}
      />

      <Button type="submit" disabled={submitting || uploadingPhotos} className="w-full">
        {submitting
          ? "Saving..."
          : uploadingPhotos
            ? "Uploading photos..."
            : isEditing
              ? "Save Changes"
              : "Log Sighting"}
      </Button>
    </form>
  );
}
