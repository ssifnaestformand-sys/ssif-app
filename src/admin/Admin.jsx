import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { auth, db, storage } from '../firebase.js'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import {
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut, onAuthStateChanged,
} from 'firebase/auth'
import {
  collection, query, where, orderBy, limit, onSnapshot,
  addDoc, updateDoc, deleteDoc, serverTimestamp,
  doc, getDoc, setDoc, getDocs,
} from 'firebase/firestore'
import './admin.css'

// Admin bor i /admin/ – '../' går op til roden uanset domæne/sti
const BASE = '../'

// ─── Static Data ──────────────────────────────────────────────────────────────

const TEAMS_STATIC = [
  { id: 'u6',       name: 'U6',       category: 'Ungdom' },
  { id: 'u8',       name: 'U8',       category: 'Ungdom' },
  { id: 'u10',      name: 'U10',      category: 'Ungdom' },
  { id: 'u12',      name: 'U12',      category: 'Ungdom' },
  { id: 'u14',      name: 'U14',      category: 'Ungdom' },
  { id: 'u16',      name: 'U16',      category: 'Ungdom' },
  { id: 'herrer-a', name: 'Herrer A', category: 'Senior' },
  { id: 'herrer-b', name: 'Herrer B', category: 'Senior' },
  { id: 'damer',    name: 'Damer',    category: 'Senior' },
]

const NEWS_CATEGORIES = [
  { value: 'Kamp',             color: '#1a5c2a' },
  { value: 'Klubnyt',          color: '#5856d6' },
  { value: 'Arrangement',      color: '#ff3b30' },
  { value: 'Frivillige',       color: '#34c759' },
  { value: 'Fodbold',          color: '#007aff' },
  { value: 'Håndbold',         color: '#ff6b00' },
  { value: 'Badminton',        color: '#00c7be' },
  { value: 'Floorball',        color: '#ff2d55' },
  { value: 'Gymnastik',        color: '#af52de' },
  { value: 'Aktiv om Dagen',   color: '#ff9500' },
  { value: 'Volleyball',       color: '#ff6b35' },
  { value: 'Tennis',           color: '#30d158' },
  { value: 'Vinterbadning',    color: '#0a84ff' },
  { value: 'Cykling',          color: '#ffd60a' },
  { value: 'Kajak',            color: '#64d2ff' },
  { value: 'Motion og Fitness',color: '#ff375f' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts) {
  if (!ts) return '–'
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
}

function teamName(id) {
  return TEAMS_STATIC.find(t => t.id === id)?.name ?? id
}

function getVisibleTeams(userDoc) {
  if (userDoc?.role === 'admin') return TEAMS_STATIC
  return TEAMS_STATIC.filter(t => (userDoc?.holds ?? []).includes(t.id))
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function Icon({ name, size = 18, color = 'currentColor', sw = 1.75 }) {
  const p = {
    home:     <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    users:    <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
    news:     <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
    message:  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
    person:   <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    logout:   <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    edit:     <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></>,
    send:     <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    shield:   <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
    mail:     <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
    check:    <polyline points="20 6 9 17 4 12"/>,
    x:        <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    link:     <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
         style={{ display: 'block', flexShrink: 0 }}>
      {p[name]}
    </svg>
  )
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="loading-dots"><span/><span/><span/></div>
    </div>
  )
}

function EmptyState({ icon, text }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Icon name={icon} size={32} color="#9ca3af" /></div>
      <p className="empty-state-text">{text}</p>
    </div>
  )
}

function ConfirmDialog({ title, body, onConfirm, onCancel, danger }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <p className="dialog-title">{title}</p>
        <p className="dialog-body">{body}</p>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Annuller</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>Bekræft</button>
        </div>
      </div>
    </div>
  )
}

function CategoryPill({ label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 600,
      background: color + '22', color,
    }}>
      {label}
    </span>
  )
}

