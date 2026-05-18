const CACHE = 'ssif-v4'

self.addEventListener('install', e => {
  // Ingen precache — undgår "addAll failed"-fejl og forceert cache af HTML
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  // Slet alle gamle caches (fx ssif-v3)
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  if (!e.request.url.startsWith('http')) return

  const url = new URL(e.request.url)

  // API-kald: aldrig SW — lad netværket håndtere dem
  if (url.pathname.startsWith('/api/')) return

  // Navigation + HTML: altid netværk, fallback til cached index.html (offline)
  // Dette sikrer at en ny deploy altid leverer frisk HTML med korrekte JS-hashes
  if (e.request.mode === 'navigate'
      || url.pathname === '/'
      || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Opdatér cachen med den friske HTML
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Hashed assets (/assets/…): cache-first — de er immutable (nyt navn ved ny build)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached
        return fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
          return res
        })
      })
    )
    return
  }

  // Alt andet (logo, manifest, ikoner): netværk-first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})

// ── Push-notifikationer ───────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return

  let payload = {}
  try { payload = e.data.json() } catch { return }

  const n     = payload.notification ?? payload.data ?? {}
  const title = n.title || payload.title || 'SSIF'
  const body  = n.body  || payload.body  || ''

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:     '/icon-192.png',
      badge:    '/icon-192.png',
      tag:      'ssif-push',
      renotify: true,
      data:     { url: '/' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = e.notification.data?.url || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const existing = all.find(c => c.url.startsWith(self.location.origin + '/'))
      if (existing) { existing.focus(); return }
      clients.openWindow(target)
    })
  )
})
