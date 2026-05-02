import Link from "next/link";
import { Suspense } from "react";
import PhotoGridLoader from "@/components/PhotoGridLoader";
import PhotoGridSkeleton from "@/components/PhotoGridSkeleton";

export default function HomePage() {
  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-green-800">Bird Log</h1>
        <Link
          href="/add"
          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium"
        >
          + Add Sighting
        </Link>
      </div>

      <Suspense fallback={<PhotoGridSkeleton />}>
        <PhotoGridLoader />
      </Suspense>
    </div>
  );
}
