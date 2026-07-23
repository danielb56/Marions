const STATIC_CACHE = "reme-static-v1";
const WORKER_CACHE = "reme-worker-operational-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, WORKER_CACHE].includes(key)).map((key) => caches.delete(key)))),
])));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/sign-in") {
    event.waitUntil(caches.delete(WORKER_CACHE));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/reme-painting-group-logo.jpg") {
    event.respondWith(caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  if (!url.pathname.startsWith("/worker") || url.pathname.startsWith("/worker/notifications")) return;
  event.respondWith((async () => {
    const cache = await caches.open(WORKER_CACHE);
    try {
      const response = await Promise.race([
        fetch(event.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500)),
      ]);
      if (response.ok) {
        const body = await response.clone().arrayBuffer();
        await cache.put(event.request, new Response(body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8", "X-REME-Offline": "operational-only" } }));
      }
      return response;
    } catch {
      return (await cache.match(event.request)) || new Response("<main style='font-family:system-ui;padding:2rem'><h1>Offline</h1><p>This page has not been saved on this device yet. Reconnect and open it once.</p></main>", { status: 503, headers: { "Content-Type": "text/html" } });
    }
  })());
});
