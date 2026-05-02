import { Suspense } from "react";
import PhotoGridLoader from "@/components/PhotoGridLoader";
import PhotoGridSkeleton from "@/components/PhotoGridSkeleton";

export default function ExplorePage() {
  return (
    <div className="p-4">
      <Suspense fallback={<PhotoGridSkeleton />}>
        <PhotoGridLoader />
      </Suspense>
    </div>
  );
}
