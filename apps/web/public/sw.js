importScripts("/offline-assets.js");
const CACHE = "axiom-shell-" + self.AXIOM_BUILD_ID;
function localResponse(response) {
  if (!response)
    return new Response(
      "Open Axiom online once before using its offline shell.",
      { status: 503 },
    );
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "/",
          "/icon.svg",
          "/manifest.webmanifest",
          ...self.AXIOM_ASSETS,
        ]),
      ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("axiom-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/sync")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put("/", copy)),
            );
          }
          return response;
        })
        .catch(async () => localResponse(await caches.match("/"))),
    );
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    ["/icon.svg", "/manifest.webmanifest"].includes(url.pathname)
  )
    event.respondWith(
      caches
        .match(event.request)
        .then(
          (cached) =>
            cached ||
            fetch(event.request).then((response) => {
              if (response.ok) {
                const copy = response.clone();
                event.waitUntil(
                  caches
                    .open(CACHE)
                    .then((cache) => cache.put(event.request, copy)),
                );
              }
              return response;
            }),
        )
        .then((response) => {
          // A cached Response.url has no fragment. Forwarding it as-is changes
          // WorkerLocation.href and loses Turbopack's #params bootstrap data.
          // A synthetic response keeps the original worker request URL instead.
          if (["worker", "sharedworker"].includes(event.request.destination)) {
            return localResponse(response);
          }
          return response;
        }),
    );
});
