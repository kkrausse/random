import { Suspense } from "react";
import Image from "next/image";
import PhotoGridLoader from "@/components/PhotoGridLoader";
import PhotoGridSkeleton from "@/components/PhotoGridSkeleton";
import birdMogIcon from "./icon.png";

export default function ExplorePage() {
  return (
    <div className="px-4 py-8 sm:py-10">
      <section className="mx-auto mb-10 flex max-w-3xl flex-col items-center text-center">
        <Image
          src={birdMogIcon}
          alt="BirdMog quail logo"
          priority
          className="mb-5 h-auto w-40 sm:w-52"
        />
        <h1 className="text-4xl font-bold tracking-tight text-gray-950 sm:text-5xl">
          BirdMog
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-gray-600 sm:text-lg">
          Log your sightings, explore the world of bird photography
          and mog your fellow birders by sharing your best shots.
        </p>
      </section>

      <Suspense fallback={<PhotoGridSkeleton />}>
        <PhotoGridLoader />
      </Suspense>
    </div>
  );
}
