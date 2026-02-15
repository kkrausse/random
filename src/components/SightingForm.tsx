"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import SpeciesAutocomplete from "./SpeciesAutocomplete";
import MapPicker from "./MapPicker";
import PhotoUpload from "./PhotoUpload";

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

interface Props {
  sighting?: SightingData;
}

export default function SightingForm({ sighting }: Props) {
  const router = useRouter();
  const isEditing = !!sighting;

  const [species, setSpecies] = useState<SpeciesSelection | null>(
    sighting
      ? { commonName: sighting.species, scientificName: "", speciesCode: sighting.speciesCode }
      : null
  );
  const [date, setDate] = useState(sighting?.date ?? new Date().toISOString().split("T")[0]);
  const [lat, setLat] = useState<number | null>(sighting?.lat ?? null);
  const [lng, setLng] = useState<number | null>(sighting?.lng ?? null);
  const [locationName, setLocationName] = useState(sighting?.locationName ?? "");
  const [notes, setNotes] = useState(sighting?.notes ?? "");
  const [photos, setPhotos] = useState<File[]>([]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!species) {
      setError("Please select a species");
      return;
    }
    if (lat === null || lng === null) {
      setError("Please select a location on the map");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      if (isEditing) {
        // Update sighting fields
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

        // Upload new photos if any
        if (photos.length > 0) {
          const formData = new FormData();
          photos.forEach((file) => formData.append("photos", file));
          await fetch(`/api/sightings/${sighting.id}/photos`, {
            method: "POST",
            body: formData,
          });
        }
      } else {
        const formData = new FormData();
        formData.set("species", species.commonName);
        formData.set("speciesCode", species.speciesCode);
        formData.set("date", date);
        formData.set("lat", String(lat));
        formData.set("lng", String(lng));
        formData.set("locationName", locationName);
        formData.set("notes", notes);
        photos.forEach((file) => formData.append("photos", file));

        const res = await fetch("/api/sightings", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save sighting");
        }
      }

      router.push("/");
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
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <MapPicker
        onLocationSelect={handleLocationSelect}
        initialLat={sighting?.lat}
        initialLng={sighting?.lng}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <PhotoUpload
        onFilesChange={setPhotos}
        existingPhotos={existingPhotos}
        onRemoveExisting={handleRemoveExisting}
      />

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
      >
        {submitting ? "Saving..." : isEditing ? "Save Changes" : "Log Sighting"}
      </button>
    </form>
  );
}
