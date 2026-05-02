export default function Loading() {
  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <div className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
        <div className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse" />
      </div>
      <div className="columns-2 sm:columns-3 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="mb-2 break-inside-avoid bg-gray-200 rounded-lg animate-pulse"
            style={{ height: `${150 + (i % 3) * 60}px` }}
          />
        ))}
      </div>
    </div>
  );
}
