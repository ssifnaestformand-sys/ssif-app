import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { auth, db, storage } from '../firebase.js'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import {
  GoogleAuthProvider,
  signInWithPopup, signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut, onAuthStateChanged,
} from 'firebase/auth'
import {
  collection, query, where, orderBy, limit,
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
    search:   <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    eye:      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    sms:      <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="9" y2="10" strokeWidth={3}/><line x1="12" y1="10" x2="12" y2="10" strokeWidth={3}/><line x1="15" y1="10" x2="15" y2="10" strokeWidth={3}/></>,
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

const ADMIN_AUTH_ERRORS = {
  'auth/invalid-email':            'Ugyldig email-adresse.',
  'auth/user-not-found':           'Ingen bruger med denne email.',
  'auth/wrong-password':           'Forkert adgangskode.',
  'auth/invalid-credential':       'Forkert email eller adgangskode.',
  'auth/too-many-requests':        'For mange forsøg. Prøv igen senere.',
  'auth/popup-closed-by-user':     '',
  'auth/cancelled-popup-request':  '',
}

function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [mode,     setMode]     = useState('main') // 'main' | 'forgot'
  const [loading,  setLoading]  = useState(null)
  const [error,    setError]    = useState('')
  const [info,     setInfo]     = useState('')

  async function social(ProviderClass) {
    setLoading('social'); setError('')
    try {
      await signInWithPopup(auth, new ProviderClass())
    } catch (e) {
      const msg = ADMIN_AUTH_ERRORS[e.code]
      if (msg) setError(msg)
      else if (e.code && !e.code.includes('cancelled') && !e.code.includes('closed')) setError(e.message)
    } finally { setLoading(null) }
  }

  async function emailLogin(e) {
    e.preventDefault(); setLoading('email'); setError('')
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (e) {
      setError(ADMIN_AUTH_ERRORS[e.code] || 'Login fejlede.')
    } finally { setLoading(null) }
  }

  async function resetPassword(e) {
    e.preventDefault(); setLoading('reset'); setError('')
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setInfo('Nulstillingsmail sendt til ' + email.trim())
      setMode('main')
    } catch (e) {
      setError(ADMIN_AUTH_ERRORS[e.code] || 'Kunne ikke sende mail.')
    } finally { setLoading(null) }
  }

  return (
    <div className="admin-login">
      <div className="login-box">
        <div className="login-logo-admin"><span>SSIF</span></div>
        <h1 className="login-title">Backoffice</h1>
        <p className="login-sub">Sejs-Svejbæk IF · Administrationsportal</p>

        {info && <div className="alert-info" style={{ marginBottom: 16 }}>{info}</div>}
        {error && <p style={{ color: '#dc3545', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

        {mode === 'main' && (
          <>
            {/* Sociale knapper */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ width: '100%', height: 42, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: '1.5px solid var(--border)' }}
                onClick={() => social(GoogleAuthProvider)} disabled={loading === 'social'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Fortsæt med Google
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px', color: 'var(--text3)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              eller med email
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <form onSubmit={emailLogin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className="form-control" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@ssif.dk" required autoFocus />
              <input className="form-control" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Adgangskode" required />
              <button className="btn btn-primary" style={{ width: '100%', height: 42, fontSize: 14 }} disabled={loading === 'email'}>
                {loading === 'email' ? 'Logger ind…' : 'Log ind'}
              </button>
            </form>

            <button onClick={() => { setMode('forgot'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 13, cursor: 'pointer', marginTop: 12, width: '100%', textAlign: 'center' }}>
              Glemt adgangskode?
            </button>

          </>
        )}

        {mode === 'forgot' && (
          <form onSubmit={resetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>Indtast din email — vi sender et nulstillingslink.</p>
            <input className="form-control" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@ssif.dk" required autoFocus />
            <button className="btn btn-primary" style={{ width: '100%', height: 42, fontSize: 14 }} disabled={loading === 'reset'}>
              {loading === 'reset' ? 'Sender…' : 'Send nulstillingslink'}
            </button>
            <button type="button" onClick={() => { setMode('main'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>
              ← Tilbage til login
            </button>
          </form>
        )}

        <p style={{ marginTop: 16, fontSize: 11, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 }}>
          Kun brugere tildelt en rolle af en administrator kan logge ind.
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
    { id: 'events',  label: 'Begivenheder', icon: 'calendar' },
    { id: 'banners', label: 'Forsidebanners', icon: 'star'   },
    ...(userDoc?.role === 'admin' ? [
      { id: 'sms',      label: 'SMS',         icon: 'sms'    },
      { id: 'appusers', label: 'App-brugere', icon: 'eye'    },
      { id: 'users',    label: 'Adgang',      icon: 'shield' },
    ] : []),
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
    getDocs(query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(50)))
      .then(snap => { setNewsCount(snap.size); setRecentNews(snap.docs.slice(0, 5).map(d => ({ id: d.id, ...d.data() }))) })
      .catch(() => {})
    getDocs(query(collection(db, 'messages'), orderBy('oprettet', 'desc'), limit(50)))
      .then(snap => { setMsgCount(snap.size); setRecentMsgs(snap.docs.slice(0, 5).map(d => ({ id: d.id, ...d.data() }))) })
      .catch(() => {})
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
  const [selectedIds, setSelectedIds]       = useState([])
  const [messages, setMessages]             = useState([])
  const [msgLoading, setMsgLoading]         = useState(true)
  const [availableHolds, setAvailableHolds] = useState([])
  const [afdelinger, setAfdelinger]         = useState([])
  const [holdsLoading, setHoldsLoading]     = useState(true)
  const [holdSearch, setHoldSearch]         = useState('')
  const [openAfd, setOpenAfd]               = useState(new Set())

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'holds'), where('aktiv', '==', true))),
      getDocs(collection(db, 'afdelinger')),
    ]).then(([hSnap, aSnap]) => {
      let all = hSnap.docs.map(d => ({ _id: d.id, ...d.data() }))
      if (userDoc?.role !== 'admin' && userDoc?.holds?.length) {
        const mine = new Set(userDoc.holds.map(String))
        all = all.filter(h => mine.has(String(h.conventus_id)))
      }
      all.sort((a, b) =>
        (a.titel || '').localeCompare(b.titel || '', 'da')
      )
      setAvailableHolds(all)
      const afd = aSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.navn || a.id).localeCompare(b.navn || b.id, 'da'))
      setAfdelinger(afd)
    }).finally(() => setHoldsLoading(false))
  }, [])

  function loadMessages() {
    getDocs(query(collection(db, 'messages'), orderBy('oprettet', 'desc'), limit(100)))
      .then(snap => { setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setMsgLoading(false) })
      .catch(() => setMsgLoading(false))
  }
  useEffect(() => { loadMessages() }, [])

  function toggleId(conventusId) {
    const s = String(conventusId)
    setSelectedIds(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const [sendOk, setSendOk] = useState(false)

  function send(e) {
    e.preventDefault()
    if (!text.trim() || selectedIds.length === 0) return

    const msgText    = text.trim()
    const msgIds     = [...selectedIds]
    const authorName = userDoc?.displayName || authUser.email
    const selHolds   = availableHolds.filter(h => msgIds.includes(String(h.conventus_id)))

    if (!selHolds.length) return

    // Skriv til Firestore uden await — listen genindlæses med loadMessages() efter kort delay.
    selHolds.forEach(h => {
      addDoc(collection(db, 'messages'), {
        holdId:        String(h.conventus_id),
        holdNavn:      h.titel,
        afsenderNavn:  authorName,
        afsenderUid:   authUser.uid,
        tekst:         msgText,
        reaktioner:    { '👍': 0, '✅': 0, '❤️': 0 },
        userReactions: {},
        oprettet:      serverTimestamp(),
        createdAt:     serverTimestamp(),
      }).catch(err => console.error('Firestore write failed:', err))
    })

    // Nulstil UI øjeblikkeligt, genindlæs listen efter kort delay
    setText('')
    setSelectedIds([])
    setSendOk(true)
    setTimeout(() => setSendOk(false), 3000)
    setTimeout(() => loadMessages(), 1500)

    // Push-notifikation + email-notifikation fire-and-forget
    auth.currentUser?.getIdToken().then(idToken => {
      const holdNavnLabel = selHolds.map(h => h.titel).join(', ')

      const fd = new FormData()
      fd.append('idToken', idToken)
      fd.append('holdIds', JSON.stringify(msgIds))
      fd.append('text',    msgText)
      fd.append('title',   `Besked fra ${authorName}`)
      fetch(`${BASE}api/send-push.php`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
        body: fd,
      }).catch(() => {})

      fetch(`${BASE}api/send-message-email.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ holdIds: msgIds, senderName: authorName, text: msgText, holdNavn: holdNavnLabel }),
      }).catch(() => {})
    }).catch(() => {})
  }

  const toggleAfd = id => setOpenAfd(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  function toggleAllInAfd(holdList) {
    const ids = holdList.map(h => String(h.conventus_id))
    const allSelected = ids.every(id => selectedIds.includes(id))
    if (allSelected) setSelectedIds(prev => prev.filter(id => !ids.includes(id)))
    else setSelectedIds(prev => [...new Set([...prev, ...ids])])
  }

  const searchQ = holdSearch.trim().toLowerCase()
  const searchActive = searchQ.length > 0
  const filteredHolds = searchActive
    ? availableHolds.filter(h =>
        (h.titel || '').toLowerCase().includes(searchQ) ||
        (h.aktivitet_titel || '').toLowerCase().includes(searchQ)
      )
    : []

  // Grupper ikke-søgte holds efter afdeling
  const afdHoldMap = {}
  availableHolds.forEach(h => {
    const key = String(h.afdeling_id || '__ingen__')
    if (!afdHoldMap[key]) afdHoldMap[key] = []
    afdHoldMap[key].push(h)
  })
  const afdWithHolds = afdelinger.filter(a => (afdHoldMap[a.id] || []).length > 0)
  const orphans = afdHoldMap['__ingen__'] || []

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Beskeder</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '480px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Send ny besked</h3>
          <form onSubmit={send}>
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>Modtagere</label>
                {selectedIds.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
                      {selectedIds.length} hold valgt
                    </span>
                    <button type="button" onClick={() => setSelectedIds([])}
                      style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Ryd
                    </button>
                  </div>
                )}
              </div>

              {holdsLoading ? (
                <p className="form-hint">Henter hold…</p>
              ) : availableHolds.length === 0 ? (
                <p className="form-hint" style={{ color: '#92400e' }}>
                  Ingen aktive hold — aktivér hold under Hold-siden først.
                </p>
              ) : (
                <>
                  {/* Søgefelt */}
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}>
                      <Icon name="search" size={14} color="var(--text3)" />
                    </span>
                    <input className="form-control" value={holdSearch}
                      onChange={e => setHoldSearch(e.target.value)}
                      placeholder="Søg hold…"
                      style={{ paddingLeft: 30, paddingRight: holdSearch ? 30 : undefined, fontSize: 13 }} />
                    {holdSearch && (
                      <button type="button" onClick={() => setHoldSearch('')}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                        <Icon name="x" size={14} color="var(--text3)" />
                      </button>
                    )}
                  </div>

                  {/* Hold-liste: flad ved søgning, afdelingsgrupperet ellers */}
                  <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', maxHeight: 340, overflowY: 'auto' }}>
                    {searchActive ? (
                      filteredHolds.length === 0 ? (
                        <p style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text3)', margin: 0 }}>Ingen hold matcher "{holdSearch}"</p>
                      ) : filteredHolds.map((h, i) => {
                        const id = String(h.conventus_id)
                        const checked = selectedIds.includes(id)
                        return (
                          <div key={id}>
                            {i > 0 && <div style={{ height: 1, background: 'var(--border)' }} />}
                            <label className={`hold-check-label ${checked ? 'selected' : ''}`}
                                   style={{ gridColumn: 'unset', borderRadius: 0, margin: 0 }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleId(h.conventus_id)} />
                              <span>
                                {h.titel}
                                {h.aktivitet_titel && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>({h.aktivitet_titel})</span>}
                              </span>
                            </label>
                          </div>
                        )
                      })
                    ) : (
                      <>
                        {afdWithHolds.map(afd => {
                          const holds = afdHoldMap[afd.id] || []
                          const isOpen = openAfd.has(afd.id)
                          const afdIds = holds.map(h => String(h.conventus_id))
                          const allChk = afdIds.length > 0 && afdIds.every(id => selectedIds.includes(id))
                          const someChk = afdIds.some(id => selectedIds.includes(id))
                          return (
                            <div key={afd.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', background: 'var(--bg)', gap: 8 }}>
                                <input type="checkbox" checked={allChk} ref={el => { if (el) el.indeterminate = someChk && !allChk }}
                                  onChange={() => toggleAllInAfd(holds)} style={{ flexShrink: 0 }} />
                                <button type="button" onClick={() => toggleAfd(afd.id)}
                                  style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{afd.navn || afd.id}</span>
                                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                                    {someChk ? `${afdIds.filter(id => selectedIds.includes(id)).length}/${holds.length} valgt` : holds.length + ' hold'}
                                    {' '}{isOpen ? '▲' : '▼'}
                                  </span>
                                </button>
                              </div>
                              {isOpen && holds.map((h, i) => {
                                const id = String(h.conventus_id)
                                const checked = selectedIds.includes(id)
                                return (
                                  <div key={id}>
                                    {<div style={{ height: 1, background: 'var(--border)', marginLeft: 36 }} />}
                                    <label className={`hold-check-label ${checked ? 'selected' : ''}`}
                                           style={{ gridColumn: 'unset', borderRadius: 0, margin: 0, paddingLeft: 28 }}>
                                      <input type="checkbox" checked={checked} onChange={() => toggleId(h.conventus_id)} />
                                      {h.titel}
                                    </label>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                        {orphans.length > 0 && (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', background: 'var(--bg)', gap: 8 }}>
                              <input type="checkbox"
                                checked={orphans.map(h => String(h.conventus_id)).every(id => selectedIds.includes(id))}
                                ref={el => { if (el) el.indeterminate = orphans.some(h => selectedIds.includes(String(h.conventus_id))) && !orphans.every(h => selectedIds.includes(String(h.conventus_id))) }}
                                onChange={() => toggleAllInAfd(orphans)} />
                              <button type="button" onClick={() => toggleAfd('__ingen__')}
                                style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Øvrige hold</span>
                                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{openAfd.has('__ingen__') ? '▲' : '▼'}</span>
                              </button>
                            </div>
                            {openAfd.has('__ingen__') && orphans.map(h => {
                              const id = String(h.conventus_id)
                              const checked = selectedIds.includes(id)
                              return (
                                <div key={id}>
                                  <div style={{ height: 1, background: 'var(--border)', marginLeft: 36 }} />
                                  <label className={`hold-check-label ${checked ? 'selected' : ''}`}
                                         style={{ gridColumn: 'unset', borderRadius: 0, margin: 0, paddingLeft: 28 }}>
                                    <input type="checkbox" checked={checked} onChange={() => toggleId(h.conventus_id)} />
                                    {h.titel}
                                  </label>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {selectedIds.length === 0 && <p className="form-hint" style={{ marginTop: 6 }}>Vælg mindst ét hold</p>}
                </>
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
            {sendOk && (
              <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
                ✓ Besked sendt!
              </p>
            )}
            <button
              className="btn btn-primary"
              style={{ width: '100%', height: 40 }}
              disabled={!text.trim() || selectedIds.length === 0}
            >
              <Icon name="send" size={15} color="white" />
              Send besked
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
                    <span className="msg-author">{m.afsenderNavn || m.authorName}</span>
                    <span className="msg-time">{formatDate(m.oprettet || m.createdAt)}</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 'auto', color: '#dc3545', padding: '2px 6px' }}
                      onClick={async () => {
                        if (window.confirm('Slet denne besked?')) {
                          await deleteDoc(doc(db, 'messages', m.id))
                          loadMessages()
                        }
                      }}
                    >
                      <Icon name="trash" size={13} color="#dc3545" />
                    </button>
                  </div>
                  <p className="msg-text">{m.tekst || m.text}</p>
                  <div className="msg-holds">
                    {m.holdNavn ? (
                      <span className="badge badge-green">{m.holdNavn}</span>
                    ) : (m.targetHolds ?? []).map((h, i) => (
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

// aspectRatio: CSS aspect-ratio streng, fx '3/1' for banners, 'auto' for nyheder
// hint: vejledende tekst under uploadzonen
function ImageUploader({ value, onChange, aspectRatio = 'auto', hint = '' }) {
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(null) // null | 0-100
  const [error, setError]       = useState('')
  const inputRef                = useRef(null)

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) { setError('Kun billedfiler tilladt'); return }
    if (file.size > 10 * 1024 * 1024)             { setError('Maks 10 MB'); return }
    setError(''); setProgress(1)

    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const fd = new FormData()
      fd.append('image',   file)
      fd.append('idToken', idToken)

      // XMLHttpRequest giver os progress-events som fetch ikke gør
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', 'https://app.sejssvejbaek-if.dk/api/upload-image.php')
        xhr.setRequestHeader('Authorization', `Bearer ${idToken}`)

        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100))
        }

        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText)
              if (data.url) { onChange(data.url); setProgress(null); resolve() }
              else reject(new Error(data.error || 'Ukendt fejl'))
            } catch { reject(new Error('Ugyldigt svar fra serveren')) }
          } else {
            try { reject(new Error(JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`)) }
            catch { reject(new Error(`HTTP ${xhr.status}`)) }
          }
        }
        xhr.onerror   = () => reject(new Error('Netværksfejl — tjek forbindelsen'))
        xhr.ontimeout = () => reject(new Error('Timeout — prøv igen'))
        xhr.timeout   = 60000
        xhr.send(fd)
      })
    } catch (err) {
      setError('Upload fejlede: ' + err.message)
      setProgress(null)
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const isBanner = aspectRatio !== 'auto'

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
          cursor: 'pointer',
          background: dragging ? 'var(--primary-soft, #e8f5e9)' : 'var(--bg)',
          transition: 'border-color .15s, background .15s',
          overflow: 'hidden',
          // Fastlås proportioner for banner-upload
          ...(isBanner ? { aspectRatio, position: 'relative' } : { padding: '18px 12px', textAlign: 'center' }),
        }}
      >
        <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
               onChange={e => handleFile(e.target.files[0])} />

        {progress !== null ? (
          <div style={isBanner ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 } : {}}>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>Uploader… {progress}%</div>
            <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: progress + '%', background: 'var(--primary, #1a5c2a)', transition: 'width .2s' }} />
            </div>
          </div>
        ) : value ? (
          <div style={isBanner ? { position: 'absolute', inset: 0 } : {}}>
            <img src={value} alt=""
              style={isBanner
                ? { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
                : { maxWidth: '100%', maxHeight: 160, borderRadius: 6, objectFit: 'cover', display: 'block', margin: '0 auto 8px' }}
            />
            {isBanner && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)', opacity: 0 }}
                   onMouseEnter={e => e.currentTarget.style.opacity = 1}
                   onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>Klik for at skifte billede</span>
              </div>
            )}
            {!isBanner && <span style={{ fontSize: 12, color: 'var(--text2)' }}>Klik eller træk for at skifte billede</span>}
          </div>
        ) : (
          <div style={isBanner
            ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }
            : { fontSize: 13, color: 'var(--text2)', pointerEvents: 'none' }}>
            <div style={{ fontSize: isBanner ? 32 : 24, marginBottom: isBanner ? 0 : 6 }}>🖼</div>
            <span style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: '0 16px' }}>
              Træk et billede hertil eller{' '}
              <span style={{ color: 'var(--primary, #1a5c2a)', fontWeight: 600 }}>vælg fil</span>
            </span>
            {isBanner && (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                Anbefalet: 1200 × 400 px · maks 8 MB
              </span>
            )}
          </div>
        )}
      </div>

      {hint && !value && <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{hint}</p>}
      {error && <p style={{ fontSize: 12, color: '#dc3545', marginTop: 5, whiteSpace: 'pre-wrap' }}>{error}</p>}
      {value && progress === null && (
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

  function loadArticles() {
    getDocs(query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(100)))
      .then(snap => { setArticles(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { loadArticles() }, [])

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
        // Push-notifikation til alle brugere (holdIds=[] → alle)
        auth.currentUser?.getIdToken().then(idToken => {
          const fd = new FormData()
          fd.append('idToken', idToken)
          fd.append('holdIds', '[]')
          fd.append('title',   `Nyhed: ${form.title}`)
          fd.append('text',    form.excerpt?.slice(0, 120) || form.title)
          fetch(`${BASE}api/send-push.php`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
            body: fd,
          }).catch(() => {})
        }).catch(() => {})
      } else {
        await updateDoc(doc(db, 'news', editing.id), {
          ...form,
          updatedAt: serverTimestamp(),
        })
      }
      setEditing(null)
      loadArticles()
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    await deleteDoc(doc(db, 'news', toDelete.id))
    setToDelete(null)
    loadArticles()
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

// HoldTable og AfdSection er bevidst defineret UDEN FOR TeamsPage.
// Komponenter defineret inde i en parent-komponent får ny identitet ved hvert
// re-render, hvilket får React til at unmounte/remounte dem — inputfelter
// mister fokus efter hvert tastanslag.

function HoldTable({ holdList, expanded, saving, editForm, users,
                     onToggleAktiv, onOpenEdit, onCloseEdit, onEditFormChange, onSaveEdit }) {
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
                      <button
                        type="button"
                        onClick={() => onToggleAktiv(hold)}
                        disabled={saving === hold.conventus_id + '-aktiv'}
                        aria-label={hold.aktiv ? 'Deaktivér' : 'Aktivér'}
                        style={{
                          width: 36, height: 20, borderRadius: 10, padding: 2,
                          border: 'none', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center',
                          background: hold.aktiv ? '#1a5c2a' : '#d1d5db',
                          transition: 'background .2s',
                          opacity: saving === hold.conventus_id + '-aktiv' ? .5 : 1,
                        }}
                      >
                        <span style={{
                          width: 16, height: 16, borderRadius: '50%',
                          background: 'white', display: 'block',
                          transform: hold.aktiv ? 'translateX(16px)' : 'translateX(0)',
                          transition: 'transform .2s',
                          boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                        }} />
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => isExp ? onCloseEdit() : onOpenEdit(hold)}>
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
                            <input className="form-control"
                              value={editForm.traeningstider}
                              onChange={e => onEditFormChange('traeningstider', e.target.value)}
                              placeholder="fx Mandag 16:00–17:30, Torsdag 17:00–18:30" />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
                            <label className="form-label">Tilknyt træner</label>
                            <select className="form-control"
                              value={editForm.traener_uid}
                              onChange={e => onEditFormChange('traener_uid', e.target.value)}>
                              <option value="">– ingen –</option>
                              {users.map(u => (
                                <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary btn-sm"
                              disabled={saving === hold.conventus_id + '-edit'}
                              onClick={() => onSaveEdit(hold)}>
                              {saving === hold.conventus_id + '-edit' ? 'Gemmer…' : 'Gem'}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={onCloseEdit}>Annuller</button>
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

function AfdSection({ id, label, holdList, isOpen, onToggle, tableProps }) {
  const activeCount = holdList.filter(h => h.aktiv).length
  return (
    <div className="card">
      <button
        onClick={() => onToggle(id)}
        style={{ width: '100%', display: 'flex', alignItems: 'center',
                 justifyContent: 'space-between', padding: '12px 16px',
                 background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
            {holdList.length > 0 ? `${activeCount}/${holdList.length} aktive` : '–'}
          </span>
        </span>
        <span style={{ fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </button>
      {isOpen && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {holdList.length > 0
            ? <HoldTable holdList={holdList} {...tableProps} />
            : <p style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text2)', margin: 0 }}>
                Ingen hold importeret endnu
              </p>
          }
        </div>
      )}
    </div>
  )
}

/**
 * Firestore-struktur for holds/{conventus_id}:
 *   conventus_id, titel, aktivitet_titel, periode_fra, periode_til, afdeling_id,
 *   aktiv (bool), traener_uid, traeningstider, beskrivelse, sidst_synkroniseret
 *
 * Firestore-struktur for afdelinger/{id}:
 *   sidst_hentet (Timestamp)
 */
function TeamsPage({ userDoc, authUser }) {
  const [holds,         setHolds]        = useState([])
  const [afdelinger,    setAfdelinger]   = useState(null) // null=loading — fra Firestore
  const [users,         setUsers]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [saving,        setSaving]       = useState(null)
  const [expanded,      setExpanded]     = useState(null)
  const [editForm,      setEditForm]     = useState({ traeningstider: '', traener_uid: '' })
  const [openAfd,       setOpenAfd]      = useState(new Set())
  const [search,        setSearch]       = useState('')
  const [syncing,       setSyncing]      = useState(null)   // null | 'holds' | 'members' | 'all'
  const [syncResult,    setSyncResult]   = useState(null)   // {ok, msg, ts}

  async function triggerSync(what) {
    setSyncing(what); setSyncResult(null)
    try {
      const idToken = await auth.currentUser.getIdToken()
      const fd = new FormData()
      fd.append('what',    what)
      fd.append('idToken', idToken)   // fallback: Apache stripper Authorization-headeren
      const res  = await fetch('https://app.sejssvejbaek-if.dk/api/admin-sync.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) { setSyncResult({ ok: false, msg: data.error || 'Fejl' }); return }
      const r = data.results || {}
      const parts = []
      if (r.holds)   parts.push(`Hold: ${r.holds.written ?? '?'} skrevet`)
      if (r.members) parts.push('Medlemmer: kører i baggrunden')
      setSyncResult({ ok: true, msg: parts.join(' · ') || 'Synkronisering gennemført', ts: data.synced })
      // Genindlæs holds efter holds-sync
      if (what === 'holds' || what === 'all') { setTimeout(loadHolds, 2000) }
    } catch (err) {
      setSyncResult({ ok: false, msg: err.message })
    } finally { setSyncing(null) }
  }

  function loadHolds() {
    setLoading(true)
    getDocs(collection(db, 'holds'))
      .then(snap => setHolds(snap.docs.map(d => ({ _docId: d.id, ...d.data() }))))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadHolds()
    getDocs(collection(db, 'users')).then(snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    // Afdelinger hentes fra Firestore — populeres af sync-holds.php (daglig cron)
    getDocs(collection(db, 'afdelinger'))
      .then(snap => setAfdelinger(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
                 .sort((a, b) => (a.navn || a.id).localeCompare(b.navn || b.id, 'da'))
      ))
      .catch(() => setAfdelinger([]))
  }, [])

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

  function handleEditFormChange(field, value) {
    setEditForm(f => ({ ...f, [field]: value }))
  }

  // Props-objekt der sendes til HoldTable via AfdSection — stabil reference ikke nødvendig
  // her da HoldTable nu er top-level og React ikke remounter den ved prop-ændringer.
  const tableProps = {
    expanded, saving, editForm, users,
    onToggleAktiv: toggleAktiv,
    onOpenEdit:    openEdit,
    onCloseEdit:   () => setExpanded(null),
    onEditFormChange: handleEditFormChange,
    onSaveEdit:    saveEdit,
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

  const trainerLabel  = uid => { const u = users.find(u => u.id === uid); return u ? (u.displayName || u.email) : uid }
  const toggleOpenAfd = id  => setOpenAfd(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const isReady = !loading && afdelinger !== null

  const searchQ       = search.trim().toLowerCase()
  const searchActive  = searchQ.length > 0
  const filteredHolds = searchActive
    ? holds.filter(h =>
        (h.titel           || '').toLowerCase().includes(searchQ) ||
        (h.aktivitet_titel || '').toLowerCase().includes(searchQ)
      )
    : []

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Hold</h1>
        {userDoc?.role === 'admin' && auth.currentUser && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm"
              disabled={!!syncing}
              onClick={() => triggerSync('holds')}
              title="Henter hold og afdelinger fra Conventus (~500 skrivninger)">
              {syncing === 'holds' ? 'Henter…' : 'Synk. hold'}
            </button>
            <button className="btn btn-ghost btn-sm"
              disabled={!!syncing}
              onClick={() => triggerSync('all')}
              title="Henter hold + alle medlemmer (~3.400 skrivninger — brug sjældent)">
              {syncing === 'all' ? 'Synkroniserer…' : 'Synk. alt'}
            </button>
          </div>
        )}
      </div>

      {/* Sync-resultat */}
      {syncResult && (
        <div className={syncResult.ok ? 'alert-info' : 'alert-error'}
             style={{ marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{syncResult.msg}</span>
          <button onClick={() => setSyncResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', opacity: .5 }}>✕</button>
        </div>
      )}

      {/* Søgefelt */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{
          position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', display: 'flex',
        }}>
          <Icon name="search" size={16} color="var(--text3)" />
        </span>
        <input
          className="form-control"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søg holdnavn eller sport…"
          style={{ paddingLeft: 36, paddingRight: search ? 36 : undefined }}
          autoComplete="off"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              display: 'flex', color: 'var(--text3)',
            }}
          >
            <Icon name="x" size={16} color="var(--text3)" />
          </button>
        )}
      </div>

      {!isReady ? (
        <div className="card"><div className="loading-dots"><span/><span/><span/></div></div>
      ) : searchActive ? (
        filteredHolds.length === 0 ? (
          <EmptyState icon="users" text={`Ingen hold matcher "${search}"`} />
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              {filteredHolds.length} hold fundet
            </p>
            <HoldTable holdList={filteredHolds} {...tableProps} />
          </>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {afdelinger.length === 0 && holds.length === 0 && (
            <EmptyState icon="users" text="Ingen hold — data synkroniseres automatisk én gang i døgnet" />
          )}
          {afdelinger.map(afd => (
            <AfdSection
              key={afd.id}
              id={afd.id}
              label={afd.navn || afd.id}
              holdList={holds.filter(h => String(h.afdeling_id) === String(afd.id))}
              isOpen={openAfd.has(afd.id)}
              onToggle={toggleOpenAfd}
              tableProps={tableProps}
            />
          ))}
          {(() => {
            const afdIds  = new Set(afdelinger.map(a => String(a.id)))
            const orphans = holds.filter(h => !afdIds.has(String(h.afdeling_id)))
            if (!orphans.length) return null
            return (
              <AfdSection
                key="__orphan__"
                id="__orphan__"
                label="Øvrige hold"
                holdList={orphans}
                isOpen={openAfd.has('__orphan__')}
                onToggle={toggleOpenAfd}
                tableProps={tableProps}
              />
            )
          })()}
        </div>
      )}
    </>
  )
}

// ─── Events (Begivenheder) ────────────────────────────────────────────────────

const EVENT_TYPES = ['kamp', 'træning', 'stævne', 'arrangement']
const EMPTY_EVENT = { title: '', date: '', time: '', type: 'kamp', holdId: '', location: '', notes: '' }

function EventsPage({ userDoc, authUser }) {
  const [events,    setEvents]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [holds,     setHolds]     = useState([])
  const [editing,   setEditing]   = useState(null)   // null | 'new' | event obj
  const [form,      setForm]      = useState(EMPTY_EVENT)
  const [saving,    setSaving]    = useState(false)
  const [toDelete,  setToDelete]  = useState(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => setHolds(snap.docs.map(d => ({ _id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  function loadEvents() {
    getDocs(query(collection(db, 'events'), orderBy('date'), limit(200)))
      .then(snap => { setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { loadEvents() }, [])

  const visibleHolds = userDoc?.role === 'admin'
    ? holds
    : holds.filter(h => (userDoc?.holds ?? []).includes(String(h.conventus_id)))

  function startNew()    { setForm(EMPTY_EVENT); setEditing('new') }
  function startEdit(ev) {
    setForm({ title: ev.title ?? '', date: ev.date ?? '', time: ev.time ?? '',
              type: ev.type ?? 'kamp', holdId: String(ev.holdId ?? ''),
              location: ev.location ?? '', notes: ev.notes ?? '' })
    setEditing(ev)
  }
  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save(e) {
    e.preventDefault()
    if (!form.title || !form.date) return
    setSaving(true)
    const hold = holds.find(h => String(h.conventus_id) === form.holdId) ?? {}
    const payload = {
      ...form,
      holdId:    form.holdId || null,
      holdName:  hold.titel ?? '',
      authorUid: authUser.uid,
      authorName: userDoc?.displayName || authUser.email,
      updatedAt:  serverTimestamp(),
    }
    try {
      if (editing === 'new') {
        await addDoc(collection(db, 'events'), { ...payload, createdAt: serverTimestamp() })
      } else {
        await updateDoc(doc(db, 'events', editing.id), payload)
      }
      setEditing(null)
      loadEvents()
    } finally { setSaving(false) }
  }

  async function importFromConventus() {
    setImporting(true); setImportMsg('')
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const fd = new FormData(); fd.append('idToken', idToken)
      const res  = await fetch(`${BASE}api/conventus.php?endpoint=kalender`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      })
      const data = await res.json()
      if (data.error) {
        let msg = 'Fejl: ' + data.error
        if (data.raw_preview) msg += '\n\nConventus svarede:\n' + data.raw_preview
        if (data.debug)       msg += '\n\nURL forsøgt: ' + (data.debug.url || '–')
        setImportMsg(msg)
        return
      }
      const items = data.events ?? []
      if (!items.length) {
        const d = data.debug || {}
        setImportMsg(
          `Ingen begivenheder fundet (${d.items_in_xml ?? 0} items i XML).\n` +
          `Root-tags: ${(d.root_tags || []).join(', ')}\n` +
          `Channel-tags: ${(d.channel_tags || []).join(', ')}\n` +
          (d.first_item ? `Første item: ${JSON.stringify(d.first_item, null, 2)}` : 'Ingen items')
        )
        return
      }

      // Skriv til Firestore — upsert baseret på titel+dato
      const existingKeys = new Set(events.map(e => e.title + '|' + e.date))
      let added = 0
      for (const ev of items) {
        if (!ev.title || !ev.date) continue
        if (existingKeys.has(ev.title + '|' + ev.date)) continue
        await addDoc(collection(db, 'events'), {
          title:          ev.title,
          date:           ev.date,
          time:           ev.time || '',
          type:           'arrangement',
          holdId:         null,
          holdName:       '',
          location:       ev.location || '',
          notes:          ev.description || '',
          conventus_link: ev.link || '',
          conventus:      true,
          authorUid:      authUser.uid,
          authorName:     userDoc?.displayName || authUser.email,
          createdAt:      serverTimestamp(),
          updatedAt:      serverTimestamp(),
        })
        added++
      }
      setImportMsg(`${added} nye begivenheder importeret (${items.length} fundet i alt).`)
      loadEvents()
    } catch (err) {
      setImportMsg('Hentning fejlede: ' + err.message)
    } finally { setImporting(false) }
  }

  async function confirmDelete() {
    if (!toDelete) return
    await deleteDoc(doc(db, 'events', toDelete.id))
    setToDelete(null)
    loadEvents()
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
                {visibleHolds.map(h => <option key={h.conventus_id} value={String(h.conventus_id)}>{h.titel}</option>)}
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={importFromConventus} disabled={importing}>
            <Icon name="link" size={15} color="currentColor" />
            {importing ? 'Henter…' : 'Hent fra Conventus'}
          </button>
          <button className="btn btn-primary" onClick={startNew}>
            <Icon name="plus" size={15} color="white" /> Ny begivenhed
          </button>
        </div>
      </div>
      {importMsg && (
        <div className={importMsg.startsWith('Fejl') ? 'alert-error' : 'alert-info'}
             style={{ marginBottom: 16, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {importMsg}</div>
      )}

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

// ─── Banners ──────────────────────────────────────────────────────────────────

const EMPTY_BANNER = { imageUrl: '', title: '', subtitle: '', linkUrl: '', order: 1, aktiv: true }

function BannersPage({ userDoc, authUser }) {
  const [banners, setBanners]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null)  // null | 'new' | banner obj
  const [form,    setForm]      = useState(EMPTY_BANNER)
  const [saving,  setSaving]    = useState(false)
  const [toDelete,setToDelete]  = useState(null)
  // Events-på-forside-indstilling
  const [eventsCount, setEventsCount] = useState(3)
  const [savingEvt,   setSavingEvt]   = useState(false)

  function loadBanners() {
    getDocs(query(collection(db, 'banners'), orderBy('order')))
      .then(snap => { setBanners(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => {
    loadBanners()
    getDoc(doc(db, 'settings', 'app'))
      .then(s => { if (s.exists()) setEventsCount(s.data().eventsOnDashboard ?? 3) })
      .catch(() => {})
  }, [])

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save(e) {
    e.preventDefault()
    if (!form.imageUrl) return
    setSaving(true)
    const data = {
      imageUrl:  form.imageUrl,
      title:     form.title.trim(),
      subtitle:  form.subtitle.trim(),
      linkUrl:   form.linkUrl.trim(),
      order:     Number(form.order) || 1,
      aktiv:     form.aktiv,
      updatedAt: serverTimestamp(),
    }
    try {
      if (editing === 'new') {
        await addDoc(collection(db, 'banners'), { ...data, createdAt: serverTimestamp() })
      } else {
        await updateDoc(doc(db, 'banners', editing.id), data)
      }
      setEditing(null)
      loadBanners()
    } finally { setSaving(false) }
  }

  async function saveEventsCount(n) {
    setSavingEvt(true)
    await setDoc(doc(db, 'settings', 'app'), { eventsOnDashboard: n }, { merge: true }).catch(() => {})
    setSavingEvt(false)
  }

  async function toggleAktiv(b) {
    await updateDoc(doc(db, 'banners', b.id), { aktiv: !b.aktiv })
    loadBanners()
  }

  if (editing) return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>← Tilbage</button>
          <h1 className="page-title">{editing === 'new' ? 'Nyt banner' : 'Rediger banner'}</h1>
        </div>
      </div>
      <form onSubmit={save}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          <div className="card card-pad">
            <div className="form-group">
              <label className="form-label">Billede *</label>
              <ImageUploader value={form.imageUrl} onChange={url => setF('imageUrl', url)}
                aspectRatio="3/1"
                hint="Anbefalet størrelse: 1200 × 400 px (bredformat). Vises i fuld bredde i appen." />
            </div>
            <div className="form-group">
              <label className="form-label">Titel (valgfri)</label>
              <input className="form-control" value={form.title} onChange={e => setF('title', e.target.value)} placeholder="fx Fitness Silkeborg" />
            </div>
            <div className="form-group">
              <label className="form-label">Undertitel (valgfri)</label>
              <input className="form-control" value={form.subtitle} onChange={e => setF('subtitle', e.target.value)} placeholder="fx Åbn sommersæson med 20% rabat" />
            </div>
            <div className="form-group">
              <label className="form-label">Link (valgfri)</label>
              <input className="form-control" value={form.linkUrl} onChange={e => setF('linkUrl', e.target.value)} placeholder="https://..." type="url" />
              <p className="form-hint">Tryk på banneret åbner dette link</p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Annuller</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !form.imageUrl}>
                {saving ? 'Gemmer…' : editing === 'new' ? 'Opret banner' : 'Gem ændringer'}
              </button>
            </div>
          </div>

          <div className="card card-pad">
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Indstillinger</h3>
            <div className="form-group">
              <label className="form-label">Rækkefølge</label>
              <input className="form-control" type="number" min="1" value={form.order} onChange={e => setF('order', e.target.value)} style={{ width: 80 }} />
              <p className="form-hint">Lavest tal vises først</p>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Status</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.aktiv} onChange={e => setF('aktiv', e.target.checked)} />
                <span style={{ fontSize: 13 }}>Aktiv (vises i appen)</span>
              </label>
            </div>
          </div>
        </div>
      </form>
    </>
  )

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Forsidebanners</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY_BANNER, order: banners.length + 1 }); setEditing('new') }}>
          <Icon name="plus" size={15} color="white" /> Nyt banner
        </button>
      </div>

      {/* Events-på-forside-indstilling */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Icon name="calendar" size={18} color="var(--green)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Begivenheder på forsiden:</span>
          <input type="number" min="0" max="10"
            className="form-control"
            value={eventsCount}
            onChange={e => setEventsCount(Number(e.target.value))}
            style={{ width: 70 }} />
          <button className="btn btn-primary btn-sm" disabled={savingEvt}
            onClick={() => saveEventsCount(eventsCount)}>
            {savingEvt ? 'Gemmer…' : 'Gem'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>Sæt til 0 for at skjule sektionen</span>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
        Banners vises som et roterende galleri øverst på forsiden i appen.
        Ideelt til sponsorer, arrangementer og kampagner. Tryk på et banner i appen åbner linket.
      </p>

      {loading ? (
        <div className="card"><div className="loading-dots"><span/><span/><span/></div></div>
      ) : banners.length === 0 ? (
        <EmptyState icon="star" text="Ingen banners endnu — klik 'Nyt banner' for at tilføje" />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: 80 }}>Preview</th><th>Titel</th><th>Link</th><th style={{ width: 60 }}>Orden</th><th style={{ textAlign: 'center', width: 80 }}>Aktiv</th><th style={{ width: 90 }}></th></tr></thead>
              <tbody>
                {banners.map(b => (
                  <tr key={b.id}>
                    <td>
                      {b.imageUrl
                        ? <img src={b.imageUrl} alt="" style={{ width: 72, height: 40, objectFit: 'cover', borderRadius: 4 }} onError={e => { e.target.style.display='none' }} />
                        : <div style={{ width: 72, height: 40, background: 'var(--bg)', borderRadius: 4 }} />}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{b.title || '(ingen titel)'}</div>
                      {b.subtitle && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{b.subtitle}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.linkUrl || '–'}
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>{b.order}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button type="button" onClick={() => toggleAktiv(b)} style={{
                        width: 36, height: 20, borderRadius: 10, padding: 2, border: 'none', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center',
                        background: b.aktiv ? '#1a5c2a' : '#d1d5db', transition: 'background .2s',
                      }}>
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', display: 'block', transform: b.aktiv ? 'translateX(16px)' : 'translateX(0)', transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ imageUrl: b.imageUrl, title: b.title || '', subtitle: b.subtitle || '', linkUrl: b.linkUrl || '', order: b.order || 1, aktiv: b.aktiv !== false }); setEditing(b) }}>
                          <Icon name="edit" size={13} />
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#dc3545' }} onClick={() => setToDelete(b)}>
                          <Icon name="trash" size={13} color="#dc3545" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toDelete && (
        <ConfirmDialog title="Slet banner" body={`Slet "${toDelete.title || 'dette banner'}"?`} danger
          onConfirm={async () => { await deleteDoc(doc(db, 'banners', toDelete.id)); setToDelete(null) }}
          onCancel={() => setToDelete(null)} />
      )}
    </>
  )
}

// ─── App-brugere ──────────────────────────────────────────────────────────────

function fmtRelative(ts) {
  if (!ts) return '–'
  const d    = ts?.toDate ? ts.toDate() : new Date(ts)
  const diff = Date.now() - d.getTime()
  const min  = Math.floor(diff / 60000)
  const hrs  = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (min  <  2)  return 'Lige nu'
  if (hrs  <  1)  return `${min} min siden`
  if (hrs  < 24)  return `${hrs} t siden`
  if (days === 1) return 'I går'
  if (days <  7)  return `${days} dage siden`
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
}

function AppUsersPage() {
  const [users,      setUsers]      = useState([])
  const [holdMap,    setHoldMap]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [sortKey,    setSortKey]    = useState('lastSeen')
  const [actionMsg,  setActionMsg]  = useState({})  // uid → { ok, msg }
  const [actionBusy, setActionBusy] = useState({})  // uid+type → true
  const [toDelete,   setToDelete]   = useState(null) // bruger-obj til sletbekræftelse

  async function adminAction(uid, action) {
    const key = uid + action
    setActionBusy(b => ({ ...b, [key]: true }))
    setActionMsg(m => ({ ...m, [uid]: null }))
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const res  = await fetch('https://app.sejssvejbaek-if.dk/api/admin-verify-user.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid, action, idToken }),
      })
      const data = await res.json()
      if (data.ok) {
        if (action === 'verify') {
          setActionMsg(m => ({ ...m, [uid]: { ok: true, msg: 'Verificeret!' } }))
          setUsers(us => us.map(u => u.id === uid ? { ...u, emailVerified: true } : u))
        } else if (action === 'resend') {
          setActionMsg(m => ({ ...m, [uid]: { ok: true, msg: `Mail sendt til ${data.email || ''}` } }))
        } else if (action === 'delete') {
          setUsers(us => us.filter(u => u.id !== uid))
        }
      } else {
        setActionMsg(m => ({ ...m, [uid]: { ok: false, msg: data.error || 'Fejl' } }))
      }
    } catch (err) {
      setActionMsg(m => ({ ...m, [uid]: { ok: false, msg: err.message } }))
    } finally {
      setActionBusy(b => ({ ...b, [key]: false }))
      setTimeout(() => setActionMsg(m => ({ ...m, [uid]: null })), 5000)
    }
  }

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'holds')),
    ]).then(([uSnap, hSnap]) => {
      setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      const map = {}
      hSnap.docs.forEach(d => {
        const h = d.data()
        if (h.conventus_id) map[String(h.conventus_id)] = h.titel || d.id
      })
      setHoldMap(map)
    }).finally(() => setLoading(false))
  }, [])

  // Opbyg email → bruger-opslag (primaryEmail og login-email)
  const emailToUser = {}
  users.forEach(u => {
    const e = (u.email || u.primaryEmail || '').toLowerCase()
    if (e) emailToUser[e] = u
  })

  // Normaliser extraEmails til [{email, verified}]
  function getExtraEmails(u) {
    return (u.extraEmails || []).map(e =>
      typeof e === 'string' ? { email: e, verified: false } : e
    )
  }

  // Hold-IDs som brugeren ser i appen (alle kilder)
  function getUserHoldIds(u) {
    return [...new Set([
      ...(u.holdIds       || []).map(String),
      ...(u.holds         || []).map(String),
      ...(u.familyMembers || []).filter(m => m.holdId).map(m => String(m.holdId)),
    ])]
  }

  const ROLE_LABEL = { admin: 'Admin', trainer: 'Træner', Medlem: 'Medlem' }
  const ROLE_COLOR = { admin: 'badge-green', trainer: 'badge-blue', Membre: 'badge-gray' }

  const q = search.trim().toLowerCase()
  const filtered = users
    .filter(u => {
      if (!q) return true
      if ((u.displayName || '').toLowerCase().includes(q)) return true
      const primary = (u.email || u.primaryEmail || '').toLowerCase()
      if (primary.includes(q)) return true
      if (getExtraEmails(u).some(e => e.email.toLowerCase().includes(q))) return true
      // Søg også i holdnavne
      return getUserHoldIds(u).some(id => (holdMap[id] || '').toLowerCase().includes(q))
    })
    .sort((a, b) => {
      if (sortKey === 'displayName') return (a.displayName || '').localeCompare(b.displayName || '', 'da')
      const tsA = a[sortKey]?.toDate?.() ?? new Date(0)
      const tsB = b[sortKey]?.toDate?.() ?? new Date(0)
      return tsB - tsA
    })

  const total    = users.length
  const members  = users.filter(u => !u.role || u.role === 'Medlem').length
  const staff    = users.filter(u => u.role === 'admin' || u.role === 'trainer').length
  const verified = users.filter(u => u.emailVerified).length

  function SortTh({ k, label }) {
    const active = sortKey === k
    return (
      <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
          onClick={() => setSortKey(k)}>
        {label} <span style={{ opacity: active ? 1 : .25, fontSize: 10 }}>▼</span>
      </th>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">App-brugere</h1>
        <span className="text-muted" style={{ fontSize: 13 }}>{total} brugere i alt</span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#e8f5ec' }}><Icon name="users" size={20} color="#1a5c2a" /></div>
          <div className="stat-card-value" style={{ color: '#1a5c2a' }}>{total}</div>
          <div className="stat-card-label">Konti i alt</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#eff6ff' }}><Icon name="person" size={20} color="#3b82f6" /></div>
          <div className="stat-card-value" style={{ color: '#3b82f6' }}>{members}</div>
          <div className="stat-card-label">Klubmedlemmer</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef9c3' }}><Icon name="shield" size={20} color="#ca8a04" /></div>
          <div className="stat-card-value" style={{ color: '#ca8a04' }}>{staff}</div>
          <div className="stat-card-label">Trænere / admins</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#f0fdf4' }}><Icon name="check" size={20} color="#16a34a" /></div>
          <div className="stat-card-value" style={{ color: '#16a34a' }}>{verified}</div>
          <div className="stat-card-label">Verificeret email</div>
        </div>
      </div>

      {/* Søg */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}>
          <Icon name="search" size={16} color="var(--text3)" />
        </span>
        <input
          className="form-control"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søg navn, primær- eller ekstra-email…"
          style={{ paddingLeft: 36, paddingRight: search ? 36 : undefined }}
          autoComplete="off"
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <Icon name="x" size={16} color="var(--text3)" />
          </button>
        )}
      </div>

      {/* Note om manglende brugere */}
      <div className="alert-info" style={{ marginBottom: 16, fontSize: 12 }}>
        <strong>Listen viser kun brugere med et Firestore-dokument.</strong> Hvis en bruger loggede ind da Firebase-kvoten var overskredet, kan deres konto mangle her — bed dem logge ind igen for at gendanne dokumentet.
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-dots"><span/><span/><span/></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="person" text={q ? `Ingen brugere matcher "${search}"` : 'Ingen brugere endnu'} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh k="displayName" label="Navn" />
                  <th>Email-forbindelser</th>
                  <th>Hold i appen</th>
                  <th>Rolle</th>
                  <SortTh k="lastSeen"  label="Sidst aktiv" />
                  <SortTh k="createdAt" label="Oprettet" />
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const primary    = (u.email || u.primaryEmail || '').toLowerCase()
                  const extras     = getExtraEmails(u)
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>
                        {u.displayName || '–'}
                      </td>

                      {/* Email-kolonne med relationer */}
                      <td style={{ fontSize: 12 }}>
                        {/* Primær email */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: extras.length ? 5 : 0 }}>
                          <span style={{ color: u.emailVerified ? '#16a34a' : 'var(--text3)', fontWeight: 600, fontSize: 11 }}>
                            {u.emailVerified ? '✓' : '○'}
                          </span>
                          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{primary || '–'}</span>
                          <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 4 }}>primær</span>
                        </div>

                        {/* Ekstra emails */}
                        {extras.map((ex, i) => {
                          const exLower    = ex.email.toLowerCase()
                          const linkedUser = emailToUser[exLower]
                          const isOwnUser  = linkedUser && linkedUser.id !== u.id
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 12, marginBottom: i < extras.length - 1 ? 3 : 0 }}>
                              <span style={{ color: ex.verified ? '#16a34a' : '#f59e0b', fontWeight: 600, fontSize: 11 }}>
                                {ex.verified ? '✓' : '?'}
                              </span>
                              <span style={{ color: ex.verified ? 'var(--text)' : 'var(--text2)' }}>{ex.email}</span>
                              {ex.verified && (
                                <span style={{ fontSize: 10, color: '#16a34a', background: '#f0fdf4', padding: '1px 5px', borderRadius: 4 }}>verificeret</span>
                              )}
                              {!ex.verified && (
                                <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 }}>afventer</span>
                              )}
                              {isOwnUser && (
                                <span style={{ fontSize: 10, color: '#5856d6', background: '#ede9fe', padding: '1px 5px', borderRadius: 4 }}>
                                  ↔ {linkedUser.displayName || linkedUser.email || linkedUser.primaryEmail}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </td>

                      {/* Hold i appen */}
                      <td style={{ fontSize: 12, maxWidth: 220 }}>
                        {(() => {
                          const ids   = getUserHoldIds(u)
                          if (!ids.length) return <span style={{ color: 'var(--text3)' }}>–</span>
                          const named   = ids.map(id => holdMap[id]).filter(Boolean)
                          const unknown = ids.length - named.length
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {named.map((titel, i) => (
                                <span key={i} className="badge badge-gray"
                                      style={{ fontSize: 10, padding: '1px 5px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      title={titel}>
                                  {titel}
                                </span>
                              ))}
                              {unknown > 0 && (
                                <span style={{ fontSize: 10, color: 'var(--text3)', alignSelf: 'center' }}>
                                  ({unknown} uden navn)
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>

                      <td>
                        <span className={`badge ${ROLE_COLOR[u.role] || 'badge-gray'}`}>
                          {ROLE_LABEL[u.role] || u.role || 'Membre'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                        {fmtRelative(u.lastSeen)}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                        {formatDate(u.createdAt)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {!u.emailVerified && (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={actionBusy[u.id + 'verify']}
                                onClick={() => adminAction(u.id, 'verify')}
                                title="Sæt emailVerified=true direkte i Firebase Auth og Firestore"
                              >
                                {actionBusy[u.id + 'verify'] ? '…' : '✓ Verificér'}
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={actionBusy[u.id + 'resend']}
                                onClick={() => adminAction(u.id, 'resend')}
                                title="Send ny verifikationsmail til brugerens email"
                              >
                                {actionBusy[u.id + 'resend'] ? 'Sender…' : '✉ Send mail'}
                              </button>
                            </>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: '#dc3545' }}
                            onClick={() => setToDelete(u)}
                            title="Slet bruger fra Firebase Auth og Firestore"
                          >
                            <Icon name="trash" size={12} color="#dc3545" /> Slet
                          </button>
                          {actionMsg[u.id] && (
                            <span style={{ fontSize: 11, color: actionMsg[u.id].ok ? '#16a34a' : '#dc3545', fontWeight: 600 }}>
                              {actionMsg[u.id].msg}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Slet bruger"
          body={`Slet "${toDelete.displayName || toDelete.email || toDelete.id}" permanent fra Firebase Auth og Firestore? Handlingen kan ikke fortrydes.`}
          danger
          onConfirm={() => { adminAction(toDelete.id, 'delete'); setToDelete(null) }}
          onCancel={() => setToDelete(null)}
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

  const [roleError, setRoleError] = useState('')

  async function saveRole(uid, role) {
    setRoleError('')
    setSaving(uid + '-role')
    try {
      await updateDoc(doc(db, 'users', uid), { role })
      setUsers(us => us.map(u => u.id === uid ? { ...u, role } : u))
    } catch (err) {
      setRoleError('Kunne ikke gemme rollen: ' + (err.code === 'permission-denied'
        ? 'Firestore-regler tillader ikke at skrive til andre brugeres dokumenter. Tjek sikkerhedsreglerne i Firebase-konsollen.'
        : err.message))
    } finally {
      setSaving(null)
    }
  }

  async function saveHolds(uid, holds) {
    setSaving(uid + '-holds')
    try {
      await updateDoc(doc(db, 'users', uid), { holds })
      setUsers(us => us.map(u => u.id === uid ? { ...u, holds } : u))
      setExpandedId(null)
    } catch (err) {
      alert('Kunne ikke gemme hold: ' + err.message)
    } finally {
      setSaving(null)
    }
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

      {roleError && (
        <div className="alert-error" style={{ marginBottom: 16 }}>
          <strong>Fejl ved rolle-ændring:</strong> {roleError}
          <button onClick={() => setRoleError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', opacity: .6 }}>✕</button>
        </div>
      )}

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
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Sådan tilføjes en ny bruger</h3>
          <ol style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
            <li>Bed brugeren logge ind på backoffice med Google, Facebook eller email/adgangskode</li>
            <li>De vil se "Ingen adgang" — det er korrekt</li>
            <li>Deres konto vises nu i listen til venstre</li>
            <li>Tildel dem rollen <strong>Træner</strong> eller <strong>Admin</strong></li>
          </ol>
        </div>
      </div>
    </>
  )
}

// ─── SMS ──────────────────────────────────────────────────────────────────────

function SmsPage({ authUser, userDoc }) {
  const [text,        setText]        = useState('')
  const [scope,       setScope]       = useState('all')
  const [scopeId,     setScopeId]     = useState('')
  const [manualInput, setManualInput] = useState('')
  const [afdelinger,  setAfdelinger]  = useState([])
  const [holds,       setHolds]       = useState([])
  const [preview,     setPreview]     = useState(null)
  const [previewing,  setPreviewing]  = useState(false)
  const [sending,     setSending]     = useState(false)
  const [result,      setResult]      = useState(null)
  const [error,       setError]       = useState('')
  const [logs,        setLogs]        = useState([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [confirm,     setConfirm]     = useState(false)

  useEffect(() => {
    getDocs(collection(db, 'afdelinger'))
      .then(s => setAfdelinger(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.navn||'').localeCompare(b.navn||'','da'))))
      .catch(() => {})
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(s => setHolds(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.titel||'').localeCompare(b.titel||'','da'))))
      .catch(() => {})
    loadLogs()
  }, [])

  function loadLogs() {
    getDocs(query(collection(db, 'sms_logs'), orderBy('sentAt', 'desc'), limit(20)))
      .then(s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLogsLoading(false))
  }

  const charCount = text.length
  const smsParts  = charCount <= 160 ? 1 : charCount <= 306 ? 2 : Math.ceil(charCount / 153)

  function scopeLabel() {
    if (scope === 'all') return 'Alle aktive medlemmer'
    if (scope === 'manual') return 'Manuel'
    if (scope === 'afdeling') {
      const a = afdelinger.find(x => x.id === scopeId)
      return a ? a.navn : scopeId
    }
    if (scope === 'hold') {
      const h = holds.find(x => String(x.conventus_id) === scopeId)
      return h ? h.titel : scopeId
    }
    return ''
  }

  async function doPreview() {
    if (!text.trim()) { setError('Skriv en besked først'); return }
    if (scope !== 'manual' && scope !== 'all' && !scopeId) { setError('Vælg en modtager-gruppe'); return }
    if (scope === 'manual' && !manualInput.trim()) { setError('Indtast mindst ét telefonnummer'); return }
    setError(''); setPreview(null); setPreviewing(true)
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const res  = await fetch(`${BASE}api/send-sms.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'preview', scope, scope_id: scopeId,
                               scope_label: scopeLabel(), manual_input: manualInput, text }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error + (data.detail ? ` (${data.detail})` : '')); return }
      setPreview(data)
    } catch (err) { setError('Netværksfejl: ' + err.message) }
    finally { setPreviewing(false) }
  }

  async function doSend() {
    setConfirm(false)
    setError(''); setResult(null); setSending(true)
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const res  = await fetch(`${BASE}api/send-sms.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'send', scope, scope_id: scopeId,
                               scope_label: scopeLabel(), manual_input: manualInput, text }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error + (data.detail ? ` (${data.detail})` : '')); return }
      setResult(data)
      setText(''); setScopeId(''); setManualInput(''); setPreview(null)
      loadLogs()
    } catch (err) { setError('Netværksfejl: ' + err.message) }
    finally { setSending(false) }
  }

  const holdsForAfd = scopeId && scope === 'afdeling'
    ? holds.filter(h => String(h.afdeling_id) === scopeId)
    : holds

  // Beregn udgiftsstatistik fra loggen
  const totalCost = logs.reduce((sum, l) => {
    const cost = l.actualCost != null ? l.actualCost * 7.46 : (l.estimatedCost ?? 0)
    return sum + cost
  }, 0)
  const now = new Date()
  const thisMonthCost = logs
    .filter(l => { const d = l.sentAt?.toDate?.(); return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
    .reduce((sum, l) => {
      const cost = l.actualCost != null ? l.actualCost * 7.46 : (l.estimatedCost ?? 0)
      return sum + cost
    }, 0)

  const canSend = text.trim() && (scope === 'all' || (scope === 'manual' && manualInput.trim()) || ((scope === 'afdeling' || scope === 'hold') && scopeId))

  const SCOPE_OPTS = [
    { value: 'all',      label: 'Alle' },
    { value: 'afdeling', label: 'Afdeling' },
    { value: 'hold',     label: 'Hold' },
    { value: 'manual',   label: 'Manuelt' },
  ]

  return (
    <>
      {confirm && (
        <ConfirmDialog
          title="Send SMS?"
          body={`Send til ${preview?.count ?? '?'} modtagere · estimeret ${preview?.estimatedCost ?? '?'} kr. · ~0,40 kr./SMS`}
          onConfirm={doSend}
          onCancel={() => setConfirm(false)}
          danger
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>

        {/* ── Venstre: Compose ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Beskedfeltet */}
          <div className="card card-pad">
            <div style={{ position: 'relative' }}>
              <textarea
                className="form-control"
                rows={6}
                style={{ resize: 'none', fontFamily: 'inherit', fontSize: 14, paddingBottom: 28 }}
                placeholder="Skriv din SMS-besked…"
                value={text}
                onChange={e => { setText(e.target.value); setPreview(null); setResult(null) }}
                maxLength={480}
                autoFocus
              />
              <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{charCount}/480</span>
                <span style={{ fontSize: 11, color: smsParts > 1 ? '#f59e0b' : 'var(--text3)', fontWeight: smsParts > 1 ? 600 : 400 }}>
                  {smsParts > 1 ? `⚠ ${smsParts} SMS-dele pr. modtager` : '1 SMS pr. modtager'}
                </span>
              </div>
            </div>
          </div>

          {/* Modtagere */}
          <div className="card card-pad">
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>Modtagere</p>

            {/* Segmenteret scopevælger */}
            <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 8, padding: 3, gap: 2, marginBottom: 14 }}>
              {SCOPE_OPTS.map(opt => (
                <button key={opt.value}
                  onClick={() => { setScope(opt.value); setScopeId(''); setPreview(null) }}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 13, fontWeight: scope === opt.value ? 600 : 400,
                    background: scope === opt.value ? 'white' : 'transparent',
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                    color: scope === opt.value ? 'var(--text)' : 'var(--text2)',
                    boxShadow: scope === opt.value ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
                    transition: 'all .15s',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>

            {scope === 'afdeling' && (
              <select className="form-control" value={scopeId}
                      onChange={e => { setScopeId(e.target.value); setPreview(null) }}>
                <option value="">Vælg afdeling…</option>
                {afdelinger.map(a => <option key={a.id} value={a.id}>{a.navn}</option>)}
              </select>
            )}
            {scope === 'hold' && (
              <select className="form-control" value={scopeId}
                      onChange={e => { setScopeId(e.target.value); setPreview(null) }}>
                <option value="">Vælg hold…</option>
                {holds.map(h => <option key={h.id} value={String(h.conventus_id)}>{h.titel}</option>)}
              </select>
            )}
            {scope === 'manual' && (
              <>
                <textarea className="form-control" rows={2}
                  style={{ fontFamily: 'monospace', fontSize: 13, resize: 'none' }}
                  placeholder="22391328, +4512345678, …"
                  value={manualInput}
                  onChange={e => { setManualInput(e.target.value); setPreview(null) }}
                />
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>Adskil med komma, semikolon eller linjeskift · Danske numre antages +45</p>
              </>
            )}
          </div>

          {/* Feedback */}
          {error  && <div className="alert-error">{error}</div>}
          {result && <div className="alert-success">✓ Sendt til {result.sent} modtagere · {result.cost}</div>}

          {/* Handlinger */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={doPreview} disabled={previewing || sending || !canSend} style={{ flex: 1 }}>
              {previewing ? 'Henter fra Conventus…' : 'Beregn modtagere + pris'}
            </button>
            <button className="btn btn-primary" onClick={() => setConfirm(true)}
                    disabled={sending || !canSend} style={{ flex: 1 }}>
              {sending ? 'Sender…' : preview ? `Send til ${preview.count} · ~${preview.estimatedCost} kr.` : 'Send besked'}
            </button>
          </div>

          {/* Inline preview-info */}
          {preview && !error && (
            <div style={{ display: 'flex', gap: 12, padding: '12px 16px', background: preview.count > 0 ? '#f0fdf4' : 'var(--bg)', borderRadius: 8, border: '1px solid', borderColor: preview.count > 0 ? '#bbf7d0' : 'var(--sep)' }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{preview.count}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>modtagere</div>
              </div>
              <div style={{ width: 1, background: 'var(--sep)' }} />
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>{preview.estimatedCost} kr.</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>estimeret pris</div>
              </div>
              <div style={{ width: 1, background: 'var(--sep)' }} />
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{preview.parts}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>SMS-del{preview.parts > 1 ? 'e' : ''}</div>
              </div>
            </div>
          )}
        </div>

        {/* ── Højre: Udgiftslog ── */}
        <div className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>SMS-forbrug</p>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>~0,40 kr./SMS</span>
          </div>

          {/* Totaler */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{totalCost.toFixed(2)} kr.</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>samlet forbrug</div>
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{thisMonthCost.toFixed(2)} kr.</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>denne måned</div>
            </div>
          </div>

          {/* Aktivitetsfeed */}
          {logsLoading ? (
            <div className="loading-dots"><span/><span/><span/></div>
          ) : logs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: '12px 0' }}>Ingen SMS sendt endnu</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {logs.slice(0, 8).map(l => {
                const cost = l.actualCost != null ? (l.actualCost * 7.46).toFixed(2) : l.estimatedCost != null ? `~${l.estimatedCost.toFixed(2)}` : '–'
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--sep)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: l.gatewayOk ? 'var(--green-soft)' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: l.gatewayOk ? 'var(--green)' : '#dc2626' }}>
                      {(l.senderName || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.senderName || '–'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {l.recipients ?? '?'} modtagere · {formatDate(l.sentAt)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', flexShrink: 0 }}>
                      {cost} kr.
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, lineHeight: 1.5 }}>
            Priser er estimater baseret på 0,40 kr./SMS. Faktisk afregning sker via GatewayAPI.
          </p>
        </div>
      </div>

      {/* ── Fuld log-tabel ── */}
      {logs.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Historik</p>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tidspunkt</th>
                    <th>Afsender</th>
                    <th style={{ textAlign: 'right' }}>Modtagere</th>
                    <th>Modtagergruppe</th>
                    <th style={{ textAlign: 'right' }}>Pris</th>
                    <th>Status</th>
                    <th>Besked</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => {
                    const cost = l.actualCost != null ? `${(l.actualCost * 7.46).toFixed(2)} kr.` : l.estimatedCost != null ? `~${l.estimatedCost.toFixed(2)} kr.` : '–'
                    return (
                      <tr key={l.id}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{formatDate(l.sentAt)}</td>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{l.senderName || '–'}</td>
                        <td style={{ fontSize: 13, textAlign: 'right' }}>{l.recipients ?? '–'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.scope || '–'}</td>
                        <td style={{ fontSize: 12, textAlign: 'right', fontWeight: 600, color: '#f59e0b' }}>{cost}</td>
                        <td><span className={`badge ${l.gatewayOk ? 'badge-green' : 'badge-red'}`}>{l.gatewayOk ? 'Sendt' : 'Fejl'}</span></td>
                        <td style={{ fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }} title={l.text}>{l.text}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────


const PAGE_TITLES = {
  dashboard: 'Dashboard',
  messages:  'Beskeder',
  news:      'Nyheder',
  teams:     'Hold',
  events:    'Begivenheder',
  banners:   'Forsidebanners',
  sms:       'SMS-besked',
  appusers:  'App-brugere',
  users:     'Adgang',
}

export default function AdminApp() {
  const [authUser, setAuthUser] = useState(undefined)
  const [userDoc, setUserDoc]   = useState(null)
  const [page, setPage]         = useState('dashboard')

  function handleLogout() {
    setAuthUser(null)
    setUserDoc(null)
    signOut(auth).catch(() => {})
  }


  useEffect(() => {
    return onAuthStateChanged(auth, async fbUser => {
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
  if (!authUser)              return <LoginPage />
  if (!userDoc?.role)         return <UnauthorizedPage user={authUser} />

  function renderPage() {
    switch (page) {
      case 'dashboard': return <DashboardPage userDoc={userDoc} />
      case 'messages':  return <MessagesPage  userDoc={userDoc} authUser={authUser} />
      case 'news':      return <NewsPage       userDoc={userDoc} authUser={authUser} />
      case 'teams':     return <TeamsPage      userDoc={userDoc} authUser={authUser} />
      case 'events':    return <EventsPage     userDoc={userDoc} authUser={authUser} />
      case 'banners':   return <BannersPage    userDoc={userDoc} authUser={authUser} />
      case 'sms':
        return userDoc.role === 'admin'
          ? <SmsPage authUser={authUser} userDoc={userDoc} />
          : <EmptyState icon="shield" text="Kun administratorer kan sende SMS" />
      case 'appusers':
        return userDoc.role === 'admin'
          ? <AppUsersPage />
          : <EmptyState icon="shield" text="Kun administratorer har adgang" />
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
