import { useState, useEffect, useRef, useCallback } from 'react'
import { auth, db } from '../firebase.js'
import {
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut, onAuthStateChanged,
} from 'firebase/auth'
import {
  collection, query, orderBy, limit, onSnapshot,
  addDoc, updateDoc, deleteDoc, serverTimestamp,
  doc, getDoc, setDoc, getDocs,
} from 'firebase/firestore'
import './admin.css'

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
  { value: 'Kamp',        color: '#1a5c2a' },
  { value: 'Klubnyt',     color: '#5856d6' },
  { value: 'Ungdom',      color: '#ff9500' },
  { value: 'Arrangement', color: '#ff3b30' },
  { value: 'Frivillige',  color: '#34c759' },
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

function HoldPill({ holdId }) {
  return (
    <span className="badge badge-green" style={{ marginRight: 3, marginBottom: 3 }}>
      {teamName(holdId)}
    </span>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginPage() {
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
        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
          Du logger ind med et enganglink — ingen adgangskode nødvendig.
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

function Sidebar({ page, setPage, userDoc, user }) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard',  icon: 'home'    },
    { id: 'messages',  label: 'Beskeder',   icon: 'message' },
    { id: 'news',      label: 'Nyheder',    icon: 'news'    },
    { id: 'teams',     label: 'Hold',       icon: 'users'   },
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
        <button className="nav-item nav-item-logout" onClick={() => signOut(auth)}>
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
  const [text, setText]         = useState('')
  const [holds, setHolds]       = useState([])
  const [sending, setSending]   = useState(false)
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)

  const visibleTeams = getVisibleTeams(userDoc)

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(100)),
      snap => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      }
    )
  }, [])

  function toggleHold(id) {
    setHolds(prev => prev.includes(id) ? prev.filter(h => h !== id) : [...prev, id])
  }

  async function send(e) {
    e.preventDefault()
    if (!text.trim() || holds.length === 0) return
    setSending(true)
    try {
      await addDoc(collection(db, 'messages'), {
        text: text.trim(),
        authorUid: authUser.uid,
        authorName: userDoc?.displayName || authUser.email,
        targetHolds: holds,
        createdAt: serverTimestamp(),
      })
      setText('')
      setHolds([])
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Beskeder</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Send ny besked</h3>
          <form onSubmit={send}>
            <div className="form-group">
              <label className="form-label">Modtagere (hold)</label>
              <div className="hold-checks">
                {visibleTeams.map(t => (
                  <label key={t.id} className={`hold-check-label ${holds.includes(t.id) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={holds.includes(t.id)}
                      onChange={() => toggleHold(t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              {holds.length === 0 && (
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
              disabled={sending || !text.trim() || holds.length === 0}
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
          {loading ? (
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
                  </div>
                  <p className="msg-text">{m.text}</p>
                  <div className="msg-holds">
                    {(m.targetHolds ?? []).map(h => <HoldPill key={h} holdId={h} />)}
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
              <label className="form-label">Billed-URL (valgfrit)</label>
              <input className="form-control" type="url" value={form.imageUrl} onChange={e => setField('imageUrl', e.target.value)} placeholder="https://…" />
              <p className="form-hint">Link til et billede (Imgur, etc.)</p>
            </div>
            {form.imageUrl && (
              <img
                src={form.imageUrl}
                alt=""
                style={{ width: '100%', borderRadius: 8, objectFit: 'cover', maxHeight: 180, marginTop: 8 }}
                onError={e => { e.target.style.display = 'none' }}
              />
            )}
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

const TEAMS_DETAIL = {
  'u6':       { coach: 'Lars Jensen',          phone: '50 12 34 56', members: 14, record: [5,1,0] },
  'u8':       { coach: 'Maria Christensen',    phone: '40 23 45 67', members: 16, record: [5,0,1] },
  'u10':      { coach: 'Søren Andersen',       phone: '30 34 56 78', members: 18, record: [4,2,1] },
  'u12':      { coach: 'Peter Nielsen',        phone: '20 45 67 89', members: 20, record: [6,1,2] },
  'u14':      { coach: 'Thomas Hansen',        phone: '61 56 78 90', members: 17, record: [4,3,2] },
  'u16':      { coach: 'Mette Larsen',         phone: '71 67 89 01', members: 15, record: [7,1,0] },
  'herrer-a': { coach: 'Ole Svendsen',         phone: '81 78 90 12', members: 22, record: [8,2,2] },
  'herrer-b': { coach: 'Mikkel Pedersen',      phone: '91 89 01 23', members: 18, record: [5,4,3] },
  'damer':    { coach: 'Anne-Mette Sørensen',  phone: '42 90 12 34', members: 16, record: [6,2,1] },
}

function TeamsPage({ userDoc }) {
  const visibleTeams = getVisibleTeams(userDoc)
  const youth  = visibleTeams.filter(t => t.category === 'Ungdom')
  const senior = visibleTeams.filter(t => t.category === 'Senior')

  function TeamSection({ title, teams }) {
    return (
      <>
        <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text2)', margin: '20px 0 10px' }}>
          {title}
        </h3>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hold</th>
                  <th>Træner</th>
                  <th>Telefon</th>
                  <th>Spillere</th>
                  <th>S</th><th>U</th><th>N</th>
                  <th>Point</th>
                </tr>
              </thead>
              <tbody>
                {teams.map(t => {
                  const d = TEAMS_DETAIL[t.id]
                  const [w, dr, l] = d?.record ?? [0,0,0]
                  return (
                    <tr key={t.id}>
                      <td><span style={{ fontWeight: 700 }}>{t.name}</span></td>
                      <td>{d?.coach ?? '–'}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{d?.phone ?? '–'}</td>
                      <td>
                        <span className="badge badge-gray">{d?.members ?? '–'}</span>
                      </td>
                      <td style={{ color: '#166534', fontWeight: 600 }}>{w}</td>
                      <td style={{ color: '#92400e', fontWeight: 600 }}>{dr}</td>
                      <td style={{ color: '#991b1b', fontWeight: 600 }}>{l}</td>
                      <td style={{ fontWeight: 700 }}>{w * 3 + dr}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Hold</h1>
        <span className="text-muted" style={{ fontSize: 13 }}>
          {visibleTeams.length} hold vises
        </span>
      </div>
      {youth.length  > 0 && <TeamSection title="Ungdom" teams={youth} />}
      {senior.length > 0 && <TeamSection title="Senior" teams={senior} />}
      {visibleTeams.length === 0 && (
        <EmptyState icon="users" text="Du er ikke tilknyttet nogen hold endnu" />
      )}
    </>
  )
}

// ─── Users ────────────────────────────────────────────────────────────────────

function UsersPage({ authUser }) {
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [saving, setSaving]     = useState(null)

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
    const [selected, setSelected] = useState(user.holds ?? [])
    function toggle(id) {
      setSelected(prev => prev.includes(id) ? prev.filter(h => h !== id) : [...prev, id])
    }
    return (
      <td colSpan={5} style={{ padding: '12px 16px', background: 'var(--bg)' }}>
        <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 13 }}>Tildelte hold for {user.displayName}</div>
        <div className="hold-checks" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 12 }}>
          {TEAMS_STATIC.map(t => (
            <label key={t.id} className={`hold-check-label ${selected.includes(t.id) ? 'selected' : ''}`}>
              <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
              {t.name}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={saving === user.id + '-holds'} onClick={() => saveHolds(user.id, selected)}>
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
                              {(u.holds ?? []).map(h => <HoldPill key={h} holdId={h} />)}
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

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  messages:  'Beskeder',
  news:      'Nyheder',
  teams:     'Hold',
  users:     'Brugere',
}

export default function AdminApp() {
  const [authUser, setAuthUser] = useState(undefined)
  const [userDoc, setUserDoc]   = useState(null)
  const [page, setPage]         = useState('dashboard')

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
      case 'teams':     return <TeamsPage      userDoc={userDoc} />
      case 'users':
        return userDoc.role === 'admin'
          ? <UsersPage authUser={authUser} />
          : <EmptyState icon="shield" text="Kun administratorer har adgang til brugerstyring" />
      default:          return null
    }
  }

  return (
    <div className="admin-shell">
      <Sidebar page={page} setPage={setPage} userDoc={userDoc} user={authUser} />
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
