/* rule-evp-pwa-installable, rule-evp-pwa-no-offline-data
 * Only the static shell is cached. Every other request (the API, /storage, anything cross-origin) goes to the network
 * and is never written to a cache: no HR data and no supporting document is ever kept. */
const SHELL = 'evp-shell-v1'
const SHELL_FILES = ['/hors-ligne.html', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  // Sent at logout: empties every runtime cache.
  if (event.data === 'clear-caches') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  // NetworkOnly for the API, the storage and any other origin: the worker does not answer them at all.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/storage')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/hors-ligne.html')))
    return
  }
  // Static shell assets (hashed scripts, styles, fonts): cache first, filled on first use.
  if (url.pathname.startsWith('/assets/') || SHELL_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              void caches.open(SHELL).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
