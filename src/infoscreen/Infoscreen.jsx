import { useState, useEffect, useRef } from 'react'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import {
  doc, collection, query, where, orderBy, limit,
  onSnapshot, getDocs, Timestamp,
} from 'firebase/firestore'
import { auth, db } from '../firebase.js'

const REFRESH_INTERVAL_MS = 30 * 60 * 1000

// ── Dato-hjælpere ─────────────────────────────────────────────────────────────

const DAYS_DA   = ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag']
const MONTHS_DA = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec']

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
  return da.getFullYear() === db_.getFullYear() && da.getMonth() === db_.getMonth() && da.getDate() === db_.getDate()
}

// ── Tidsstyring ───────────────────────────────────────────────────────────────

function parseMins(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

function isSlideActive(slide) {
  const sch = slide.schedule
  if (!sch?.enabled) return true
  const now = new Date()
  const days = sch.days || []
  if (days.length > 0 && !days.includes(now.getDay())) return false
  if (sch.timeFrom || sch.timeTo) {
    const nowMins = now.getHours() * 60 + now.getMinutes()
    const from = parseMins(sch.timeFrom)
    const to   = parseMins(sch.timeTo)
    if (from !== null && nowMins < from) return false
    if (to   !== null && nowMins > to)   return false
  }
  return true
}

// ── Bagudkompatibel normalisering ─────────────────────────────────────────────

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

function normalizeConfig(sc) {
  if (!sc) return sc
  if (sc.slides) return sc
  const slides = []
  if (sc.mode === 'image') {
    const urls = sc.imageUrls?.length ? sc.imageUrls : (sc.imageUrl ? [sc.imageUrl] : [])
    for (const url of urls) {
      slides.push({ id: uid(), duration: sc.duration || 15, layout: 'full', blocks: [{ id: uid(), type: 'image', url, fit: 'cover' }] })
    }
  } else {
    for (const tpl of (sc.templates || ['events'])) {
      const slide = { id: uid(), duration: sc.duration || 15, layout: 'full', blocks: [] }
      if (tpl === 'events')       slide.blocks.push({ id: uid(), type: 'events', holdIds: sc.holdIds || [] })
      else if (tpl === 'news')    slide.blocks.push({ id: uid(), type: 'news' })
      else if (tpl === 'custom')  slide.blocks.push(...(sc.customBlocks || []).map(b => ({ ...b, id: uid() })))
      slides.push(slide)
    }
  }
  return {
    ...sc,
    header: { text: sc.headerText || '', logoUrl: sc.headerLogoUrl || '', bgColor: sc.headerBgColor || '#1a5c2a', textColor: '#ffffff' },
    slides,
  }
}

// ── Blok-renderers ────────────────────────────────────────────────────────────

const TYPE_COLORS = { kamp: '#ef4444', træning: '#4ade80', generel: '#60a5fa', stævne: '#f59e0b', event: '#c084fc' }
const TYPE_LABELS = { kamp: 'KAMP', træning: 'TRÆNING', generel: 'BEGIVENHED', stævne: 'STÆVNE', event: 'EVENT' }

function EventsBlock({ block, events }) {
  const holdIds = new Set(block.holdIds || [])
  const filtered = holdIds.size > 0 ? events.filter(ev => holdIds.has(String(ev.holdId))) : events

  if (!filtered.length) return (
    <div className="is-empty-block">
      <span className="is-empty-icon">📅</span>
      <p>Ingen kommende begivenheder</p>
    </div>
  )

  const byDay = []
  let lastDay = null
  for (const ev of filtered) {
    if (!lastDay || !isSameDay(ev.start, lastDay)) {
      byDay.push({ day: ev.start, items: [] })
      lastDay = ev.start
    }
    byDay[byDay.length - 1].items.push(ev)
  }

  return (
    <div className="is-events-block">
      <div className="is-block-header"><span className="is-block-icon">📅</span><span className="is-block-title">Kommende begivenheder</span></div>
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
                    <span className="is-event-badge" style={{ background: color + '22', color }}>{label}</span>
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

function NewsBlock({ news }) {
  if (!news.length) return (
    <div className="is-empty-block">
      <span className="is-empty-icon">📰</span>
      <p>Ingen nyheder endnu</p>
    </div>
  )
  return (
    <div className="is-news-block">
      <div className="is-block-header"><span className="is-block-icon">📰</span><span className="is-block-title">Nyheder fra SSIF</span></div>
      <div className="is-news-list">
        {news.slice(0, 4).map((item, i) => (
          <div key={i} className="is-news-item">
            {item.imageUrl && (
              <div className="is-news-img-wrap">
                <img src={item.imageUrl} alt="" className="is-news-img" onError={e => { e.target.parentElement.style.display = 'none' }} />
              </div>
            )}
            <div className="is-news-body">
              {item.category && (
                <span className="is-news-cat" style={{ background: (item.categoryColor || '#1a5c2a') + '33', color: item.categoryColor || '#4ade80' }}>{item.category}</span>
              )}
              <div className="is-news-title">{item.title}</div>
              {item.excerpt && <div className="is-news-excerpt">{item.excerpt.length > 140 ? item.excerpt.slice(0, 140) + '…' : item.excerpt}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImageBlock({ block }) {
  if (!block.url) return (
    <div className="is-empty-block">
      <span className="is-empty-icon">🖼</span>
      <p>Intet billede</p>
    </div>
  )
  return (
    <div className="is-image-block">
      <img src={block.url} alt="" style={{ width: '100%', height: '100%', objectFit: block.fit || 'cover', display: 'block' }}
        onError={e => { e.target.style.display = 'none' }} />
    </div>
  )
}

function TextBlock({ block }) {
  return (
    <div className="is-text-block" style={{
      fontSize:   (block.fontSize || 64) + 'px',
      color:      block.color    || '#ffffff',
      fontWeight: block.bold     ? 800 : 400,
      fontStyle:  block.italic   ? 'italic' : 'normal',
      textAlign:  block.align    || 'center',
    }}>
      {block.text}
    </div>
  )
}

function CountdownBlock({ block }) {
  const [days, setDays] = useState(null)
  useEffect(() => {
    function calc() {
      if (!block.targetDate) return
      const diff = Math.ceil((new Date(block.targetDate) - new Date()) / 86400000)
      setDays(Math.max(0, diff))
    }
    calc()
    const id = setInterval(calc, 60000)
    return () => clearInterval(id)
  }, [block.targetDate])

  return (
    <div className="is-countdown-block">
      <div className="is-countdown-number">{days !== null ? days : '—'}</div>
      <div className="is-countdown-label">{block.label || 'dage'}</div>
    </div>
  )
}

function EmbedBlock({ block }) {
  const bg = block.bg || '#000000'
  if ((block.mode || 'iframe') === 'html') {
    if (!block.html) return (
      <div className="is-empty-block">
        <span className="is-empty-icon">🌐</span>
        <p>Ingen HTML konfigureret</p>
      </div>
    )
    const srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:${bg};overflow:hidden;width:100vw;height:100vh;}</style></head><body>${block.html}</body></html>`
    return <div className="is-embed-block"><iframe srcdoc={srcdoc} title="embed" sandbox="allow-scripts" /></div>
  }
  if (!block.src) return (
    <div className="is-empty-block">
      <span className="is-empty-icon">🌐</span>
      <p>Ingen URL konfigureret</p>
    </div>
  )
  return (
    <div className="is-embed-block">
      <iframe src={block.src} title="embed"
        style={{ background: bg }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
    </div>
  )
}

function renderBlock(block, events, news) {
  switch (block.type) {
    case 'events':    return <EventsBlock    key={block.id} block={block} events={events} />
    case 'news':      return <NewsBlock      key={block.id} news={news} />
    case 'image':     return <ImageBlock     key={block.id} block={block} />
    case 'text':      return <TextBlock      key={block.id} block={block} />
    case 'countdown': return <CountdownBlock key={block.id} block={block} />
    case 'embed':     return <EmbedBlock     key={block.id} block={block} />
    default:          return null
  }
}

// ── Zone-player — uafhængig rotation pr. zone ─────────────────────────────────

function ZonePlayer({ zone, events, news }) {
  const [blockIdx, setBlockIdx] = useState(0)
  const [elapsed,  setElapsed]  = useState(0)
  const idxRef     = useRef(0)
  const elapsedRef = useRef(0)

  const blocks = zone.blocks || []

  useEffect(() => {
    idxRef.current     = 0
    elapsedRef.current = 0
    setBlockIdx(0)
    setElapsed(0)
    if (blocks.length <= 1) return
    const duration = (zone.duration || 10) * 1000
    const id = setInterval(() => {
      elapsedRef.current += 100
      setElapsed(elapsedRef.current)
      if (elapsedRef.current >= duration) {
        elapsedRef.current = 0
        setElapsed(0)
        idxRef.current = (idxRef.current + 1) % blocks.length
        setBlockIdx(idxRef.current)
      }
    }, 100)
    return () => clearInterval(id)
  }, [blocks.length, zone.duration])

  const block = blocks[blockIdx] || blocks[0]
  return (
    <div className="is-zone" style={{ width: zone.size || '50%' }}>
      {block ? renderBlock(block, events, news) : (
        <div className="is-empty-block"><p>Ingen indhold i zone</p></div>
      )}
      {blocks.length > 1 && (
        <div className="is-zone-progress">
          <div className="is-zone-progress-fill"
            style={{ width: `${Math.min(100, (elapsed / ((zone.duration || 10) * 1000)) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

// ── Layout-wrapper ────────────────────────────────────────────────────────────

function SlideLayout({ slide, events, news }) {
  const blocks = slide.blocks || []
  const layout = slide.layout || 'full'

  const bgStyle = {}
  if (slide.bgColor)    bgStyle.background = slide.bgColor
  if (slide.bgImageUrl) { bgStyle.backgroundImage = `url(${slide.bgImageUrl})`; bgStyle.backgroundSize = 'cover'; bgStyle.backgroundPosition = 'center' }

  if (layout === 'zones') {
    const zones = slide.zones || []
    return (
      <div className="is-layout-zones" style={bgStyle}>
        {zones.length
          ? zones.map(zone => <ZonePlayer key={zone.id} zone={zone} events={events} news={news} />)
          : <div className="is-empty-block"><p>Ingen zoner konfigureret</p></div>
        }
      </div>
    )
  }
  if (layout === 'left-right' && blocks.length >= 2) {
    return (
      <div className="is-layout-lr" style={bgStyle}>
        <div className="is-layout-slot">{renderBlock(blocks[0], events, news)}</div>
        <div className="is-layout-slot">{renderBlock(blocks[1], events, news)}</div>
      </div>
    )
  }
  if (layout === 'top-bottom' && blocks.length >= 2) {
    return (
      <div className="is-layout-tb" style={bgStyle}>
        <div className="is-layout-slot">{renderBlock(blocks[0], events, news)}</div>
        <div className="is-layout-slot">{renderBlock(blocks[1], events, news)}</div>
      </div>
    )
  }
  return (
    <div className="is-layout-full" style={bgStyle}>
      {blocks[0] ? renderBlock(blocks[0], events, news) : (
        <div className="is-empty-block"><p>Ingen indhold</p></div>
      )}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

function InfoHeader({ time, config }) {
  const h  = config?.header || {}
  const tc = h.textColor || '#ffffff'
  const pad = n => String(n).padStart(2, '0')
  const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}`
  const dateStr = `${DAYS_DA[time.getDay()]} ${time.getDate()}. ${MONTHS_DA[time.getMonth()]} ${time.getFullYear()}`

  return (
    <header className="is-header" style={h.bgColor ? { background: h.bgColor } : undefined}>
      <div className="is-header-logo">
        <img src={h.logoUrl || '../ssif-logo-white.png'} alt="" className="is-logo"
          onError={e => {
            if (h.logoUrl && !e.target._fallback) {
              e.target._fallback = true
              e.target.src = '../ssif-logo-white.png'
            } else { e.target.style.display = 'none' }
          }} />
        <div className="is-header-name">
          <span className="is-club-name" style={{ color: tc }}>{h.text || 'Sejs-Svejbæk IF'}</span>
          {config?.name && <span className="is-screen-name" style={{ color: tc, opacity: .65 }}>{config.name}</span>}
        </div>
      </div>
      <div className="is-header-clock">
        <div className="is-clock" style={{ color: tc }}>{timeStr}</div>
        <div className="is-date" style={{ color: tc, opacity: .7 }}>{dateStr}</div>
      </div>
    </header>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function SlideProgress({ total, current, elapsed, duration }) {
  if (total <= 1) return null
  return (
    <div className="is-progress-bar-wrap">
      <div className="is-progress-dots">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`is-progress-dot ${i === current ? 'active' : ''}`} />
        ))}
      </div>
      <div className="is-progress-track">
        <div className="is-progress-fill" style={{ width: `${Math.min(100, (elapsed / duration) * 100)}%` }} />
      </div>
    </div>
  )
}

function SplashScreen({ message }) {
  return (
    <div className="is-splash">
      <img src="../ssif-logo-white.png" alt="SSIF" className="is-splash-logo" onError={e => { e.target.style.display = 'none' }} />
      <p className="is-splash-msg">{message}</p>
    </div>
  )
}

// ── Hoved-komponent ───────────────────────────────────────────────────────────

export default function Infoscreen() {
  const screenId = new URLSearchParams(window.location.search).get('s')

  const [ready,   setReady]   = useState(false)
  const [config,  setConfig]  = useState(undefined)
  const [events,  setEvents]  = useState([])
  const [news,    setNews]    = useState([])
  const [time,    setTime]    = useState(new Date())
  const [slide,   setSlide]   = useState(0)
  const [elapsed, setElapsed] = useState(0)

  const configRef      = useRef(null)
  const slideRef       = useRef(0)
  const elapsedRef     = useRef(0)
  const intervalRef    = useRef(null)
  const lastVersionRef = useRef(Symbol('init'))
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

  // ── Fetch events + news med getDocs ──────────────────────────────────────────
  async function fetchContent(cfg) {
    if (!cfg) return
    try {
      const nowTs = Timestamp.fromDate(new Date())
      const cutTs = Timestamp.fromDate(new Date(Date.now() + 21 * 24 * 60 * 60 * 1000))
      const [evSnap, newsSnap] = await Promise.all([
        getDocs(query(collection(db, 'events'), where('start', '>=', nowTs), where('start', '<=', cutTs), orderBy('start'), limit(50))),
        getDocs(query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(6))),
      ])
      setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 20))
      setNews(newsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (_) {}
  }

  // ── Config onSnapshot — trigger fetchContent ved ny contentVersion ─────────
  useEffect(() => {
    if (!ready || !screenId) return
    const unsub = onSnapshot(doc(db, 'infoscreens', screenId), snap => {
      const raw  = snap.exists() ? { id: snap.id, ...snap.data() } : null
      const data = normalizeConfig(raw)
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

  // ── 30-min fallback ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    refreshTimer.current = setInterval(() => {
      if (configRef.current) fetchContent(configRef.current)
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(refreshTimer.current)
  }, [ready])

  // ── Slide-timer med tidsstyring ───────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const slides = config?.slides || []
    const active = slides.filter(isSlideActive)
    if (active.length === 0) return

    slideRef.current   = 0
    elapsedRef.current = 0
    setSlide(0)
    setElapsed(0)

    if (active.length <= 1) return

    intervalRef.current = setInterval(() => {
      const allSlides  = configRef.current?.slides || []
      const nowActive  = allSlides.filter(isSlideActive)
      if (nowActive.length <= 1) return
      if (slideRef.current >= nowActive.length) {
        slideRef.current = 0; elapsedRef.current = 0; setSlide(0); setElapsed(0); return
      }
      const duration = (nowActive[slideRef.current]?.duration ?? 15) * 1000
      elapsedRef.current += 100
      setElapsed(elapsedRef.current)
      if (elapsedRef.current >= duration) {
        elapsedRef.current = 0
        setElapsed(0)
        slideRef.current = (slideRef.current + 1) % nowActive.length
        setSlide(slideRef.current)
      }
    }, 100)

    return () => clearInterval(intervalRef.current)
  }, [config?.id, (config?.slides || []).length])

  // ── Rendering ─────────────────────────────────────────────────────────────────

  if (!screenId)                     return <SplashScreen message="Ingen skærm-ID — tilføj ?s=SCREENID i URL" />
  if (!ready || config === undefined) return <SplashScreen message="Forbinder…" />
  if (config === null)                return <SplashScreen message="Skærm ikke fundet. Kontakt administrator." />

  const allSlides    = config.slides || []
  const activeSlides = allSlides.filter(isSlideActive)
  const currentSlide = activeSlides[slide] ?? activeSlides[0] ?? allSlides[0]
  const duration     = (currentSlide?.duration ?? 15) * 1000

  return (
    <div className="is-root">
      <InfoHeader time={time} config={config} />
      <main className="is-main">
        {currentSlide
          ? <SlideLayout key={currentSlide.id} slide={currentSlide} events={events} news={news} />
          : <div className="is-empty-block"><p>Ingen slides konfigureret</p></div>
        }
      </main>
      <SlideProgress total={activeSlides.length} current={slide} elapsed={elapsed} duration={duration} />
    </div>
  )
}
