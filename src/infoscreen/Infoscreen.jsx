import { useState, useEffect, useRef } from 'react'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import {
  doc, collection, query, where, orderBy, limit,
  onSnapshot, getDocs, Timestamp,
} from 'firebase/firestore'
import { auth, db } from '../firebase.js'

// Opdateringsinterval som fallback (selvom contentVersion ikke skifter)
const REFRESH_INTERVAL_MS = 30 * 60 * 1000 // 30 minutter

// ── Hjælpefunktioner ──────────────────────────────────────────────────────────

const DAYS_DA  = ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag']
const MONTHS_DA = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec']

function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return `${DAYS_DA[d.getDay()]} ${d.getDate()}. ${MONTHS_DA[d.getMonth()]}`
}

function fmtDateShort(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function fmtDayShort(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return DAYS_DA[d.getDay()].slice(0, 3).toUpperCase()
}

function isSameDay(a, b) {
  if (!a || !b) return false
  const da = a.toDate ? a.toDate() : new Date(a)
  const db_ = b.toDate ? b.toDate() : new Date(b)
  return da.getFullYear() === db_.getFullYear()
    && da.getMonth() === db_.getMonth()
    && da.getDate() === db_.getDate()
}

const TYPE_COLORS = {
  kamp:       '#ef4444',
  træning:    '#4ade80',
  generel:    '#60a5fa',
  stævne:     '#f59e0b',
  event:      '#c084fc',
}
const TYPE_LABELS = {
  kamp:    'KAMP',
  træning: 'TRÆNING',
  generel: 'BEGIVENHED',
  stævne:  'STÆVNE',
  event:   'EVENT',
}

// ── Enkelt-slide: kommende begivenheder ───────────────────────────────────────

function EventsSlide({ events }) {
  if (!events.length) {
    return (
      <div className="is-empty-slide">
        <div className="is-empty-icon">📅</div>
        <p>Ingen kommende begivenheder</p>
      </div>
    )
  }

  // Gruppér efter dato (ud fra `start`-timestamp)
  const byDay = []
  let lastDay = null
  for (const ev of events) {
    const sameDay = lastDay && isSameDay(ev.start, lastDay)
    if (!sameDay) {
      byDay.push({ day: ev.start, items: [] })
      lastDay = ev.start
    }
    byDay[byDay.length - 1].items.push(ev)
  }

  return (
    <div className="is-events-slide">
      <div className="is-slide-header">
        <span className="is-slide-icon">📅</span>
        <span className="is-slide-title">Kommende begivenheder</span>
      </div>
      <div className="is-events-list">
        {byDay.map((group, gi) => (
          <div key={gi} className="is-day-group">
            <div className="is-day-label">
              <span className="is-day-name">{fmtDayShort(group.day)}</span>
              <span className="is-day-date">{fmtDateShort(group.day)}</span>
            </div>
            <div className="is-day-events">
              {group.items.map((ev, ei) => {
                const color = TYPE_COLORS[ev.type] || '#94a3b8'
                const label = TYPE_LABELS[ev.type] || (ev.type || '').toUpperCase()
                return (
                  <div key={ei} className="is-event-row">
                    <span className="is-event-badge" style={{ background: color + '22', color }}>
                      {label}
                    </span>
                    <span className="is-event-title">{ev.titel}</span>
                    <span className="is-event-meta">
                      {ev.tidStart && <span>{ev.tidStart}</span>}
                      {ev.sted && <span className="is-event-sted"> · {ev.sted}</span>}
                      {ev.holdNavn && <span className="is-event-hold"> · {ev.holdNavn}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Enkelt-slide: nyheder ─────────────────────────────────────────────────────

function NewsSlide({ news }) {
  if (!news.length) {
    return (
      <div className="is-empty-slide">
        <div className="is-empty-icon">📰</div>
        <p>Ingen nyheder endnu</p>
      </div>
    )
  }

  return (
    <div className="is-news-slide">
      <div className="is-slide-header">
        <span className="is-slide-icon">📰</span>
        <span className="is-slide-title">Nyheder fra SSIF</span>
      </div>
      <div className="is-news-list">
        {news.slice(0, 4).map((item, i) => (
          <div key={i} className="is-news-item">
            {item.imageUrl && (
              <div className="is-news-img-wrap">
                <img src={item.imageUrl} alt="" className="is-news-img"
                     onError={e => { e.target.parentElement.style.display = 'none' }} />
              </div>
            )}
            <div className="is-news-body">
              {item.category && (
                <span className="is-news-cat"
                      style={{ background: (item.categoryColor || '#1a5c2a') + '33',
                               color: item.categoryColor || '#4ade80' }}>
                  {item.category}
                </span>
              )}
              <div className="is-news-title">{item.title}</div>
              {item.excerpt && (
                <div className="is-news-excerpt">
                  {item.excerpt.length > 140 ? item.excerpt.slice(0, 140) + '…' : item.excerpt}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Billede-mode ──────────────────────────────────────────────────────────────

function ImageSlide({ url, screenName }) {
  if (!url) {
    return (
      <div className="is-empty-slide">
        <div className="is-empty-icon">🖼️</div>
        <p>Intet billede konfigureret</p>
      </div>
    )
  }
  return (
    <div className="is-image-mode">
      <img src={url} alt={screenName || ''} className="is-image-full" />
    </div>
  )
}

// ── Header med ur ────────────────────────────────────────────────────────────

function InfoHeader({ time, screenName }) {
  const pad = n => String(n).padStart(2, '0')
  const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}`
  const dateStr = `${DAYS_DA[time.getDay()]} ${time.getDate()}. ${MONTHS_DA[time.getMonth()]} ${time.getFullYear()}`

  return (
    <header className="is-header">
      <div className="is-header-logo">
        <img src="../ssif-logo.png" alt="SSIF" className="is-logo"
             onError={e => { e.target.style.display = 'none' }} />
        <div className="is-header-name">
          <span className="is-club-name">Sejs-Svejbæk IF</span>
          {screenName && <span className="is-screen-name">{screenName}</span>}
        </div>
      </div>
      <div className="is-header-clock">
        <div className="is-clock">{timeStr}</div>
        <div className="is-date">{dateStr}</div>
      </div>
    </header>
  )
}

// ── Progress bar for slide-rotation ──────────────────────────────────────────

function SlideProgress({ total, current, duration, elapsed }) {
  if (total <= 1) return null
  return (
    <div className="is-progress-bar-wrap">
      <div className="is-progress-dots">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`is-progress-dot ${i === current ? 'active' : ''}`} />
        ))}
      </div>
      <div className="is-progress-track">
        <div className="is-progress-fill"
             style={{ width: `${Math.min(100, (elapsed / duration) * 100)}%` }} />
      </div>
    </div>
  )
}

// ── Fejl- og loading-visninger ────────────────────────────────────────────────

function SplashScreen({ message }) {
  return (
    <div className="is-splash">
      <img src="../ssif-logo.png" alt="SSIF" className="is-splash-logo"
           onError={e => { e.target.style.display = 'none' }} />
      <p className="is-splash-msg">{message}</p>
    </div>
  )
}

// ── Hoved-komponent ───────────────────────────────────────────────────────────

export default function Infoscreen() {
  const screenId = new URLSearchParams(window.location.search).get('s')

  const [ready,   setReady]   = useState(false)   // anonym auth done
  const [config,  setConfig]  = useState(undefined) // undefined=loading, null=not found
  const [events,  setEvents]  = useState([])
  const [news,    setNews]    = useState([])
  const [time,    setTime]    = useState(new Date())
  const [slide,   setSlide]   = useState(0)
  const [elapsed, setElapsed] = useState(0)

  const configRef      = useRef(null)
  const slideRef       = useRef(0)
  const elapsedRef     = useRef(0)
  const intervalRef    = useRef(null)
  const lastVersionRef = useRef(Symbol('init')) // sentinel → udløser altid første hentning
  const refreshTimer   = useRef(null)

  // ── Anonym login ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { setReady(true); return }
      signInAnonymously(auth).catch(() => {})
    })
    return unsub
  }, [])

  // ── Live clock ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Hent indhold (events + news) med getDocs — aldrig realtime ───────────────
  // Kaldes kun når contentVersion skifter (admin "pusher") eller 30-min fallback.
  async function fetchContent(cfg) {
    if (!cfg) return
    try {
      const nowTs = Timestamp.fromDate(new Date())
      const cutTs = Timestamp.fromDate(new Date(Date.now() + 21 * 24 * 60 * 60 * 1000))
      const evQuery = query(
        collection(db, 'events'),
        where('start', '>=', nowTs),
        where('start', '<=', cutTs),
        orderBy('start'),
        limit(50),
      )
      const [evSnap, newsSnap] = await Promise.all([
        getDocs(evQuery),
        getDocs(query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(6))),
      ])
      const hids = new Set(cfg.holdIds || [])
      let evs = evSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (hids.size > 0) evs = evs.filter(ev => hids.has(String(ev.holdId)))
      setEvents(evs.slice(0, 20))
      setNews(newsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (_) {}
  }

  // ── Hent screen-config (realtime, kun metadata) ──────────────────────────────
  // Trigger getDocs-hentning når contentVersion ændres — admin "pusher" derved nyt indhold.
  useEffect(() => {
    if (!ready || !screenId) return
    const unsub = onSnapshot(doc(db, 'infoscreens', screenId), snap => {
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null
      configRef.current = data
      setConfig(data)
      if (data) {
        const version = data.contentVersion ?? null
        if (version !== lastVersionRef.current) {
          lastVersionRef.current = version
          fetchContent(data)
        }
      }
    })
    return unsub
  }, [ready, screenId])

  // ── 30-minutters fallback: opdater indhold selvom ingen pusher ───────────────
  useEffect(() => {
    if (!ready) return
    refreshTimer.current = setInterval(() => {
      if (configRef.current) fetchContent(configRef.current)
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(refreshTimer.current)
  }, [ready])

  // ── Slide-timer ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const templates = config?.templates || []
    if (templates.length <= 1) return

    const duration = (config?.duration ?? 15) * 1000
    elapsedRef.current = 0
    setElapsed(0)

    intervalRef.current = setInterval(() => {
      elapsedRef.current += 100
      setElapsed(elapsedRef.current)
      if (elapsedRef.current >= duration) {
        elapsedRef.current = 0
        setElapsed(0)
        slideRef.current = (slideRef.current + 1) % templates.length
        setSlide(slideRef.current)
      }
    }, 100)

    return () => clearInterval(intervalRef.current)
  }, [config?.templates?.join(','), config?.duration])

  // ── Rendering ─────────────────────────────────────────────────────────────────

  if (!screenId) {
    return <SplashScreen message="Ingen skærm-ID i URL — tilføj ?s=SCREENID" />
  }
  if (!ready || config === undefined) {
    return <SplashScreen message="Forbinder…" />
  }
  if (config === null) {
    return <SplashScreen message="Skærm ikke fundet. Kontakt administrator." />
  }

  const templates = config.templates || []
  const duration  = config.duration ?? 15

  function renderContent() {
    if (config.mode === 'image') {
      return <ImageSlide url={config.imageUrl} screenName={config.name} />
    }
    const activeTemplate = templates[slide] || templates[0]
    if (activeTemplate === 'events') return <EventsSlide events={events} />
    if (activeTemplate === 'news')   return <NewsSlide   news={news} />
    return (
      <div className="is-empty-slide">
        <p>Ingen skabelon valgt</p>
      </div>
    )
  }

  return (
    <div className="is-root">
      <InfoHeader time={time} screenName={config.name} />
      <main className="is-main">
        {renderContent()}
      </main>
      {config.mode === 'templates' && templates.length > 1 && (
        <SlideProgress
          total={templates.length}
          current={slide}
          duration={duration * 1000}
          elapsed={elapsed}
        />
      )}
    </div>
  )
}
