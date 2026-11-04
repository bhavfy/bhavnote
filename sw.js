/* Bhavnote service worker — offline app shell. */
const VERSION = "2.0.1-20261104b";
const CACHE = "bhavnote-v2-20261104b";
const THUMBS = "bhavnote-thumbs";
const SHELL = ["./", "./index.html", "./styles.css?v=20261104", "./app.js?v=20261104", "./paisa.js?v=20261104", "./calendar.js?v=20261104", "./ai.js?v=20261104b", "./history.js?v=20261104", "./books.js?v=20261104", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("bhavnote-") && k !== CACHE && k !== THUMBS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // YouTube thumbnails: keep a copy for offline viewing.
  if (url.hostname === "img.youtube.com") {
    e.respondWith(caches.open(THUMBS).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return; // Gemini API calls and wa.me links go straight to the network
  // Pages: network first so GitHub edits show up, cache as fallback offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); return r; })
      .catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))));
    return;
  }
  // Assets: stale-while-revalidate.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
