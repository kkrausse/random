import Link from "next/link";
import { Suspense } from "react";
import PhotoGridLoader from "@/components/PhotoGridLoader";
import PhotoGridSkeleton from "@/components/PhotoGridSkeleton";

export default function HomePage() {
  return (
    <div className="p-4">
      <Suspense fallback={<PhotoGridSkeleton />}>
        <PhotoGridLoader />
      </Suspense>
    </div>
  );
}
