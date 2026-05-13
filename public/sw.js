const CACHE = 'ssif-v3'
const PRECACHE = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
      return cached || network
    })
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