function HoldPill({ holdId, name }) {
  // holdId kan være: gammelt slug ('u6'), conventus_id-string ('999018') eller objekt {conventus_id, titel}
  const display = name
    || (holdId && typeof holdId === 'object' ? (holdId.titel || `Hold #${holdId.conventus_id}`) : null)
    || teamName(holdId)
    || String(holdId)
  return (
    <span className="badge badge-green" style={{ marginRight: 3, marginBottom: 3 }}>
      {display}
    </span>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginPage({ onDemoLogin }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await sendSignInLinkToEmail(auth, email.trim(), {
        url: window.location.href,
        handleCodeInApp: true,
      })
      localStorage.setItem('adminSignInEmail', email.trim())
      setSent(true)
    } catch (err) {
      setError('Kunne ikke sende link: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login">
      <div className="login-box">
        <div className="login-logo-admin"><span>SSIF</span></div>
        <h1 className="login-title">Backoffice</h1>
        <p className="login-sub">Sejs-Svejbæk IF · Administrationsportal</p>
        {sent ? (
          <div className="alert-info">
            <strong>Link sendt til {email}</strong><br />
            Tjek din indbakke og klik på login-linket for at fortsætte.
          </div>
        ) : (
          <form onSubmit={sendLink}>
            <div className="form-group">
              <label className="form-label">Email-adresse</label>
              <input
                className="form-control"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="din@email.dk"
                autoFocus
                required
              />
            </div>
            {error && <p style={{ color: '#dc3545', fontSize: 13, marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-primary" style={{ width: '100%', height: 42, fontSize: 14 }} disabled={loading}>
              {loading ? 'Sender…' : 'Send magic link'}
            </button>
          </form>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: 'var(--text3)', fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          eller
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <button
          className="btn btn-ghost"
          style={{ width: '100%', height: 42, fontSize: 14 }}
          onClick={onDemoLogin}
        >
          Demo adgang (admin)
        </button>

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
          Demo-tilstand bruger ikke rigtige data og gemmer ingenting.
        </p>
      </div>
    </div>
  )
}

function UnauthorizedPage({ user }) {
  return (
    <div className="admin-login">
      <div className="login-box" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h2 style={{ marginBottom: 8 }}>Ingen adgang</h2>
        <p style={{ color: 'var(--text2)', marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
          Din konto ({user.email}) er ikke tildelt en rolle endnu.<br />
          Kontakt en administrator for at få adgang.
        </p>
        <button className="btn btn-ghost" onClick={() => signOut(auth)}>Log ud</button>
      </div>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ page, setPage, userDoc, user, onLogout }) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard',  icon: 'home'    },
    { id: 'messages',  label: 'Beskeder',   icon: 'message' },
    { id: 'news',      label: 'Nyheder',    icon: 'news'    },
    { id: 'teams',     label: 'Hold',       icon: 'users'   },
    { id: 'events', label: 'Begivenheder', icon: 'calendar' },
    ...(userDoc?.role === 'admin' ? [{ id: 'users', label: 'Brugere', icon: 'shield' }] : []),
  ]
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">SSIF</div>
        <div className="sidebar-logo-sub">Backoffice · Sejs-Svejbæk IF</div>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-section">Navigation</div>
        {nav.map(item => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <Icon name={item.icon} size={16} color="currentColor" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">
            {(userDoc?.displayName || user.email)[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name">{userDoc?.displayName || user.email}</div>
            <div className="sidebar-user-role">
              {userDoc?.role === 'admin' ? 'Administrator' : 'Træner'}
            </div>
          </div>
        </div>
        <button className="nav-item nav-item-logout" onClick={onLogout}>
          <Icon name="logout" size={15} color="currentColor" />
          Log ud
        </button>
      </div>
    </aside>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardPage({ userDoc }) {
  const [newsCount, setNewsCount]     = useState(null)
  const [msgCount, setMsgCount]       = useState(null)
  const [recentNews, setRecentNews]   = useState([])
  const [recentMsgs, setRecentMsgs]   = useState([])

  useEffect(() => {
    const unsubNews = onSnapshot(
      query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(50)),
      snap => {
        setNewsCount(snap.size)
        setRecentNews(snap.docs.slice(0, 5).map(d => ({ id: d.id, ...d.data() })))
      }
    )
    const unsubMsgs = onSnapshot(
      query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(50)),
      snap => {
        setMsgCount(snap.size)
        setRecentMsgs(snap.docs.slice(0, 5).map(d => ({ id: d.id, ...d.data() })))
      }
    )
    return () => { unsubNews(); unsubMsgs() }
  }, [])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Velkommen tilbage, {userDoc?.displayName?.split(' ')[0] || 'Admin'}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#e8f5ec' }}>
            <Icon name="users" size={20} color="#1a5c2a" />
          </div>
          <div className="stat-card-value" style={{ color: '#1a5c2a' }}>
            {TEAMS_STATIC.length}
          </div>
          <div className="stat-card-label">Hold i alt</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#ede9fe' }}>
            <Icon name="news" size={20} color="#5856d6" />
          </div>
          <div className="stat-card-value" style={{ color: '#5856d6' }}>
            {newsCount ?? '…'}
          </div>
          <div className="stat-card-label">Nyheder</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fff3e0' }}>
            <Icon name="message" size={20} color="#ff9500" />
          </div>
          <div className="stat-card-value" style={{ color: '#ff9500' }}>
            {msgCount ?? '…'}
          </div>
          <div className="stat-card-label">Beskeder sendt</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Seneste nyheder</span>
          </div>
          {recentNews.length === 0 ? (
            <EmptyState icon="news" text="Ingen nyheder endnu" />
          ) : (
            recentNews.map(a => (
              <div key={a.id} className="dash-list-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dash-item-title">{a.title}</div>
                  <div className="dash-item-meta">{formatDate(a.createdAt)}</div>
                </div>
                <CategoryPill label={a.category} color={a.categoryColor || '#1a5c2a'} />
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Seneste beskeder</span>
          </div>
          {recentMsgs.length === 0 ? (
            <EmptyState icon="message" text="Ingen beskeder endnu" />
          ) : (
            recentMsgs.map(m => (
              <div key={m.id} className="dash-list-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="dash-item-title" style={{ fontSize: 13 }}>
                    {m.text?.slice(0, 70)}{m.text?.length > 70 ? '…' : ''}
                  </div>
                  <div className="dash-item-meta">
                    {m.authorName} · {formatDate(m.createdAt)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function MessagesPage({ userDoc, authUser }) {
  const [text, setText]                     = useState('')
  const [selectedIds, setSelectedIds]       = useState([])   // conventus_id som strings
  const [sending, setSending]               = useState(false)
  const [messages, setMessages]             = useState([])
  const [msgLoading, setMsgLoading]         = useState(true)
  const [availableHolds, setAvailableHolds] = useState([])
  const [holdsLoading, setHoldsLoading]     = useState(true)

  // Hent aktive hold fra Firestore
  useEffect(() => {
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => {
        let all = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
        // Trænere ser kun tildelte hold
        if (userDoc?.role !== 'admin' && userDoc?.holds?.length) {
          const mine = new Set(userDoc.holds.map(String))
          all = all.filter(h => mine.has(String(h.conventus_id)))
        }
        all.sort((a, b) =>
          (a.aktivitet_titel || '').localeCompare(b.aktivitet_titel || '', 'da') ||
          (a.titel || '').localeCompare(b.titel || '', 'da')
        )
        setAvailableHolds(all)
      })
      .finally(() => setHoldsLoading(false))
  }, [])

  // Lyt på beskeder i real-time
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(100)),
      snap => { setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setMsgLoading(false) }
    )
  }, [])

  function toggleId(conventusId) {
    const s = String(conventusId)
    setSelectedIds(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function send(e) {
    e.preventDefault()
    if (!text.trim() || selectedIds.length === 0) return
    setSending(true)
    try {
      const authorName = userDoc?.displayName || authUser.email

      // targetHolds gemmes som array af {conventus_id, titel}
      const targetHolds = availableHolds
        .filter(h => selectedIds.includes(String(h.conventus_id)))
        .map(h => ({ conventus_id: h.conventus_id, titel: h.titel }))

      await addDoc(collection(db, 'messages'), {
        text:        text.trim(),
        authorUid:   authUser.uid,
        authorName,
        targetHolds,
        createdAt:   serverTimestamp(),
      })

      // Push-notifikation (fejler lydløst)
      try {
        const fd = new FormData()
        fd.append('holdIds', JSON.stringify(selectedIds))
        fd.append('text',    text.trim())
        fd.append('title',   `Besked fra ${authorName}`)
        await fetch(`${BASE}api/send-push.php`, {
          method: 'POST',
          headers: { 'X-Sync-Secret': import.meta.env.VITE_SYNC_SECRET ?? '' },
          body: fd,
        })
      } catch {}

      setText('')
      setSelectedIds([])
    } finally {
      setSending(false)
    }
  }

  // Gruppér hold efter idrætgren til visning
  const byType = availableHolds.reduce((acc, h) => {
    const t = h.aktivitet_titel || 'Hold'
    if (!acc[t]) acc[t] = []
    acc[t].push(h)
    return acc
  }, {})

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Beskeder</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Send ny besked</h3>
          <form onSubmit={send}>
            <div className="form-group">
              <label className="form-label">Modtagere (hold)</label>

              {holdsLoading ? (
                <p className="form-hint">Henter aktive hold…</p>
              ) : availableHolds.length === 0 ? (
                <p className="form-hint" style={{ color: '#92400e' }}>
                  Ingen aktive hold — aktivér hold under Hold-siden først.
                </p>
              ) : (
                Object.entries(byType).map(([type, typeHolds]) => (
                  <div key={type} style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: '.4px', color: 'var(--text2)', marginBottom: 5 }}>
                      {type}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {typeHolds.map(h => {
                        const id = String(h.conventus_id)
                        const checked = selectedIds.includes(id)
                        return (
                          <label key={id} className={`hold-check-label ${checked ? 'selected' : ''}`}
                                 style={{ gridColumn: 'unset' }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleId(h.conventus_id)} />
                            {h.titel}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}

              {!holdsLoading && selectedIds.length === 0 && availableHolds.length > 0 && (
                <p className="form-hint">Vælg mindst ét hold</p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Besked</label>
              <textarea
                className="form-control"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Skriv din besked her…"
                rows={4}
                required
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', height: 40 }}
              disabled={sending || !text.trim() || selectedIds.length === 0}
            >
              <Icon name="send" size={15} color="white" />
              {sending ? 'Sender…' : 'Send besked'}
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Sendte beskeder</span>
            <span className="text-muted" style={{ fontSize: 12 }}>{messages.length} i alt</span>
          </div>
          {msgLoading ? (
            <div className="loading-dots"><span/><span/><span/></div>
          ) : messages.length === 0 ? (
            <EmptyState icon="message" text="Ingen beskeder sendt endnu" />
          ) : (
            <div>
              {messages.map(m => (
                <div key={m.id} className="msg-item">
                  <div className="msg-meta">
                    <span className="msg-author">{m.authorName}</span>
                    <span className="msg-time">{formatDate(m.createdAt)}</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 'auto', color: '#dc3545', padding: '2px 6px' }}
                      onClick={async () => {
                        if (window.confirm('Slet denne besked?')) {
                          await deleteDoc(doc(db, 'messages', m.id))
                        }
                      }}
                    >
                      <Icon name="trash" size={13} color="#dc3545" />
                    </button>
                  </div>
                  <p className="msg-text">{m.text}</p>
                  <div className="msg-holds">
                    {(m.targetHolds ?? []).map((h, i) => (
                      <HoldPill
                        key={typeof h === 'object' ? (h.conventus_id ?? i) : h}
                        holdId={h}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── ImageUploader ────────────────────────────────────────────────────────────

function ImageUploader({ value, onChange }) {
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(null) // null | 0-100
  const [error, setError]       = useState('')
  const inputRef                = useRef(null)

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) { setError('Kun billedfiler tilladt'); return }
    if (file.size > 8 * 1024 * 1024)              { setError('Maks 8 MB'); return }
    setError(''); setProgress(0)

    const path   = `news-images/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`
    const sRef   = storageRef(storage, path)
    const upload = uploadBytesResumable(sRef, file)

    upload.on('state_changed',
      snap  => setProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      err   => { setError('Upload fejlede: ' + err.message); setProgress(null) },
      ()    => getDownloadURL(upload.snapshot.ref).then(url => { onChange(url); setProgress(null) })
    )
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius: 8,
          padding: '18px 12px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'var(--primary-soft, #e8f5e9)' : 'var(--bg)',
          transition: 'border-color .15s, background .15s',
        }}
      >
        <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
               onChange={e => handleFile(e.target.files[0])} />
        {progress !== null ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>Uploader… {progress}%</div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: progress + '%', background: 'var(--primary, #1a5c2a)', transition: 'width .2s' }} />
            </div>
          </div>
        ) : value ? (
          <div>
            <img src={value} alt="" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 6, objectFit: 'cover', display: 'block', margin: '0 auto 8px' }} />
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Klik eller træk for at skifte billede</span>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text2)', pointerEvents: 'none' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🖼</div>
            Træk et billede hertil eller <span style={{ color: 'var(--primary, #1a5c2a)', fontWeight: 600 }}>vælg fil</span>
          </div>
        )}
      </div>
      {error && <p style={{ fontSize: 12, color: '#dc3545', marginTop: 4 }}>{error}</p>}
      {value && !progress && (
        <button type="button" style={{ fontSize: 12, color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0 }}
                onClick={e => { e.stopPropagation(); onChange('') }}>
          Fjern billede
        </button>
      )}
    </div>
  )
}

// ─── News ─────────────────────────────────────────────────────────────────────

const EMPTY_ARTICLE = {
  title: '', category: 'Klubnyt', categoryColor: '#5856d6',
  excerpt: '', body: '', imageUrl: '',
}

function NewsPage({ userDoc, authUser }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null)  // null | 'new' | article object
  const [form, setForm]         = useState(EMPTY_ARTICLE)
  const [saving, setSaving]     = useState(false)
  const [toDelete, setToDelete] = useState(null)

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(100)),
      snap => {
        setArticles(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      }
    )
  }, [])

  function startNew() {
    setForm(EMPTY_ARTICLE)
    setEditing('new')
  }

  function startEdit(article) {
    setForm({
      title:         article.title         ?? '',
      category:      article.category      ?? 'Klubnyt',
      categoryColor: article.categoryColor ?? '#5856d6',
      excerpt:       article.excerpt       ?? '',
      body:          article.body          ?? '',
      imageUrl:      article.imageUrl      ?? '',
    })
    setEditing(article)
  }

  function setField(key, value) {
    setForm(f => {
      const next = { ...f, [key]: value }
      if (key === 'category') {
        next.categoryColor = NEWS_CATEGORIES.find(c => c.value === value)?.color ?? '#1a5c2a'
      }
      return next
    })
  }

  async function save(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      if (editing === 'new') {
        await addDoc(collection(db, 'news'), {
          ...form,
          authorUid: authUser.uid,
          authorName: userDoc?.displayName || authUser.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      } else {
        await updateDoc(doc(db, 'news', editing.id), {
          ...form,
          updatedAt: serverTimestamp(),
        })
      }
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    await deleteDoc(doc(db, 'news', toDelete.id))
    setToDelete(null)
  }

  if (editing) {
    return (
      <>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>← Tilbage</button>
            <h1 className="page-title">{editing === 'new' ? 'Ny nyhed' : 'Rediger nyhed'}</h1>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
          <form onSubmit={save}>
            <div className="card card-pad">
              <div className="form-group">
                <label className="form-label">Overskrift *</label>
                <input className="form-control" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="Skriv overskrift…" required autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Ingress (kort tekst)</label>
                <textarea className="form-control" value={form.excerpt} onChange={e => setField('excerpt', e.target.value)} placeholder="Kort beskrivelse der vises i listen…" rows={3} />
                <p className="form-hint">Vises i nyhedslisten i appen (~120 tegn anbefalet)</p>
              </div>
              <div className="form-group">
                <label className="form-label">Artiklens tekst *</label>
                <textarea className="form-control" style={{ minHeight: 240 }} value={form.body} onChange={e => setField('body', e.target.value)} placeholder="Skriv artiklens fulde tekst her…" required />
                <p className="form-hint">Adskil afsnit med en tom linje</p>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Annuller</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Gemmer…' : editing === 'new' ? 'Udgiv nyhed' : 'Gem ændringer'}
                </button>
              </div>
            </div>
          </form>

          <div className="card card-pad">
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Indstillinger</h3>
            <div className="form-group">
              <label className="form-label">Kategori</label>
              <select className="form-control" value={form.category} onChange={e => setField('category', e.target.value)}>
                {NEWS_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.value}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Billede (valgfrit)</label>
              <ImageUploader
                value={form.imageUrl}
                onChange={url => setField('imageUrl', url)}
              />
            </div>
            <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>FORHÅNDSVISNING</div>
              <CategoryPill label={form.category} color={form.categoryColor} />
              <p style={{ marginTop: 6, fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: 'var(--text)' }}>
                {form.title || 'Overskrift…'}
              </p>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Nyheder</h1>
        <button className="btn btn-primary" onClick={startNew}>
          <Icon name="plus" size={15} color="white" />
          Ny nyhed
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-dots"><span/><span/><span/></div>
        ) : articles.length === 0 ? (
          <EmptyState icon="news" text="Ingen nyheder endnu – klik 'Ny nyhed' for at starte" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Overskrift</th>
                  <th>Kategori</th>
                  <th>Forfatter</th>
                  <th>Oprettet</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {articles.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                      {a.excerpt && (
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                          {a.excerpt.slice(0, 80)}{a.excerpt.length > 80 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td><CategoryPill label={a.category} color={a.categoryColor || '#1a5c2a'} /></td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{a.authorName || '–'}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(a.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEdit(a)}>
                          <Icon name="edit" size={13} />
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#dc3545' }} onClick={() => setToDelete(a)}>
                          <Icon name="trash" size={13} color="#dc3545" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Slet nyhed"
          body={`Er du sikker på, at du vil slette "${toDelete.title}"? Handlingen kan ikke fortrydes.`}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}

// ─── Teams ────────────────────────────────────────────────────────────────────

/**
 * Firestore-struktur for holds/{conventus_id}:
 *   conventus_id, titel, aktivitet_titel, periode_fra, periode_til, afdeling_id,
 *   aktiv (bool), traener_uid, traeningstider, beskrivelse, sidst_synkroniseret
 *
 * Firestore-struktur for afdelinger/{id}:
 *   sidst_hentet (Timestamp)
 */
function TeamsPage({ userDoc, authUser }) {
  const [holds,         setHolds]         = useState([])
  const [afdelinger,    setAfdelinger]     = useState([])  // [{id, sidst_hentet}]
  const [users,         setUsers]          = useState([])
  const [loading,       setLoading]        = useState(true)
  const [afdelingInput, setAfdelingInput]  = useState('')
  const [fetchingAfd,   setFetchingAfd]    = useState(null) // afdeling-id der hentes
  const [fetchResults,  setFetchResults]   = useState({})   // {id: {added,updated,total}|{error}}
  const [saving,        setSaving]         = useState(null)
  const [expanded,      setExpanded]       = useState(null)
  const [editForm,      setEditForm]       = useState({ traeningstider: '', traener_uid: '' })
  const [openGroups,    setOpenGroups]     = useState(new Set()) // åbne gruppe-navne i Øvrige hold

  function loadHolds() {
    setLoading(true)
    getDocs(collection(db, 'holds'))
      .then(snap => {
        const all = snap.docs.map(d => ({ _docId: d.id, ...d.data() }))
        if (userDoc?.role !== 'admin' && userDoc?.holds?.length) {
          const mine = new Set(userDoc.holds.map(String))
          setHolds(all.filter(h => mine.has(String(h.conventus_id))))
        } else {
          setHolds(all)
        }
      })
      .finally(() => setLoading(false))
  }

  function loadAfdelinger() {
    getDocs(collection(db, 'afdelinger')).then(snap => {
      setAfdelinger(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
                 .sort((a, b) => Number(a.id) - Number(b.id))
      )
    })
  }

  useEffect(() => {
    loadHolds()
    loadAfdelinger()
    getDocs(collection(db, 'users')).then(snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [])

  async function fetchAfdeling(id) {
    const afdId = String(id).trim()
    if (!afdId || !/^\d+$/.test(afdId)) return
    setFetchingAfd(afdId)
    setFetchResults(r => ({ ...r, [afdId]: null }))
    try {
      const res = await fetch(`${BASE}api/conventus.php?endpoint=afdeling&id=${encodeURIComponent(afdId)}`)
      if (!res.ok) throw new Error(`Serverfejl HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const conventusHolds = data.holds ?? []
      if (conventusHolds.length === 0) throw new Error('Ingen hold fundet for afdeling ' + afdId + ' – tjek at ID er korrekt')

      const existingSnap = await getDocs(collection(db, 'holds'))
      const existingMap = {}
      existingSnap.docs.forEach(d => { existingMap[String(d.data().conventus_id)] = d.ref })

      let added = 0, updated = 0
      for (const ch of conventusHolds) {
        const docId = String(ch.conventus_id)
        const fields = {
          conventus_id:        ch.conventus_id,
          titel:               ch.titel,
          aktivitet_titel:     ch.aktivitet_titel || '',
          periode_fra:         ch.periode_fra     || '',
          periode_til:         ch.periode_til     || '',
          beskrivelse:         ch.beskrivelse     || '',
          afdeling_id:         afdId,
          sidst_synkroniseret: serverTimestamp(),
        }
        if (existingMap[docId]) {
          await updateDoc(existingMap[docId], fields); updated++
        } else {
          await setDoc(doc(db, 'holds', docId), { ...fields, aktiv: false, traener_uid: '', traeningstider: '' }); added++
        }
      }

      await setDoc(doc(db, 'afdelinger', afdId), { sidst_hentet: serverTimestamp() }, { merge: true })
      setAfdelinger(prev => {
        const rest = prev.filter(a => a.id !== afdId)
        return [...rest, { id: afdId, sidst_hentet: new Date() }].sort((a, b) => Number(a.id) - Number(b.id))
      })
      setFetchResults(r => ({ ...r, [afdId]: { added, updated, total: conventusHolds.length } }))
      setAfdelingInput('')
      loadHolds()
    } catch (e) {
      setFetchResults(r => ({ ...r, [afdId]: { error: e.message } }))
    } finally {
      setFetchingAfd(null)
    }
  }

  async function toggleAktiv(hold) {
    setSaving(hold.conventus_id + '-aktiv')
    const next = !hold.aktiv
    await updateDoc(doc(db, 'holds', String(hold.conventus_id)), { aktiv: next })
    setHolds(prev => prev.map(h => h.conventus_id === hold.conventus_id ? { ...h, aktiv: next } : h))
    setSaving(null)
  }

  function openEdit(hold) {
    setEditForm({ traeningstider: hold.traeningstider ?? '', traener_uid: hold.traener_uid ?? '' })
    setExpanded(hold.conventus_id)
  }

  async function saveEdit(hold) {
    const key = hold.conventus_id + '-edit'
    setSaving(key)
    await updateDoc(doc(db, 'holds', String(hold.conventus_id)), {
      traeningstider: editForm.traeningstider,
      traener_uid:    editForm.traener_uid,
      updatedAt:      serverTimestamp(),
      updatedBy:      authUser.uid,
    })
    setHolds(prev => prev.map(h =>
      h.conventus_id === hold.conventus_id
        ? { ...h, traeningstider: editForm.traeningstider, traener_uid: editForm.traener_uid }
        : h
    ))
    setSaving(null)
    setExpanded(null)
  }

  const trainerLabel = uid => {
    const u = users.find(u => u.id === uid)
    return u ? (u.displayName || u.email) : uid
  }

  function HoldTable({ holdList }) {
    const sorted = [...holdList].sort(
      (a, b) => (a.aktivitet_titel || '').localeCompare(b.aktivitet_titel || '', 'da')
             || (a.titel || '').localeCompare(b.titel || '', 'da')
    )
    return (
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Holdnavn</th>
                <th>Periode</th>
                <th style={{ textAlign: 'center', width: 90 }}>Aktiv i app</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(hold => {
                const isExp = expanded === hold.conventus_id
                return (
                  <Fragment key={hold.conventus_id}>
                    <tr style={{ background: isExp ? 'var(--bg)' : undefined }}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{hold.titel}</span>
                        {hold.aktivitet_titel && (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)' }}>
                            {hold.aktivitet_titel}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                        {hold.periode_fra && hold.periode_til ? `${hold.periode_fra} – ${hold.periode_til}` : '–'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={hold.aktiv ?? false}
                          disabled={saving === hold.conventus_id + '-aktiv'}
                          onChange={() => toggleAktiv(hold)}
                          style={{ accentColor: 'var(--green)', width: 16, height: 16, cursor: 'pointer' }}
                        />
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => isExp ? setExpanded(null) : openEdit(hold)}>
                          <Icon name="edit" size={12} />
                          {isExp ? 'Luk' : 'Redigér'}
                        </button>
                      </td>
                    </tr>
                    {isExp && (
                      <tr>
                        <td colSpan={4} style={{ padding: '14px 16px', background: 'var(--bg)', borderBottom: '2px solid var(--green)' }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 220px' }}>
                              <label className="form-label">Træningstider</label>
                              <input className="form-control" value={editForm.traeningstider}
                                onChange={e => setEditForm(f => ({ ...f, traeningstider: e.target.value }))}
                                placeholder="fx Mandag 16:00–17:30, Torsdag 17:00–18:30" />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
                              <label className="form-label">Tilknyt træner</label>
                              <select className="form-control" value={editForm.traener_uid}
                                onChange={e => setEditForm(f => ({ ...f, traener_uid: e.target.value }))}>
                                <option value="">– ingen –</option>
                                {users.map(u => (
                                  <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button className="btn btn-primary btn-sm"
                                disabled={saving === hold.conventus_id + '-edit'}
                                onClick={() => saveEdit(hold)}>
                                {saving === hold.conventus_id + '-edit' ? 'Gemmer…' : 'Gem'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(null)}>Annuller</button>
                            </div>
                          </div>
                          {hold.beskrivelse && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>
                              <strong>Conventus:</strong> {hold.beskrivelse}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const orphanHolds = holds.filter(h => !h.afdeling_id)

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Hold</h1>
      </div>

      {/* ── Tilføj afdeling ── */}
      <div className="card card-pad" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Hent hold fra Conventus-afdeling</h3>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          Indtast afdelings-ID fra Conventus (Indstillinger → Afdelinger) for at importere alle hold i afdelingen.
          Allerede hentede afdelinger vises nedenfor og kan opdateres individuelt.
        </p>
        <form onSubmit={e => { e.preventDefault(); fetchAfdeling(afdelingInput) }}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="form-control"
            style={{ maxWidth: 220 }}
            type="text"
            inputMode="numeric"
            pattern="\d+"
            placeholder="Afdelings-ID (fx 4001)"
            value={afdelingInput}
            onChange={e => setAfdelingInput(e.target.value.replace(/\D/g, ''))}
            disabled={fetchingAfd !== null}
          />
          <button className="btn btn-primary" type="submit"
                  disabled={!afdelingInput.trim() || fetchingAfd !== null}>
            {fetchingAfd === afdelingInput.trim() ? 'Henter…' : 'Hent hold'}
          </button>
        </form>
        {fetchResults[afdelingInput.trim()]?.error && (
          <div className="alert-warn" style={{ marginTop: 10 }}>
            {fetchResults[afdelingInput.trim()].error}
          </div>
        )}
      </div>

      {/* ── Per-afdeling sektioner ── */}
      {loading ? (
        <div className="card"><div className="loading-dots"><span/><span/><span/></div></div>
      ) : afdelinger.length === 0 && orphanHolds.length === 0 ? (
        <EmptyState icon="users" text="Ingen hold importeret endnu — tilføj et afdelings-ID ovenfor" />
      ) : (
        <>
          {afdelinger.map(afd => {
            const afdHolds  = holds.filter(h => String(h.afdeling_id) === String(afd.id))
            const result    = fetchResults[afd.id]
            const aktivNavn = [...new Set(afdHolds.map(h => h.aktivitet_titel).filter(Boolean))].join(' · ')
            const activeCount = afdHolds.filter(h => h.aktiv).length

            return (
              <div key={afd.id} style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Afdeling {afd.id}</span>
                    {aktivNavn && <span style={{ fontSize: 13, color: 'var(--text2)' }}>{aktivNavn}</span>}
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {activeCount}/{afdHolds.length} aktive
                      {afd.sidst_hentet && ` · hentet ${formatDate(afd.sidst_hentet)}`}
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => fetchAfdeling(afd.id)}
                          disabled={fetchingAfd !== null}>
                    {fetchingAfd === String(afd.id) ? 'Henter…' : '↺ Opdatér'}
                  </button>
                </div>

                {result && !result.error && (
                  <div className="alert-info" style={{ marginBottom: 8 }}>
                    Opdateret: {result.added} nye · {result.updated} eksisterende · {result.total} i alt
                  </div>
                )}
                {result?.error && (
                  <div className="alert-warn" style={{ marginBottom: 8 }}>{result.error}</div>
                )}

                {afdHolds.length === 0
                  ? <div className="card card-pad" style={{ fontSize: 13, color: 'var(--text2)' }}>
                      Ingen hold — klik Opdatér for at synkronisere.
                    </div>
                  : <HoldTable holdList={afdHolds} />
                }
              </div>
            )
          })}

          {/* Hold importeret uden afdelings-ID — grupperet efter aktivitet_titel */}
          {orphanHolds.length > 0 && (() => {
            const byAktivitet = {}
            orphanHolds.forEach(h => {
              const key = h.aktivitet_titel || 'Uden aktivitet'
              if (!byAktivitet[key]) byAktivitet[key] = []
              byAktivitet[key].push(h)
            })
            const groupNames = Object.keys(byAktivitet).sort((a, b) => a.localeCompare(b, 'da'))
            const toggleGroup = name => setOpenGroups(prev => {
              const next = new Set(prev)
              next.has(name) ? next.delete(name) : next.add(name)
              return next
            })
            return (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                             letterSpacing: '.5px', color: 'var(--text2)', margin: '0 0 10px' }}>
                  Øvrige hold ({orphanHolds.length}) — ikke tilknyttet en afdeling
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {groupNames.map(name => {
                    const groupHolds = byAktivitet[name]
                    const isOpen     = openGroups.has(name)
                    const activeCount = groupHolds.filter(h => h.aktiv).length
                    return (
                      <div key={name} className="card">
                        <button
                          onClick={() => toggleGroup(name)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', padding: '12px 16px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
                            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                              {activeCount}/{groupHolds.length} aktive
                            </span>
                          </span>
                          <span style={{ fontSize: 13, color: 'var(--text2)', flexShrink: 0 }}>
                            {isOpen ? '▲' : '▼'}
                          </span>
                        </button>
                        {isOpen && (
                          <div style={{ borderTop: '1px solid var(--border)' }}>
                            <HoldTable holdList={groupHolds} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </>
      )}
    </>
  )
}

// ─── Events (Begivenheder) ────────────────────────────────────────────────────

const EVENT_TYPES = ['kamp', 'træning', 'stævne', 'arrangement']
const EMPTY_EVENT = { title: '', date: '', time: '', type: 'kamp', holdId: '', location: '', notes: '' }

function EventsPage({ userDoc, authUser }) {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [holds,   setHolds]   = useState([])
  const [editing, setEditing] = useState(null)   // null | 'new' | event obj
  const [form,    setForm]    = useState(EMPTY_EVENT)
  const [saving,  setSaving]  = useState(false)
  const [toDelete,setToDelete]= useState(null)

  useEffect(() => {
    fetch(`${BASE}holds.php`).then(r => r.json()).then(d => setHolds(d.groups || [])).catch(() => {})
  }, [])

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'events'), orderBy('date'), limit(200)),
      snap => { setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) }
    )
  }, [])

  const visibleHolds = userDoc?.role === 'admin'
    ? holds
    : holds.filter(h => (userDoc?.holds ?? []).includes(String(h.id)))

  function startNew()       { setForm(EMPTY_EVENT); setEditing('new') }
  function startEdit(ev)    { setForm({ title: ev.title ?? '', date: ev.date ?? '', time: ev.time ?? '', type: ev.type ?? 'kamp', holdId: String(ev.holdId ?? ''), location: ev.location ?? '', notes: ev.notes ?? '' }); setEditing(ev) }
  function setF(k, v)       { setForm(f => ({ ...f, [k]: v })) }

  async function save(e) {
    e.preventDefault()
    if (!form.title || !form.date) return
    setSaving(true)
    const hold = holds.find(h => String(h.id) === form.holdId) ?? {}
    const payload = {
      ...form,
      holdId:           form.holdId || null,
      holdName:         hold.name ?? '',
      activityTypeName: hold.activityTypeName ?? '',
      authorUid:        authUser.uid,
      authorName:       userDoc?.displayName || authUser.email,
      updatedAt:        serverTimestamp(),
    }
    try {
      if (editing === 'new') {
        await addDoc(collection(db, 'events'), { ...payload, createdAt: serverTimestamp() })
      } else {
        await updateDoc(doc(db, 'events', editing.id), payload)
      }
      setEditing(null)
    } finally { setSaving(false) }
  }

  async function confirmDelete() {
    if (!toDelete) return
    await deleteDoc(doc(db, 'events', toDelete.id))
    setToDelete(null)
  }

  const typeColor = { kamp: '#1a5c2a', træning: '#5856d6', stævne: '#ff9500', arrangement: '#ff3b30' }
  const today = new Date().toISOString().slice(0, 10)

  if (editing) return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>← Tilbage</button>
          <h1 className="page-title">{editing === 'new' ? 'Ny begivenhed' : 'Rediger begivenhed'}</h1>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="card card-pad" style={{ maxWidth: 560 }}>
          <div className="form-group">
            <label className="form-label">Titel *</label>
            <input className="form-control" value={form.title} onChange={e => setF('title', e.target.value)} placeholder="fx Kamp mod Ans IF" required autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Dato *</label>
              <input className="form-control" type="date" value={form.date} onChange={e => setF('date', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Tidspunkt</label>
              <input className="form-control" type="time" value={form.time} onChange={e => setF('time', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-control" value={form.type} onChange={e => setF('type', e.target.value)}>
                {EVENT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Hold</label>
              <select className="form-control" value={form.holdId} onChange={e => setF('holdId', e.target.value)}>
                <option value="">Alle / ikke angivet</option>
                {visibleHolds.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Sted</label>
            <input className="form-control" value={form.location} onChange={e => setF('location', e.target.value)} placeholder="fx SSIF Anlæget" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Noter</label>
            <textarea className="form-control" rows={2} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Valgfri ekstra info…" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Annuller</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Gemmer…' : editing === 'new' ? 'Opret' : 'Gem ændringer'}
            </button>
          </div>
        </div>
      </form>
    </>
  )

  const upcoming = events.filter(e => e.date >= today)
  const past     = events.filter(e => e.date <  today).reverse()

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Begivenheder</h1>
        <button className="btn btn-primary" onClick={startNew}>
          <Icon name="plus" size={15} color="white" /> Ny begivenhed
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        Begivenheder vises i membres apps kalender under "Familie"-fanen, filtreret på holdtilknytning.
      </p>

      {loading ? (
        <div className="card"><div className="loading-dots"><span/><span/><span/></div></div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <span className="card-header-title">Kommende ({upcoming.length})</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Dato</th><th>Tid</th><th>Type</th><th>Titel</th><th>Hold</th><th style={{width:90}}></th></tr></thead>
                  <tbody>
                    {upcoming.map(ev => (
                      <tr key={ev.id}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {new Date(ev.date + 'T12:00:00').toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </td>
                        <td style={{ color: 'var(--text2)', fontSize: 12 }}>{ev.time || '–'}</td>
                        <td>
                          <span className="badge" style={{ background: (typeColor[ev.type] || '#666') + '20', color: typeColor[ev.type] || '#666' }}>
                            {ev.type || '–'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{ev.title}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{ev.holdName || '–'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => startEdit(ev)}><Icon name="edit" size={12}/></button>
                            <button className="btn btn-ghost btn-sm" style={{ color: '#dc3545' }} onClick={() => setToDelete(ev)}><Icon name="trash" size={12} color="#dc3545"/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div className="card">
              <div className="card-header">
                <span className="card-header-title" style={{ color: 'var(--text2)' }}>Afholdte ({past.length})</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Dato</th><th>Type</th><th>Titel</th><th>Hold</th><th style={{width:90}}></th></tr></thead>
                  <tbody>
                    {past.slice(0, 20).map(ev => (
                      <tr key={ev.id} style={{ opacity: .65 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {new Date(ev.date + 'T12:00:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td><span className="badge badge-gray">{ev.type || '–'}</span></td>
                        <td>{ev.title}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{ev.holdName || '–'}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm" style={{ color: '#dc3545' }} onClick={() => setToDelete(ev)}><Icon name="trash" size={12} color="#dc3545"/></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {upcoming.length === 0 && past.length === 0 && (
            <EmptyState icon="calendar" text="Ingen begivenheder endnu – klik 'Ny begivenhed' for at starte" />
          )}
        </>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Slet begivenhed"
          body={`Slet "${toDelete.title}"? Handlingen kan ikke fortrydes.`}
          danger onConfirm={confirmDelete} onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}

// ─── Users ────────────────────────────────────────────────────────────────────

function UsersPage({ authUser }) {
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [availableHolds, setAvailableHolds] = useState([])
  const [inviteEmail, setInviteEmail]   = useState('')
  const [inviting, setInviting]         = useState(false)
  const [inviteSent, setInviteSent]     = useState(false)
  const [expandedId, setExpandedId]     = useState(null)
  const [saving, setSaving]             = useState(null)

  useEffect(() => {
    // Hent aktive hold fra Firestore til brug i hold-tildeling
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => setAvailableHolds(snap.docs.map(d => ({ _id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  async function saveRole(uid, role) {
    setSaving(uid + '-role')
    await updateDoc(doc(db, 'users', uid), { role })
    setUsers(us => us.map(u => u.id === uid ? { ...u, role } : u))
    setSaving(null)
  }

  async function saveHolds(uid, holds) {
    setSaving(uid + '-holds')
    await updateDoc(doc(db, 'users', uid), { holds })
    setUsers(us => us.map(u => u.id === uid ? { ...u, holds } : u))
    setSaving(null)
    setExpandedId(null)
  }

  async function sendInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await sendSignInLinkToEmail(auth, inviteEmail.trim(), {
        url: window.location.href,
        handleCodeInApp: true,
      })
      setInviteSent(true)
      setInviteEmail('')
      setTimeout(() => setInviteSent(false), 4000)
    } finally {
      setInviting(false)
    }
  }

  function HoldsEditor({ user }) {
    // selected = array af conventus_id-strings
    const [selected, setSelected] = useState((user.holds ?? []).map(String))
    function toggle(id) {
      const s = String(id)
      setSelected(prev => prev.includes(s) ? prev.filter(h => h !== s) : [...prev, s])
    }
    const byType = availableHolds.reduce((acc, h) => {
      const t = h.aktivitet_titel || 'Hold'
      if (!acc[t]) acc[t] = []
      acc[t].push(h)
      return acc
    }, {})
    return (
      <td colSpan={5} style={{ padding: '14px 16px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 13 }}>Hold for {user.displayName}</div>
        {availableHolds.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
            Ingen aktive hold — synkronisér hold under Hold-siden.
          </p>
        ) : (
          Object.entries(byType).map(([type, typeHolds]) => (
            <div key={type} style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                           color: 'var(--text2)', marginBottom: 5 }}>{type}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
                {typeHolds.map(h => {
                  const id = String(h.conventus_id)
                  return (
                    <label key={id} className={`hold-check-label ${selected.includes(id) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(h.conventus_id)} />
                      {h.titel}
                    </label>
                  )
                })}
              </div>
            </div>
          ))
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={saving === user.id + '-holds'}
                  onClick={() => saveHolds(user.id, selected)}>
            {saving === user.id + '-holds' ? 'Gemmer…' : 'Gem hold'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setExpandedId(null)}>Annuller</button>
        </div>
      </td>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Brugere</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <div className="card">
          {loading ? (
            <div className="loading-dots"><span/><span/><span/></div>
          ) : users.length === 0 ? (
            <EmptyState icon="person" text="Ingen brugere endnu" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bruger</th>
                    <th>Rolle</th>
                    <th>Tildelte hold</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <>
                      <tr key={u.id} style={{ background: expandedId === u.id ? 'var(--bg)' : undefined }}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.displayName}</div>
                          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{u.email}</div>
                        </td>
                        <td>
                          <select
                            className="role-select"
                            value={u.role || ''}
                            disabled={u.id === authUser.uid || saving === u.id + '-role'}
                            onChange={e => saveRole(u.id, e.target.value)}
                          >
                            <option value="">– ingen –</option>
                            <option value="trainer">Træner</option>
                            <option value="admin">Admin</option>
                          </select>
                          {u.id === authUser.uid && (
                            <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>(dig selv)</span>
                          )}
                        </td>
                        <td>
                          {u.role === 'admin' ? (
                            <span className="badge badge-green">Alle hold</span>
                          ) : (u.holds ?? []).length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {(u.holds ?? []).map(h => {
                                const found = availableHolds.find(ah => String(ah.conventus_id) === String(h))
                                return <HoldPill key={h} holdId={h} name={found?.titel} />
                              })}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Ingen tildelt</span>
                          )}
                        </td>
                        <td>
                          {u.role === 'trainer' && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                            >
                              {expandedId === u.id ? 'Luk' : 'Hold'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === u.id && (
                        <tr key={u.id + '-exp'}>
                          <HoldsEditor user={u} />
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Inviter ny bruger</h3>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
            Brugeren modtager et magic link og kan logge ind med det samme.
          </p>
          {inviteSent && (
            <div className="alert-info" style={{ marginBottom: 12 }}>
              Invitation sendt!
            </div>
          )}
          <form onSubmit={sendInvite}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-control"
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="træner@email.dk"
                required
              />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', height: 38 }} disabled={inviting}>
              <Icon name="mail" size={14} color="white" />
              {inviting ? 'Sender…' : 'Send invitation'}
            </button>
          </form>
          <div className="alert-warn" style={{ marginTop: 16, marginBottom: 0 }}>
            Nye brugere får ingen rolle automatisk. Husk at tildele <strong>Træner</strong> eller <strong>Admin</strong>-rolle herover.
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

const DEMO_AUTH_USER = { uid: 'demo-uid', email: 'demo@ssif.dk', displayName: 'Demo Admin' }
const DEMO_USER_DOC  = { id: 'demo-uid', email: 'demo@ssif.dk', displayName: 'Demo Admin', role: 'admin', holds: [] }

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  messages:  'Beskeder',
  news:      'Nyheder',
  teams:     'Hold',
  events:    'Begivenheder',
  users:     'Brugere',
}

export default function AdminApp() {
  const [authUser, setAuthUser] = useState(undefined)
  const [userDoc, setUserDoc]   = useState(null)
  const [page, setPage]         = useState('dashboard')
  const isDemoMode              = useRef(false)

  function handleDemoLogin() {
    isDemoMode.current = true
    setAuthUser(DEMO_AUTH_USER)
    setUserDoc(DEMO_USER_DOC)
  }

  function handleLogout() {
    isDemoMode.current = false
    setAuthUser(null)
    setUserDoc(null)
    signOut(auth).catch(() => {})
  }

  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = localStorage.getItem('adminSignInEmail')
      if (!email) email = window.prompt('Bekræft din email-adresse for at logge ind:')
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(() => {
            localStorage.removeItem('adminSignInEmail')
            window.history.replaceState({}, '', window.location.pathname)
          })
          .catch(err => console.error('Magic link fejl:', err))
      }
    }
  }, [])

  useEffect(() => {
    return onAuthStateChanged(auth, async fbUser => {
      if (isDemoMode.current) return   // Demo-tilstand — ignorer Firebase events
      if (!fbUser) {
        setAuthUser(null)
        setUserDoc(null)
        return
      }
      setAuthUser(fbUser)
      const ref  = doc(db, 'users', fbUser.uid)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        setUserDoc({ id: snap.id, ...snap.data() })
      } else {
        const allSnap = await getDocs(query(collection(db, 'users'), limit(1)))
        const isFirst = allSnap.empty
        const newDoc = {
          email:       fbUser.email,
          displayName: fbUser.displayName || fbUser.email.split('@')[0],
          role:        isFirst ? 'admin' : null,
          holds:       [],
          createdAt:   serverTimestamp(),
        }
        await setDoc(ref, newDoc)
        setUserDoc({ id: fbUser.uid, ...newDoc })
      }
    })
  }, [])

  if (authUser === undefined) return <LoadingScreen />
  if (!authUser)              return <LoginPage onDemoLogin={handleDemoLogin} />
  if (!userDoc?.role)         return <UnauthorizedPage user={authUser} />

  function renderPage() {
    switch (page) {
      case 'dashboard': return <DashboardPage userDoc={userDoc} />
      case 'messages':  return <MessagesPage  userDoc={userDoc} authUser={authUser} />
      case 'news':      return <NewsPage       userDoc={userDoc} authUser={authUser} />
      case 'teams':     return <TeamsPage      userDoc={userDoc} authUser={authUser} />
      case 'events':    return <EventsPage     userDoc={userDoc} authUser={authUser} />
      case 'users':
        return userDoc.role === 'admin'
          ? <UsersPage authUser={authUser} />
          : <EmptyState icon="shield" text="Kun administratorer har adgang til brugerstyring" />
      default:          return null
    }
  }

  return (
    <div className="admin-shell">
      <Sidebar page={page} setPage={setPage} userDoc={userDoc} user={authUser} onLogout={handleLogout} />
      <div className="admin-main">
        <header className="admin-topbar">
          <span className="topbar-title">{PAGE_TITLES[page]}</span>
          <div className="topbar-right">
            <span>{userDoc?.email || authUser.email}</span>
            <span className={`badge ${userDoc.role === 'admin' ? 'badge-green' : 'badge-blue'}`}>
              {userDoc.role === 'admin' ? 'Administrator' : 'Træner'}
            </span>
          </div>
        </header>
        <main className="admin-content">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
