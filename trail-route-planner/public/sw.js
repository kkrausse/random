const CACHE = "trail-routes-v0-4";
self.addEventListener("install", event => { event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const assets = self.__ASSETS || ["/", "/kings-beach.json", "/manifest.webmanifest", "/icon.svg"];
  await cache.addAll(assets);
  await self.skipWaiting();
})()); });
self.addEventListener("activate", event => { event.waitUntil((async () => { for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key); await self.clients.claim(); })()); });
self.addEventListener("fetch", event => { if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => { const cache = await caches.open(CACHE); return await cache.match(event.request) || await fetch(event.request); })());
});
