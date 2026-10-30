// Minimal service worker: makes SlideCast installable and shows a friendly
// page when the Mac can't be reached. API calls and videos are never cached.
const CACHE = "slidecast-shell-v1";
const SHELL = ["/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
       <body style="margin:0;display:grid;place-items:center;height:100vh;background:#0f1226;color:#eef0ff;font:16px system-ui;text-align:center;padding:24px">
       <div><h2>Can't reach your Mac</h2><p style="color:#9aa0c8">Make sure your Mac is awake and SlideCast is running,
       and that this device is connected (same Wi-Fi, or Tailscale on).</p>
       <button onclick="location.reload()" style="font:600 16px system-ui;border:0;border-radius:12px;padding:12px 22px;background:#ffc43d">Try again</button></div>`,
      { headers: { "Content-Type": "text/html" } }
    ))
  );
});
