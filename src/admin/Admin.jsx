import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import DOMPurify from 'dompurify'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TiptapImage from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
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
    monitor:  <><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>,
    star:     <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    shirt:    <><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.86H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.86l.58-3.57a2 2 0 00-1.34-2.23z"/></>,
    location: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></>,
    copy:     <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
    refresh:  <><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></>,
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

function InvitationRequiredPage({ user }) {
  return (
    <div className="admin-login">
      <div className="login-box" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
        <h2 style={{ marginBottom: 8 }}>Invitation påkrævet</h2>
        <p style={{ color: 'var(--text2)', marginBottom: 6, fontSize: 14, lineHeight: 1.6 }}>
          Din konto (<strong>{user.email}</strong>) er ikke inviteret til backoffice.
        </p>
        <p style={{ color: 'var(--text2)', marginBottom: 20, fontSize: 13, lineHeight: 1.6 }}>
          Kontakt en Superadmin for at få en invitation sendt til din email.
        </p>
        <button className="btn btn-ghost" onClick={() => signOut(auth)}>Log ud</button>
      </div>
    </div>
  )
}

// ─── Backoffice page registry ─────────────────────────────────────────────────
// Single source of truth for all grantable pages. Used by Sidebar + UsersPage.

const BACKOFFICE_PAGES = [
  { group: 'App',           id: 'dashboard',     label: 'Dashboard',      icon: 'home'     },
  { group: 'App',           id: 'news',          label: 'Nyheder',        icon: 'news'     },
  { group: 'App',           id: 'events',        label: 'Begivenheder',   icon: 'calendar' },
  { group: 'App',           id: 'banners',       label: 'Forsidebanners', icon: 'star'     },
  { group: 'App',           id: 'teams',         label: 'Hold',           icon: 'users'    },
  { group: 'App',           id: 'messages',      label: 'Beskeder',       icon: 'message'  },
  { group: 'App',           id: 'appusers',      label: 'App-brugere',    icon: 'eye'      },
  { group: 'App',           id: 'support',       label: 'Support',        icon: 'message'  },
  { group: 'Kommunikation', id: 'kommunikation', label: 'Kommunikation',  icon: 'sms'      },
  { group: 'Infoskærme',    id: 'infoscreens',   label: 'Infoskærme',     icon: 'monitor'  },
]

const PAGE_GROUP_ORDER = ['App', 'Kommunikation', 'Infoskærme']

// Admins get everything. Trainers with no permissions array get all pages (legacy).
// Trainers with an explicit permissions array get only listed pages.
function hasPageAccess(userDoc, pageId) {
  if (userDoc?.role === 'admin') return true
  const perms = userDoc?.permissions
  if (perms == null) return userDoc?.role === 'trainer'
  return perms.includes(pageId)
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ page, setPage, userDoc, user, onLogout }) {
  const isAdmin = userDoc?.role === 'admin'

  const groups = [
    ...PAGE_GROUP_ORDER
      .map(label => ({
        label,
        items: BACKOFFICE_PAGES.filter(p => p.group === label && hasPageAccess(userDoc, p.id)),
      }))
      .filter(g => g.items.length > 0),
    ...(isAdmin ? [{ label: 'Administration', items: [{ id: 'users', label: 'Adgang', icon: 'shield' }] }] : []),
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">SSIF</div>
        <div className="sidebar-logo-sub">Backoffice · Sejs-Svejbæk IF</div>
      </div>
      <nav className="sidebar-nav">
        {groups.map(group => (
          <div key={group.label} className="nav-group">
            <div className="nav-section">{group.label}</div>
            {group.items.map(item => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <Icon name={item.icon} size={16} color="currentColor" />
                {item.label}
              </button>
            ))}
          </div>
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
              {isAdmin ? 'Superadmin' : 'Redaktør'}
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

  // Pill-valg til trænere med få hold, accordion til admin med mange
  const usePills = availableHolds.length <= 10

  const selHoldNames = availableHolds
    .filter(h => selectedIds.includes(String(h.conventus_id)))
    .map(h => h.titel)

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24, alignItems: 'start' }}>

        {/* ── Venstre: Compose ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Success-banner */}
          {sendOk && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--green)', borderRadius: 12, color: 'white' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="check" size={17} color="white" sw={2.5} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Besked sendt!</div>
                <div style={{ fontSize: 12, opacity: .85 }}>
                  {selHoldNames.length > 0 ? selHoldNames.join(', ') : 'Til valgte hold'}
                </div>
              </div>
            </div>
          )}

          {/* Compose-kort */}
          <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,.07)', overflow: 'hidden' }}>

            {/* Hold-vælger header */}
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--sep)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
                Send til
              </p>

              {holdsLoading ? (
                <div className="loading-dots"><span/><span/><span/></div>
              ) : availableHolds.length === 0 ? (
                <p style={{ fontSize: 13, color: '#92400e' }}>Ingen aktive hold — aktivér hold under Hold-siden.</p>
              ) : usePills ? (
                /* Pill-valg — trænere med få hold */
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {availableHolds.map(h => {
                    const id  = String(h.conventus_id)
                    const sel = selectedIds.includes(id)
                    return (
                      <button key={id} type="button" onClick={() => toggleId(h.conventus_id)}
                        style={{ padding: '8px 16px', borderRadius: 20, border: `2px solid ${sel ? 'var(--green)' : 'var(--sep)'}`,
                                 background: sel ? 'var(--green)' : 'white', color: sel ? 'white' : 'var(--text)',
                                 fontWeight: sel ? 700 : 400, fontSize: 13, cursor: 'pointer', transition: 'all .15s',
                                 display: 'flex', alignItems: 'center', gap: 6 }}>
                        {sel && <Icon name="check" size={12} color="white" sw={2.5} />}
                        {h.titel}
                      </button>
                    )
                  })}
                </div>
              ) : (
                /* Accordion — admin med mange hold */
                <>
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}>
                      <Icon name="search" size={14} color="var(--text3)" />
                    </span>
                    <input className="form-control" value={holdSearch} onChange={e => setHoldSearch(e.target.value)}
                      placeholder="Søg hold…" style={{ paddingLeft: 30, fontSize: 13 }} />
                  </div>
                  <div style={{ border: '1px solid var(--sep)', borderRadius: 8, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                    {searchActive ? filteredHolds.map((h, i) => {
                      const id = String(h.conventus_id); const chk = selectedIds.includes(id)
                      return (
                        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', background: chk ? '#f0fdf4' : 'white', borderBottom: '1px solid var(--sep)' }}>
                          <input type="checkbox" checked={chk} onChange={() => toggleId(h.conventus_id)} />
                          <span style={{ fontSize: 13, fontWeight: chk ? 600 : 400, color: chk ? 'var(--green)' : 'var(--text)' }}>{h.titel}</span>
                          {chk && <Icon name="check" size={13} color="var(--green)" sw={2.5} />}
                        </label>
                      )
                    }) : afdWithHolds.map(afd => {
                      const holds = afdHoldMap[afd.id] || []
                      const isOpen = openAfd.has(afd.id)
                      const afdIds = holds.map(h => String(h.conventus_id))
                      const allChk = afdIds.every(id => selectedIds.includes(id))
                      const someChk = afdIds.some(id => selectedIds.includes(id))
                      return (
                        <div key={afd.id} style={{ borderBottom: '1px solid var(--sep)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: someChk ? '#f0fdf4' : '#f8f9fa', gap: 8 }}>
                            <input type="checkbox" checked={allChk}
                              ref={el => { if (el) el.indeterminate = someChk && !allChk }}
                              onChange={() => toggleAllInAfd(holds)} />
                            <button type="button" onClick={() => toggleAfd(afd.id)}
                              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: someChk ? 'var(--green)' : 'var(--text)' }}>{afd.navn || afd.id}</span>
                              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                                {someChk ? `${afdIds.filter(id => selectedIds.includes(id)).length}/${holds.length}` : holds.length + ' hold'} {isOpen ? '▲' : '▼'}
                              </span>
                            </button>
                          </div>
                          {isOpen && holds.map(h => {
                            const id = String(h.conventus_id); const chk = selectedIds.includes(id)
                            return (
                              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 32px', cursor: 'pointer', background: chk ? '#f0fdf4' : 'white', borderTop: '1px solid var(--sep)' }}>
                                <input type="checkbox" checked={chk} onChange={() => toggleId(h.conventus_id)} />
                                <span style={{ fontSize: 13, flex: 1, color: chk ? 'var(--green)' : 'var(--text)', fontWeight: chk ? 600 : 400 }}>{h.titel}</span>
                              </label>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {selectedIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
                    {selectedIds.length === 1
                      ? selHoldNames[0]
                      : `${selectedIds.length} hold valgt`}
                  </span>
                  <button type="button" onClick={() => setSelectedIds([])}
                    style={{ fontSize: 12, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Ryd valg
                  </button>
                </div>
              )}
            </div>

            {/* Beskedfeltet */}
            <div style={{ padding: '0 0 0 0' }}>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={selectedIds.length > 0 ? `Skriv en besked til ${selHoldNames[0] || 'holdet'}…` : 'Vælg et hold og skriv din besked…'}
                rows={5}
                style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit',
                         fontSize: 15, lineHeight: 1.6, padding: '18px 20px', background: 'transparent',
                         color: 'var(--text)', boxSizing: 'border-box' }}
              />
            </div>

            {/* Send-knap */}
            <div style={{ padding: '0 16px 16px' }}>
              <button
                type="button"
                onClick={send}
                disabled={!text.trim() || selectedIds.length === 0}
                style={{ width: '100%', padding: '13px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                         background: text.trim() && selectedIds.length > 0 ? 'var(--green)' : '#e5e7eb',
                         color: text.trim() && selectedIds.length > 0 ? 'white' : 'var(--text3)',
                         fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                         gap: 8, transition: 'all .2s' }}>
                <Icon name="send" size={16} color={text.trim() && selectedIds.length > 0 ? 'white' : 'var(--text3)'} />
                {selectedIds.length > 0
                  ? selectedIds.length === 1 ? `Send til ${selHoldNames[0]}` : `Send til ${selectedIds.length} hold`
                  : 'Vælg hold og skriv besked'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Højre: Beskedhistorik ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Sendte beskeder</p>
            {messages.length > 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{messages.length} i alt</span>}
          </div>

          {msgLoading ? (
            <div className="loading-dots"><span/><span/><span/></div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text3)' }}>
              <Icon name="message" size={32} color="var(--sep)" />
              <p style={{ marginTop: 12, fontSize: 14 }}>Ingen beskeder sendt endnu</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.map(m => (
                <div key={m.id} style={{ background: 'white', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', align: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 10, background: 'var(--green-soft)', color: 'var(--green)', fontSize: 12, fontWeight: 700 }}>
                        {m.holdNavn || '–'}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (window.confirm('Slet denne besked?')) {
                          await deleteDoc(doc(db, 'messages', m.id))
                          loadMessages()
                        }
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', opacity: .5, flexShrink: 0 }}>
                      <Icon name="trash" size={13} color="#dc3545" />
                    </button>
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', margin: '0 0 8px' }}>
                    {m.tekst || m.text}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0 }}>
                      {(m.afsenderNavn || '?')[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{m.afsenderNavn || '–'}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>· {formatDate(m.oprettet || m.createdAt)}</span>
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

// ─── MediaLibraryPicker ───────────────────────────────────────────────────────

function MediaLibraryPicker({ onSelect, onClose }) {
  const [images,  setImages]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'media_library'), orderBy('uploadedAt', 'desc'), limit(100)))
      .then(snap => setImages(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface,#fff)', borderRadius: 14, padding: 24, width: '90%', maxWidth: 820, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>🖼 Billedbibliotek</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕ Luk</button>
        </div>
        {loading ? (
          <div className="loading-dots" style={{ padding: '40px 0', alignSelf: 'center' }}><span/><span/><span/></div>
        ) : images.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text3)', padding: '48px 0', fontSize: 14, lineHeight: 1.7 }}>
            Ingen billeder i biblioteket endnu.<br/>
            Upload et billede i et slide — det gemmes automatisk her.
          </p>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
              {images.map(img => (
                <div key={img.id} onClick={() => { onSelect(img.url); onClose() }}
                  title={img.name || img.url}
                  style={{ aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                    border: '2px solid var(--border)', background: 'var(--bg)', transition: 'border-color .15s, transform .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.transform = 'scale(1.03)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = '' }}>
                  <img src={img.url} alt={img.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ImageUploader ────────────────────────────────────────────────────────────

// aspectRatio: CSS aspect-ratio streng, fx '3/1' for banners, 'auto' for nyheder
// hint: vejledende tekst under uploadzonen
function ImageUploader({ value, onChange, aspectRatio = 'auto', hint = '', library = true }) {
  const [dragging,    setDragging]    = useState(false)
  const [progress,    setProgress]    = useState(null) // null | 0-100
  const [error,       setError]       = useState('')
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const inputRef                      = useRef(null)

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
              if (data.url) {
                onChange(data.url)
                setProgress(null)
                // Gem til billedbibliotek (best-effort)
                addDoc(collection(db, 'media_library'), {
                  url: data.url, name: file.name, size: file.size, uploadedAt: serverTimestamp(),
                }).catch(() => {})
                resolve()
              }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        {value && progress === null && (
          <button type="button" style={{ fontSize: 12, color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={e => { e.stopPropagation(); onChange('') }}>
            Fjern billede
          </button>
        )}
        {library && progress === null && (
          <button type="button"
            onClick={e => { e.stopPropagation(); setPickerOpen(true) }}
            style={{ fontSize: 12, color: 'var(--text2)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', padding: '3px 10px' }}>
            📚 Bibliotek
          </button>
        )}
      </div>
      {pickerOpen && (
        <MediaLibraryPicker
          onSelect={url => { onChange(url); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
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

  const [leaders,         setLeaders]         = useState([])
  const [openTrainerAfd,  setOpenTrainerAfd]  = useState(new Set())

  useEffect(() => {
    loadHolds()
    getDocs(collection(db, 'users')).then(snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    getDocs(query(collection(db, 'members'), where('isLeder', '==', true)))
      .then(snap => setLeaders(snap.docs.map(d => d.data())))
      .catch(() => {})
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

      {/* ── Trænere & aktivering ──────────────────────────────────────────── */}
      {!loading && leaders.length > 0 && (() => {
        // Byg map: holdId → [{ name, email }]
        const byHold = {}
        leaders.forEach(m => {
          ;(m.lederHolds || []).forEach(hId => {
            const key = String(hId)
            if (!byHold[key]) byHold[key] = []
            const email = (m.allEmails || [])[0] || ''
            byHold[key].push({ name: m.name || 'Ukendt', email })
          })
        })

        const holdsMedLedere = holds.filter(h => byHold[String(h.conventus_id)])
        if (!holdsMedLedere.length) return null

        // Gruppér pr. afdeling (samme logik som hold-listen)
        const afdMap = {}
        holdsMedLedere.forEach(h => {
          const afdId  = String(h.afdeling_id ?? '__ingen__')
          const afd    = afdelinger?.find(a => String(a.id) === afdId)
          const label  = afd?.navn || h.aktivitet_titel || 'Øvrige'
          if (!afdMap[afdId]) afdMap[afdId] = { label, holds: [] }
          afdMap[afdId].holds.push(h)
        })

        // Sorter afdelinger alfabetisk, inaktive hold øverst inden for hver
        Object.values(afdMap).forEach(g => {
          g.holds.sort((a, b) => (a.aktiv === b.aktiv ? 0 : a.aktiv ? 1 : -1))
        })
        const sortedAfds = Object.entries(afdMap)
          .sort((a, b) => a[1].label.localeCompare(b[1].label, 'da'))

        const toggleTrainer = id => setOpenTrainerAfd(prev => {
          const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
        })

        const totalInaktive = holdsMedLedere.filter(h => !h.aktiv).length

        return (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: 0 }}>
                Trænere &amp; aktivering i appen
              </h3>
              {totalInaktive > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#b45309', background: '#fef3c7', padding: '2px 10px', borderRadius: 20 }}>
                  {totalInaktive} afventer aktivering
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedAfds.map(([afdId, group]) => {
                const isOpen    = openTrainerAfd.has(afdId)
                const inaktive  = group.holds.filter(h => !h.aktiv).length
                return (
                  <div key={afdId} className="card">
                    <button
                      onClick={() => toggleTrainer(afdId)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center',
                               justifyContent: 'space-between', padding: '12px 16px',
                               background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{group.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                          {group.holds.length} hold
                          {inaktive > 0 && <span style={{ color: '#b45309', marginLeft: 6 }}>· {inaktive} inaktive</span>}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>
                        {isOpen ? '▲' : '▼'}
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: '#f9fafb' }}>
                              <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280' }}>Hold</th>
                              <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280' }}>Træner</th>
                              <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280' }}>Email</th>
                              <th style={{ padding: '8px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280' }}>App-status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.holds.map(h => {
                              const leds  = byHold[String(h.conventus_id)] || []
                              const aktiv = h.aktiv === true
                              return leds.map((l, li) => (
                                <tr key={`${h.conventus_id}-${li}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                                  {li === 0 && (
                                    <td rowSpan={leds.length} style={{ padding: '10px 16px', fontWeight: 600, color: '#111827', verticalAlign: 'middle' }}>
                                      {h.titel || `Hold #${h.conventus_id}`}
                                    </td>
                                  )}
                                  <td style={{ padding: '10px 16px', color: '#374151' }}>{l.name}</td>
                                  <td style={{ padding: '10px 16px' }}>
                                    <a href={`mailto:${l.email}`} style={{ color: '#1a5c2a', textDecoration: 'none' }}>{l.email}</a>
                                  </td>
                                  {li === 0 && (
                                    <td rowSpan={leds.length} style={{ padding: '10px 16px', verticalAlign: 'middle' }}>
                                      <span style={{
                                        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                                        background: aktiv ? '#dcfce7' : '#fef3c7',
                                        color:      aktiv ? '#15803d' : '#b45309',
                                      }}>
                                        {aktiv ? 'Aktiv' : 'Afventer aktivering'}
                                      </span>
                                    </td>
                                  )}
                                </tr>
                              ))
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

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

function UsersPage({ authUser, userDoc }) {
  const [allUsers, setAllUsers]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [availableHolds, setAvailableHolds] = useState([])
  const [expanded, setExpanded]           = useState(null) // { uid, mode: 'perms'|'holds' }
  const [removingId, setRemovingId]       = useState(null)
  const [roleError, setRoleError]         = useState('')

  // Invitation panel state
  const [invites, setInvites]             = useState([])
  const [inviteEmail, setInviteEmail]     = useState('')
  const [inviteType, setInviteType]       = useState('custom') // 'superadmin' | 'custom'
  const [invitePerms, setInvitePerms]     = useState([])
  const [inviting, setInviting]           = useState(false)
  const [inviteMsg, setInviteMsg]         = useState(null) // { ok, emailSent?, error? }

  useEffect(() => {
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => setAvailableHolds(snap.docs.map(d => ({ _id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const accessUsers = allUsers.filter(u => u.role === 'admin' || u.role === 'trainer')

  async function removeAccess(uid) {
    setRemovingId(uid)
    try {
      await updateDoc(doc(db, 'users', uid), { role: 'Medlem', permissions: null })
      setAllUsers(us => us.map(u => u.id === uid ? { ...u, role: 'Medlem', permissions: null } : u))
    } catch (err) {
      setRoleError('Kunne ikke fjerne adgang: ' + err.message)
    } finally { setRemovingId(null) }
  }

  function loadInvites() {
    getDocs(collection(db, 'invitations'))
      .then(snap => setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }

  useEffect(() => { loadInvites() }, [])

  async function sendInvite(e) {
    e.preventDefault()
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviting(true)
    setInviteMsg(null)
    try {
      const token = await auth.currentUser.getIdToken()
      const resp  = await fetch('../api/send-invite.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body:    JSON.stringify({
          email,
          role:        inviteType === 'superadmin' ? 'admin' : 'trainer',
          permissions: inviteType === 'superadmin' ? null : invitePerms,
          inviterName: userDoc.displayName || authUser.email,
        }),
      })
      const data = await resp.json()
      if (!resp.ok || data.error) throw new Error(data.error || 'Ukendt fejl')
      setInviteMsg({ ok: true, emailSent: data.emailSent })
      setInviteEmail(''); setInvitePerms([])
      loadInvites()
    } catch (err) {
      setInviteMsg({ ok: false, error: err.message })
    } finally { setInviting(false) }
  }

  async function cancelInvite(email) {
    try {
      await deleteDoc(doc(db, 'invitations', email.toLowerCase()))
      setInvites(prev => prev.filter(i => i.email !== email.toLowerCase()))
    } catch (err) {
      alert('Kunne ikke slette invitation: ' + err.message)
    }
  }

  function toggleInvitePerm(id) {
    setInvitePerms(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function accessSummary(u) {
    if (u.role === 'admin') return <span className="badge badge-green">Superadmin</span>
    const perms = u.permissions
    if (perms == null) return <span className="badge badge-blue">Alle sider</span>
    if (perms.length === 0) return <span style={{ fontSize: 12, color: 'var(--text3)' }}>Ingen sider</span>
    return (
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>
        {BACKOFFICE_PAGES.filter(p => perms.includes(p.id)).map(p => p.label).join(' · ')}
      </span>
    )
  }

  // PermissionsEditor: edit both page access and (for trainers) holds
  function PermissionsEditor({ user }) {
    const [type, setType]       = useState(user.role === 'admin' ? 'superadmin' : 'custom')
    const [perms, setPerms]     = useState(user.permissions ?? BACKOFFICE_PAGES.map(p => p.id))
    const [holdsSel, setHoldsSel] = useState((user.holds ?? []).map(String))
    const [busy, setBusy]       = useState(false)

    function togglePerm(id) {
      setPerms(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }
    function toggleHold(id) {
      const s = String(id)
      setHoldsSel(prev => prev.includes(s) ? prev.filter(h => h !== s) : [...prev, s])
    }

    const holdsByType = availableHolds.reduce((acc, h) => {
      const t = h.aktivitet_titel || 'Hold'
      ;(acc[t] = acc[t] || []).push(h)
      return acc
    }, {})

    async function save() {
      setBusy(true)
      try {
        const updates = type === 'superadmin'
          ? { role: 'admin', permissions: null, holds: holdsSel }
          : { role: 'trainer', permissions: perms, holds: holdsSel }
        await updateDoc(doc(db, 'users', user.id), updates)
        setAllUsers(us => us.map(u => u.id === user.id ? { ...u, ...updates } : u))
        setExpanded(null)
      } catch (err) {
        setRoleError('Kunne ikke gemme: ' + err.message)
      } finally { setBusy(false) }
    }

    return (
      <td colSpan={3} style={{ padding: '16px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>
          Rediger adgang for {user.displayName}
        </div>

        {/* Access level */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.5px', marginBottom: 8 }}>Adgangsniveau</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input type="radio" checked={type === 'superadmin'} onChange={() => setType('superadmin')} />
              Superadmin (fuld adgang)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input type="radio" checked={type === 'custom'} onChange={() => setType('custom')} />
              Tilpasset — vælg sider
            </label>
          </div>
        </div>

        {/* Page checkboxes (only for custom) */}
        {type === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '0 40px', marginBottom: 16 }}>
            {PAGE_GROUP_ORDER.map(group => (
              <div key={group}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.5px', marginBottom: 6 }}>{group}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {BACKOFFICE_PAGES.filter(p => p.group === group).map(p => (
                    <label key={p.id} className={`hold-check-label ${perms.includes(p.id) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={perms.includes(p.id)} onChange={() => togglePerm(p.id)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Holds (non-admin only) */}
        {type !== 'superadmin' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.5px', marginBottom: 8 }}>Tildelte hold</div>
            {availableHolds.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Ingen aktive hold — synkronisér under Hold-siden.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 32px' }}>
                {Object.entries(holdsByType).map(([type, typeHolds]) => (
                  <div key={type} style={{ minWidth: 160, marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.5px', marginBottom: 4 }}>{type}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {typeHolds.map(h => {
                        const hid = String(h.conventus_id)
                        return (
                          <label key={hid} className={`hold-check-label ${holdsSel.includes(hid) ? 'selected' : ''}`}>
                            <input type="checkbox" checked={holdsSel.includes(hid)} onChange={() => toggleHold(h.conventus_id)} />
                            {h.titel}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
            {busy ? 'Gemmer…' : 'Gem adgang'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(null)}>Annuller</button>
        </div>
      </td>
    )
  }

  const isExpanded = (uid) => expanded?.uid === uid

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Backoffice-adgang</h1>
      </div>

      {roleError && (
        <div className="alert-error" style={{ marginBottom: 16 }}>
          <strong>Fejl:</strong> {roleError}
          <button onClick={() => setRoleError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', opacity: .6 }}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        <div className="card">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
            Brugere med adgang
          </div>
          {loading ? (
            <div className="loading-dots" style={{ padding: 20 }}><span/><span/><span/></div>
          ) : accessUsers.length === 0 ? (
            <EmptyState icon="shield" text="Ingen brugere har backoffice-adgang endnu" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bruger</th>
                    <th>Adgang til</th>
                    <th style={{ width: 130 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {accessUsers.map(u => (
                    <Fragment key={u.id}>
                      <tr style={{ background: isExpanded(u.id) ? 'var(--bg)' : undefined }}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.displayName}</div>
                          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{u.email}</div>
                        </td>
                        <td>{accessSummary(u)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {u.id !== authUser.uid ? (
                              <>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setExpanded(isExpanded(u.id) ? null : { uid: u.id })}
                                >
                                  {isExpanded(u.id) ? 'Luk' : 'Ændr'}
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  disabled={removingId === u.id}
                                  onClick={() => removeAccess(u.id)}
                                >
                                  {removingId === u.id ? '…' : 'Fjern'}
                                </button>
                              </>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--text3)' }}>(dig selv)</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded(u.id) && (
                        <tr key={u.id + '-exp'}>
                          <PermissionsEditor user={u} />
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Invitation panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Send invitation */}
          <div className="card card-pad">
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Inviter ny bruger</h3>

            <form onSubmit={sendInvite} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="form-control"
                type="email"
                placeholder="bruger@email.dk"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteMsg(null) }}
                required
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, margin: '4px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="radio" checked={inviteType === 'superadmin'} onChange={() => setInviteType('superadmin')} />
                  Superadmin (fuld adgang)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="radio" checked={inviteType === 'custom'} onChange={() => setInviteType('custom')} />
                  Tilpasset — vælg sider
                </label>
              </div>

              {inviteType === 'custom' && (
                <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }}>
                  {PAGE_GROUP_ORDER.map(group => (
                    <div key={group} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text2)', letterSpacing: '.5px', marginBottom: 4 }}>{group}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {BACKOFFICE_PAGES.filter(p => p.group === group).map(p => (
                          <label key={p.id} className={`hold-check-label ${invitePerms.includes(p.id) ? 'selected' : ''}`}>
                            <input type="checkbox" checked={invitePerms.includes(p.id)} onChange={() => toggleInvitePerm(p.id)} />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {inviteMsg?.ok && (
                <div className="alert-info" style={{ fontSize: 12 }}>
                  Invitation oprettet.{inviteMsg.emailSent ? ' En email er sendt til modtageren.' : ' Email-afsendelse fejlede — del linket manuelt.'}
                </div>
              )}
              {inviteMsg && !inviteMsg.ok && (
                <div className="alert-error" style={{ fontSize: 12 }}>{inviteMsg.error}</div>
              )}

              <button
                className="btn btn-primary btn-sm"
                type="submit"
                disabled={inviting || (inviteType === 'custom' && invitePerms.length === 0)}
              >
                {inviting ? 'Sender…' : 'Send invitation'}
              </button>
            </form>
          </div>

          {/* Pending invitations */}
          {invites.length > 0 && (
            <div className="card">
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>
                Afventende invitationer ({invites.length})
              </div>
              {invites.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inv.email}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {inv.role === 'admin' ? 'Superadmin' : inv.permissions?.length > 0 ? `${inv.permissions.length} sider` : 'Redaktør'}
                    </div>
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => cancelInvite(inv.email)}
                  >
                    Slet
                  </button>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  )
}

// ─── Rich text editor (email-besked: fed, links, billeder) ───────────────────
function htmlToPlainText(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html || ''
  return (tmp.textContent || tmp.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
}

function ToolbarBtn({ active, onClick, title, children, disabled }) {
  return (
    <button type="button" title={title} disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      style={{
        minWidth: 30, height: 28, padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${active ? 'var(--green)' : 'var(--sep)'}`, borderRadius: 5,
        background: active ? 'var(--green-soft)' : 'white', color: active ? 'var(--green)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 13, flexShrink: 0,
      }}>
      {children}
    </button>
  )
}

function ToolbarSep() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--sep)', margin: '2px 2px' }} />
}

function RichTextEditor({ value, onChange, placeholder = '' }) {
  const fileInputRef           = useRef(null)
  const [uploading, setUploading]       = useState(false)
  const [error,     setError]           = useState('')
  const [linkPopover, setLinkPopover]   = useState(false)
  const [linkUrl,     setLinkUrl]       = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      TiptapImage,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: 'rich-text-editor form-control' },
    },
  })

  // Sæt indhold udefra (fx nulstilling efter afsendelse) uden at ødelægge
  // cursorpositionen mens brugeren skriver.
  useEffect(() => {
    if (!editor) return
    if (value !== editor.getHTML() && (value || editor.getText())) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [value, editor])

  function openLinkPopover() {
    setLinkUrl(editor?.getAttributes('link')?.href || 'https://')
    setLinkPopover(true)
  }

  function applyLink() {
    const url = linkUrl.trim()
    if (!url) {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setLinkPopover(false)
  }

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) { setError('Kun billedfiler tilladt'); return }
    if (file.size > 10 * 1024 * 1024)             { setError('Maks 10 MB'); return }
    setError(''); setUploading(true)
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const fd = new FormData()
      fd.append('image', file)
      fd.append('idToken', idToken)
      const res = await fetch('https://app.sejssvejbaek-if.dk/api/upload-image.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      })
      const data = await res.json()
      if (!data.url) throw new Error(data.error || 'Ukendt fejl')
      addDoc(collection(db, 'media_library'), {
        url: data.url, name: file.name, size: file.size, uploadedAt: serverTimestamp(),
      }).catch(() => {})
      editor.chain().focus().setImage({ src: data.url }).run()
    } catch (err) {
      setError('Billede-upload fejlede: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  if (!editor) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        <select
          value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'p'}
          onChange={e => {
            const v = e.target.value
            v === 'p' ? editor.chain().focus().setParagraph().run() : editor.chain().focus().toggleHeading({ level: Number(v) }).run()
          }}
          style={{ height: 28, fontSize: 12, border: '1px solid var(--sep)', borderRadius: 5, background: 'white', padding: '0 4px', flexShrink: 0 }}
        >
          <option value="p">Normal tekst</option>
          <option value="1">Overskrift 1</option>
          <option value="2">Overskrift 2</option>
          <option value="3">Overskrift 3</option>
        </select>
        <ToolbarSep />
        <ToolbarBtn title="Fed (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolbarBtn>
        <ToolbarBtn title="Kursiv (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarBtn>
        <ToolbarBtn title="Understreget (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarBtn>
        <ToolbarBtn title="Gennemstreget" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn title="Punktliste" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•≡</ToolbarBtn>
        <ToolbarBtn title="Nummereret liste" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1≡</ToolbarBtn>
        <ToolbarBtn title="Citat" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>"</ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn title="Venstrejuster" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>⟸</ToolbarBtn>
        <ToolbarBtn title="Centrer" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>⟺</ToolbarBtn>
        <ToolbarBtn title="Højrejuster" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>⟹</ToolbarBtn>
        <ToolbarSep />
        <ToolbarBtn title="Indsæt link" active={editor.isActive('link')} onClick={openLinkPopover}>🔗</ToolbarBtn>
        <ToolbarBtn title="Indsæt billede" onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? '…' : '🖼'}</ToolbarBtn>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = '' }} />
        <ToolbarSep />
        <ToolbarBtn title="Fortryd (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>↶</ToolbarBtn>
        <ToolbarBtn title="Gentag (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>↷</ToolbarBtn>
        <ToolbarBtn title="Ryd formatering" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>Tx</ToolbarBtn>
      </div>

      {linkPopover && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, padding: 8, background: '#f7f8f9', borderRadius: 7, border: '1px solid var(--sep)' }}>
          <input className="form-control" style={{ flex: 1, height: 30, fontSize: 12 }} autoFocus
            value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } if (e.key === 'Escape') setLinkPopover(false) }}
            placeholder="https://…" />
          <button type="button" className="btn btn-primary" style={{ height: 30, padding: '0 10px', fontSize: 12 }} onClick={applyLink}>Anvend</button>
          <button type="button" className="btn btn-ghost" style={{ height: 30, padding: '0 10px', fontSize: 12 }} onClick={() => setLinkPopover(false)}>Annuller</button>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 4 }}>{error}</div>}
      <EditorContent editor={editor} />
    </div>
  )
}

// ─── Kommunikation ────────────────────────────────────────────────────────────

function KommunikationPage({ authUser, userDoc }) {
  const [channel,    setChannel]    = useState('email') // 'email' | 'sms'
  const [sender,     setSender]     = useState('SSIF') // SMS afsender-ID
  const [subject,    setSubject]    = useState('')      // Email emne
  const [text,       setText]       = useState('')
  const [emailHtml,  setEmailHtml]  = useState('')       // Email-besked (rig tekst)
  const [scope,         setScope]         = useState('all') // 'all' | 'holds' | 'manual'
  const [manualInput,   setManualInput]   = useState('')
  const [selectedHolds, setSelectedHolds] = useState(new Map()) // Map<cid_string, 'all'|Set<memberId>>
  const [holdSearch,    setHoldSearch]    = useState('')
  const [expandedAfds,  setExpandedAfds]  = useState(new Set())
  const [pickerHoldId,  setPickerHoldId]  = useState(null)
  const [holdMembers,   setHoldMembers]   = useState({}) // { [cid]: member[] }
  const [loadingPicker, setLoadingPicker] = useState(null)
  const [afdelinger, setAfdelinger] = useState([])
  const [holds,      setHolds]      = useState([])
  const [preview,    setPreview]    = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [sending,    setSending]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState('')
  const [logs,       setLogs]       = useState([])
  const [logsLoading,setLogsLoading]= useState(true)
  const [confirm,    setConfirm]    = useState(false)

  useEffect(() => {
    getDocs(collection(db, 'afdelinger'))
      .then(s => setAfdelinger(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.navn||'').localeCompare(b.navn||'','da'))))
      .catch(() => {})
    getDocs(collection(db, 'holds'))
      .then(s => setHolds(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.titel||'').localeCompare(b.titel||'','da'))))
      .catch(() => {})
    loadLogs()
  }, [])

  function loadLogs() {
    getDocs(query(collection(db, 'kommunikation_logs'), orderBy('sentAt', 'desc'), limit(25)))
      .then(s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLogsLoading(false))
  }

  function switchChannel(ch) {
    setChannel(ch); setPreview(null); setResult(null); setError('')
    setPickerHoldId(null)
  }

  // ── Selection helpers ─────────────────────────────────────────────────────────
  const holdSearchQ      = holdSearch.toLowerCase()
  const afdIds           = new Set(afdelinger.map(a => String(a.id)))
  const holdsForAfd      = (afd) => holds.filter(h => String(h.afdeling_id) === String(afd.id))
  const holdMatchesSearch = h => !holdSearchQ || (h.titel||'').toLowerCase().includes(holdSearchQ)
  const afdMatchesSearch  = a => !holdSearchQ || (a.navn||'').toLowerCase().includes(holdSearchQ) || holdsForAfd(a).some(holdMatchesSearch)
  const orphanHolds       = holds.filter(h => !afdIds.has(String(h.afdeling_id ?? '')))

  function isHoldChecked(cid)   { return selectedHolds.has(cid) }
  function isHoldPartial(cid)   { const v = selectedHolds.get(cid); return v instanceof Set }
  function isAfdChecked(afd)    {
    const hs = holdsForAfd(afd).filter(holdMatchesSearch)
    return hs.length > 0 && hs.every(h => selectedHolds.has(String(h.conventus_id)))
  }
  function isAfdPartial(afd)    {
    const hs = holdsForAfd(afd).filter(holdMatchesSearch)
    return !isAfdChecked(afd) && hs.some(h => selectedHolds.has(String(h.conventus_id)))
  }

  function toggleHold(cid) {
    setSelectedHolds(prev => {
      const next = new Map(prev)
      next.has(cid) ? next.delete(cid) : next.set(cid, 'all')
      return next
    })
    setPreview(null)
  }

  function toggleAfd(afd) {
    const hs      = holdsForAfd(afd).filter(holdMatchesSearch)
    const checked = isAfdChecked(afd)
    setSelectedHolds(prev => {
      const next = new Map(prev)
      hs.forEach(h => {
        const cid = String(h.conventus_id)
        if (checked) next.delete(cid)
        else if (!next.has(cid)) next.set(cid, 'all')
      })
      return next
    })
    setPreview(null)
  }

  function setHoldSelection(cid, sel) {
    setSelectedHolds(prev => { const n = new Map(prev); n.set(cid, sel); return n })
    setPreview(null)
  }

  function removeHoldSelection(cid) {
    setSelectedHolds(prev => { const n = new Map(prev); n.delete(cid); return n })
    setPreview(null)
  }

  async function openPicker(holdCid) {
    setPickerHoldId(pickerHoldId === holdCid ? null : holdCid)
    if (!holdMembers[holdCid] && pickerHoldId !== holdCid) {
      setLoadingPicker(holdCid)
      try {
        const snap = await getDocs(
          query(collection(db, 'members'), where('holdIds', 'array-contains', holdCid))
        )
        const mems = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'))
        setHoldMembers(prev => ({ ...prev, [holdCid]: mems }))
      } catch {
        setHoldMembers(prev => ({ ...prev, [holdCid]: [] }))
      } finally { setLoadingPicker(null) }
    }
  }

  function toggleMemberInPicker(holdCid, memberId) {
    const current = selectedHolds.get(holdCid) ?? 'all'
    const allMemberIds = (holdMembers[holdCid] || []).map(m => m.id)
    let newSel
    if (current === 'all') {
      // Fra "alle" til specifikt valg: vælg KUN den klikkede (ikke alle minus én)
      newSel = new Set([memberId])
    } else {
      const next = new Set(current)
      next.has(memberId) ? next.delete(memberId) : next.add(memberId)
      // Hvis alle medlemmer nu er markeret → skift tilbage til 'all'
      newSel = allMemberIds.length > 0 && allMemberIds.every(id => next.has(id)) ? 'all' : next
    }
    setHoldSelection(holdCid, newSel)
  }

  function isMemberChecked(holdCid, memberId) {
    const sel = selectedHolds.get(holdCid)
    if (sel === 'all') return true
    if (sel instanceof Set) return sel.has(memberId)
    return false
  }

  // ── Scope / send helpers ──────────────────────────────────────────────────────
  function buildScopeLabel() {
    if (scope === 'all')    return 'Alle aktive'
    if (scope === 'manual') return 'Manuel'
    if (selectedHolds.size === 0) return 'Ingen valgt'
    return [...selectedHolds.entries()].map(([cid, sel]) => {
      const h = holds.find(x => String(x.conventus_id) === cid)
      const name = h?.titel || cid
      return sel instanceof Set ? `${name} (${sel.size})` : name
    }).join(', ')
  }

  function getHoldIds() {
    // Only holds selected with 'all' — backend fetches all their members
    return [...selectedHolds.entries()].filter(([, v]) => v === 'all').map(([cid]) => cid)
  }

  function getSpecificEmails() {
    const emails = new Set()
    for (const [holdCid, sel] of selectedHolds) {
      if (!(sel instanceof Set)) continue
      const mems = holdMembers[holdCid] || []
      for (const memberId of sel) {
        const m = mems.find(x => x.id === memberId)
        if (m?.email) emails.add(m.email.toLowerCase())
        ;(m?.allEmails || []).forEach(e => emails.add(e.toLowerCase()))
      }
    }
    return [...emails]
  }

  function getSpecificPhones() {
    const phones = new Set()
    for (const [holdCid, sel] of selectedHolds) {
      if (!(sel instanceof Set)) continue
      const mems = holdMembers[holdCid] || []
      for (const memberId of sel) {
        const m = mems.find(x => x.id === memberId)
        if (m?.mobil) phones.add(m.mobil)
      }
    }
    return [...phones]
  }

  const emailPlainText = channel === 'email' ? htmlToPlainText(emailHtml) : ''
  const canSend = (channel === 'email' ? !!emailPlainText : !!text.trim())
    && (scope === 'all'
        || (scope === 'holds' && selectedHolds.size > 0)
        || (scope === 'manual' && manualInput.trim()))
    && (channel === 'email' ? !!subject.trim() : true)

  // UCS-2 encoding ved emoji/ikke-GSM7-tegn — reducerer tegn pr. SMS fra 160 til 70
  const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜäöñüàÅ§¿abcdefghijklmnopqrstuvwxyz\t\x0b\x0c{}\\[~]|^€'
  const ucs2      = text.length > 0 && [...text].some(c => !GSM7.includes(c))
  const charCount = [...text].length
  const smsLimit  = ucs2 ? 70 : 160
  const smsCont   = ucs2 ? 67 : 153
  const smsParts  = charCount <= smsLimit ? 1 : Math.ceil(charCount / smsCont)
  const endpoint  = channel === 'sms' ? `${BASE}api/send-sms.php` : `${BASE}api/send-bulk-email.php`

  function buildBody(action) {
    const specificEmails = channel === 'email' ? getSpecificEmails() : []
    const specificPhones = channel === 'sms'   ? getSpecificPhones() : []
    const htmlSanitized  = channel === 'email' ? DOMPurify.sanitize(emailHtml, { ADD_ATTR: ['target'] }) : ''
    return JSON.stringify({
      action,
      scope:           scope === 'holds' ? 'gruppe' : scope,
      hold_ids:        getHoldIds(),
      specific_emails: specificEmails.length > 0 ? specificEmails : undefined,
      specific_phones: specificPhones.length > 0 ? specificPhones : undefined,
      scope_label:     buildScopeLabel(),
      sender:          sender.trim() || 'SSIF',
      subject:         subject.trim(),
      manual_input:    manualInput,
      text:            channel === 'email' ? htmlToPlainText(htmlSanitized) : text,
      html:            channel === 'email' ? htmlSanitized : undefined,
    })
  }

  async function fetchPreview() {
    setError(''); setPreview(null); setPreviewing(true)
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const res  = await fetch(endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: buildBody('preview') })
      const data = await res.json()
      if (data.error) { setError(data.error + (data.detail ? ` (${data.detail})` : '')); return null }
      setPreview(data); return data
    } catch (err) { setError('Netværksfejl: ' + err.message); return null }
    finally { setPreviewing(false) }
  }

  async function handleSendClick() {
    const hasMessage = channel === 'email' ? !!emailPlainText : !!text.trim()
    if (!hasMessage)                                { setError('Skriv en besked'); return }
    if (channel === 'email' && !subject.trim())    { setError('Skriv et emne'); return }
    if (scope === 'holds' && selectedHolds.size === 0) { setError('Vælg mindst ét hold'); return }
    if (scope === 'manual' && !manualInput.trim()) { setError('Indtast mindst ét telefonnummer'); return }
    const p = preview ?? await fetchPreview()
    if (p) setConfirm(true)
  }

  async function doSend() {
    setConfirm(false); setError(''); setResult(null); setSending(true)
    try {
      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const res  = await fetch(endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: buildBody('send') })
      const data = await res.json()
      if (data.error) { setError(data.error + (data.detail ? ` (${data.detail})` : '')); return }
      setResult(data)
      setText(''); setEmailHtml(''); setSubject(''); setSelectedHolds(new Map()); setPickerHoldId(null)
      setManualInput(''); setPreview(null)
      loadLogs()
    } catch (err) { setError('Netværksfejl: ' + err.message) }
    finally { setSending(false) }
  }

  // Aktivitetslog stats
  const smsLogs    = logs.filter(l => l.channel === 'sms')
  const now        = new Date()
  const totalSmsKr = smsLogs.reduce((s, l) => s + (l.actualCost != null ? l.actualCost : (l.estimatedCost ?? 0)), 0)
  const monthSmsKr = smsLogs.filter(l => { const d = l.sentAt?.toDate?.(); return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() })
                             .reduce((s, l) => s + (l.actualCost != null ? l.actualCost : (l.estimatedCost ?? 0)), 0)

  // ── Confirm dialog tekst ───────────────────────────────────────────────────────
  const confirmBody = channel === 'sms'
    ? `Send SMS til ${preview?.count ?? '?'} modtagere · estimeret ${preview?.estimatedCost ?? '?'} kr. (~0,29 kr./SMS)`
    : `Send email til ${preview?.count ?? '?'} modtagere via noreply@sejssvejbaek-if.dk`

  return (
    <>
      {confirm && (
        <ConfirmDialog title={channel === 'sms' ? 'Send SMS?' : 'Send email?'}
          body={confirmBody} onConfirm={doSend} onCancel={() => setConfirm(false)} danger />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>

        {/* ── Venstre: Compose ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Kanal-switcher */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#f1f3f5', borderRadius: 12, padding: 4, gap: 4 }}>
            {[
              { key: 'email', icon: 'mail', label: 'Email', sub: 'Via SMTP · gratis' },
              { key: 'sms',   icon: 'sms',  label: 'SMS',   sub: 'Via GatewayAPI · ~0,29 kr./SMS' },
            ].map(ch => (
              <button key={ch.key} onClick={() => switchChannel(ch.key)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
                background: channel === ch.key ? 'white' : 'transparent',
                boxShadow: channel === ch.key ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
                transition: 'all .15s',
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: channel === ch.key ? 'var(--green-soft)' : 'transparent', flexShrink: 0 }}>
                  <Icon name={ch.icon} size={17} color={channel === ch.key ? 'var(--green)' : 'var(--text3)'} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: channel === ch.key ? 700 : 500, color: channel === ch.key ? 'var(--text)' : 'var(--text2)' }}>{ch.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{ch.sub}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Compose-kort */}
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* SMS: afsender */}
            {channel === 'sms' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap', minWidth: 52 }}>Fra</span>
                <input className="form-control" style={{ flex: 1, height: 36, fontSize: 13, fontWeight: 600 }}
                  value={sender}
                  onChange={e => setSender(e.target.value.replace(/[^a-zA-Z0-9æøåÆØÅ ]/g, '').slice(0, 11))}
                  placeholder="SSIF" autoComplete="off" data-form-type="other" />
                <span style={{ fontSize: 11, color: sender.trim().length > 9 ? '#f59e0b' : 'var(--text3)', whiteSpace: 'nowrap' }}>{sender.trim().length}/11</span>
              </div>
            )}

            {/* Email: emne */}
            {channel === 'email' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap', minWidth: 52 }}>Emne</span>
                <input className="form-control" style={{ flex: 1, height: 36, fontSize: 13 }}
                  value={subject} onChange={e => { setSubject(e.target.value); setPreview(null) }}
                  placeholder="Skriv emne…" autoComplete="off" data-form-type="other" />
              </div>
            )}

            {/* Besked */}
            {channel === 'sms' ? (
              <textarea className="form-control" rows={5}
                style={{ resize: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6 }}
                placeholder="Skriv din SMS-besked…"
                value={text}
                onChange={e => { setText(e.target.value); setPreview(null); setResult(null) }}
                autoComplete="off" data-form-type="other" autoFocus
              />
            ) : (
              <RichTextEditor
                value={emailHtml}
                onChange={html => { setEmailHtml(html); setPreview(null); setResult(null) }}
                placeholder="Skriv din email-besked… (brug værktøjslinjen for fed tekst, links og billeder)"
              />
            )}

            {/* SMS-tæller */}
            {channel === 'sms' && text.length > 0 && (() => {
              const costPerRecipient = (smsParts * 0.29).toFixed(2)
              const overLimit = charCount > smsLimit
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ucs2 ? '#f59e0b' : overLimit ? '#f59e0b' : 'var(--text3)' }}>
                      {charCount}/{smsLimit}{ucs2 ? ' · emoji' : ''}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {smsParts} SMS-del{smsParts > 1 ? 'e' : ''} · ~{costPerRecipient} kr./modtager
                    </span>
                  </div>
                  {smsParts > 1 && (
                    <div style={{ padding: '6px 10px', background: '#fff8ed', border: '1px solid #fed7aa', borderRadius: 7, fontSize: 12, color: '#92400e', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span>⚠</span>
                      <span>
                        Beskeden splittes i <strong>{smsParts} SMS-dele</strong> pr. modtager
                        {ucs2 && ' (emoji kræver UCS-2 encoding — maks. 67 tegn pr. del)'}.
                        Pris: ~{costPerRecipient} kr. pr. modtager.
                      </span>
                    </div>
                  )}
                  {ucs2 && smsParts === 1 && (
                    <div style={{ padding: '5px 10px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 7, fontSize: 11, color: '#713f12' }}>
                      Emoji aktiverer UCS-2 encoding · maks. {smsLimit} tegn pr. SMS
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          {/* Modtagere */}
          <div className="card card-pad">
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Modtagere</p>

            {/* Kanal-tabs */}
            <div style={{ display: 'flex', background: '#f1f3f5', borderRadius: 8, padding: 3, gap: 3, marginBottom: 14 }}>
              {[
                { v: 'all',    l: 'Alle aktive' },
                { v: 'holds',  l: 'Vælg hold'   },
                ...(channel === 'sms' ? [{ v: 'manual', l: 'Manuelt nr.' }] : []),
              ].map(o => (
                <button key={o.v}
                  onClick={() => { setScope(o.v); setSelectedHolds(new Map()); setPickerHoldId(null); setPreview(null) }}
                  style={{ flex: 1, padding: '7px 0', fontSize: 13, fontWeight: scope === o.v ? 600 : 400,
                           background: scope === o.v ? 'white' : 'transparent', border: 'none', borderRadius: 6,
                           cursor: 'pointer', color: scope === o.v ? 'var(--text)' : 'var(--text2)',
                           boxShadow: scope === o.v ? '0 1px 3px rgba(0,0,0,.1)' : 'none', transition: 'all .15s' }}>
                  {o.l}
                </button>
              ))}
            </div>

            {/* Manuel input (SMS) */}
            {scope === 'manual' && channel === 'sms' && (
              <>
                <textarea className="form-control" rows={2}
                  style={{ fontFamily: 'monospace', fontSize: 13, resize: 'none' }}
                  placeholder="22391328, +4512345678, …  (komma, semikolon eller linjeskift)"
                  value={manualInput}
                  onChange={e => { setManualInput(e.target.value); setPreview(null) }}
                  autoComplete="off"
                />
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>Danske numre antages +45</p>
              </>
            )}

            {/* Hold-vælger */}
            {scope === 'holds' && (
              <>
                {/* Søgefelt */}
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
                    <Icon name="search" size={14} color="var(--text3)" />
                  </span>
                  <input className="form-control" style={{ paddingLeft: 32, height: 36, fontSize: 13 }}
                    placeholder="Søg afdeling eller hold…" value={holdSearch}
                    onChange={e => setHoldSearch(e.target.value)} autoComplete="off" />
                </div>

                {/* Valgte hold-chips */}
                {selectedHolds.size > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {[...selectedHolds.entries()].map(([cid, sel]) => {
                      const h    = holds.find(x => String(x.conventus_id) === cid)
                      const name = h?.titel || cid
                      const label = sel instanceof Set ? `${name} (${sel.size} valgt)` : name
                      return (
                        <span key={cid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#dcfce7', borderRadius: 5, padding: '2px 6px 2px 8px', fontSize: 11, fontWeight: 600, color: 'var(--green)' }}>
                          {label}
                          <button onClick={() => removeHoldSelection(cid)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', display: 'flex', color: 'var(--green)', opacity: .7, lineHeight: 1 }}>
                            ✕
                          </button>
                        </span>
                      )
                    })}
                    {selectedHolds.size > 1 && (
                      <button onClick={() => { setSelectedHolds(new Map()); setPreview(null) }}
                        style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: '1px solid var(--sep)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}>
                        Ryd alt
                      </button>
                    )}
                  </div>
                )}

                {/* Accordion */}
                <div style={{ borderRadius: 10, border: '1px solid var(--sep)', overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
                  {afdelinger.filter(afdMatchesSearch).map((afd, idx) => {
                    const afdHolds   = holdsForAfd(afd).filter(holdMatchesSearch)
                    const isExpanded = !expandedAfds.has(afd.id) // åben som standard, klik kollapser
                    const afdChk     = isAfdChecked(afd)
                    const afdPart    = isAfdPartial(afd)
                    return (
                      <div key={afd.id} style={{ borderBottom: '1px solid var(--sep)' }}>
                        {/* Afdeling-header */}
                        <div style={{ display: 'flex', alignItems: 'center', background: afdChk ? 'var(--green-soft)' : idx % 2 === 0 ? 'white' : '#fafafa' }}>
                          <div style={{ padding: '10px 4px 10px 12px', display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox"
                              checked={afdChk}
                              ref={el => { if (el) el.indeterminate = !afdChk && afdPart }}
                              onChange={() => toggleAfd(afd)}
                              style={{ accentColor: 'var(--green)', width: 15, height: 15 }}
                            />
                          </div>
                          <button
                            onClick={() => setExpandedAfds(p => { const n = new Set(p); n.has(afd.id) ? n.delete(afd.id) : n.add(afd.id); return n })}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 14px 10px 6px', background: 'none', border: 'none', cursor: 'pointer' }}>
                            <div style={{ width: 28, height: 28, borderRadius: 6, background: afdChk ? 'var(--green)' : '#ebebeb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Icon name="users" size={13} color={afdChk ? 'white' : 'var(--text3)'} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: afdChk ? 'var(--green)' : 'var(--text)' }}>{afd.navn}</div>
                              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{holdsForAfd(afd).length} hold</div>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                          </button>
                        </div>

                        {/* Hold-rækker */}
                        {isExpanded && afdHolds.map(h => {
                          const cid        = String(h.conventus_id)
                          const chk        = isHoldChecked(cid)
                          const partial    = isHoldPartial(cid)
                          const partialCnt = partial ? selectedHolds.get(cid).size : 0
                          const pickerOpen = pickerHoldId === cid
                          return (
                            <div key={h.id}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px 7px 36px', background: chk ? '#f0fdf4' : '#f7f8f9', borderTop: '1px solid var(--sep)' }}>
                                <input type="checkbox" checked={chk} onChange={() => toggleHold(cid)}
                                  style={{ accentColor: 'var(--green)', width: 14, height: 14, flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: 13, color: chk ? 'var(--green)' : 'var(--text)', fontWeight: chk ? 600 : 400 }}>{h.titel}</span>
                                {partial && <span style={{ fontSize: 10, color: 'var(--green)', background: '#dcfce7', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>{partialCnt} valgt</span>}
                                {chk && !partial && <span style={{ fontSize: 10, color: 'var(--green)', flexShrink: 0 }}>Alle</span>}
                                <button onClick={() => openPicker(cid)}
                                  style={{ fontSize: 11, color: pickerOpen ? 'var(--green)' : 'var(--text3)', background: pickerOpen ? '#dcfce7' : 'transparent', border: `1px solid ${pickerOpen ? 'var(--green)' : 'var(--sep)'}`, borderRadius: 4, padding: '2px 7px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                  Modtagere {pickerOpen ? '▲' : '▼'}
                                </button>
                              </div>

                              {/* Member picker */}
                              {pickerOpen && (
                                <div style={{ background: 'white', borderTop: '1px solid var(--sep)', padding: '10px 12px 10px 52px' }}>
                                  {loadingPicker === cid ? (
                                    <div className="loading-dots"><span/><span/><span/></div>
                                  ) : !holdMembers[cid] || holdMembers[cid].length === 0 ? (
                                    <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
                                      {holdMembers[cid] ? 'Ingen medlemmer fundet i dette hold.' : 'Henter…'}
                                    </p>
                                  ) : (
                                    <>
                                      {/* "Alle" toggle */}
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', paddingBottom: 8, borderBottom: '1px solid var(--sep)' }}>
                                        <input type="checkbox"
                                          checked={selectedHolds.get(cid) === 'all' || !selectedHolds.has(cid)}
                                          onChange={() => {
                                            if (selectedHolds.get(cid) === 'all' || !selectedHolds.has(cid)) {
                                              // Fra "alle" til specifikt valg: start tom, så brugeren selv vælger
                                              setHoldSelection(cid, new Set())
                                            } else {
                                              setHoldSelection(cid, 'all')
                                            }
                                          }}
                                          style={{ accentColor: 'var(--green)', width: 14, height: 14 }}
                                        />
                                        <span style={{ fontSize: 12, fontWeight: 700 }}>Alle i holdet ({holdMembers[cid].length})</span>
                                      </label>

                                      {/* Individual members */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                                        {holdMembers[cid].map(m => (
                                          <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                                            <input type="checkbox"
                                              checked={isMemberChecked(cid, m.id)}
                                              onChange={() => toggleMemberInPicker(cid, m.id)}
                                              style={{ accentColor: 'var(--green)', width: 13, height: 13, flexShrink: 0 }}
                                            />
                                            <span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span>
                                            {channel === 'sms'
                                              ? (m.mobil && <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{m.mobil}</span>)
                                              : (m.email && <span style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, whiteSpace: 'nowrap' }}>{m.email}</span>)
                                            }
                                          </label>
                                        ))}
                                      </div>

                                      {/* Quick actions */}
                                      <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--sep)' }}>
                                        <button onClick={() => setHoldSelection(cid, 'all')} style={{ fontSize: 11, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Vælg alle</button>
                                        <button onClick={() => setHoldSelection(cid, new Set())} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Fravælg alle</button>
                                        <button onClick={() => setPickerHoldId(null)} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>Luk ▲</button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}

                  {/* Orphan holds (no afdeling) */}
                  {orphanHolds.filter(holdMatchesSearch).length > 0 && (
                    <div style={{ borderBottom: '1px solid var(--sep)' }}>
                      <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', background: '#fafafa' }}>Andre hold</div>
                      {orphanHolds.filter(holdMatchesSearch).map(h => {
                        const cid     = String(h.conventus_id)
                        const chk     = isHoldChecked(cid)
                        const partial = isHoldPartial(cid)
                        const pickerOpen = pickerHoldId === cid
                        return (
                          <div key={h.id}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: chk ? '#f0fdf4' : 'white', borderTop: '1px solid var(--sep)' }}>
                              <input type="checkbox" checked={chk} onChange={() => toggleHold(cid)}
                                style={{ accentColor: 'var(--green)', width: 14, height: 14, flexShrink: 0 }} />
                              <span style={{ flex: 1, fontSize: 13, color: chk ? 'var(--green)' : 'var(--text)', fontWeight: chk ? 600 : 400 }}>{h.titel}</span>
                              {partial && <span style={{ fontSize: 10, color: 'var(--green)', background: '#dcfce7', padding: '1px 5px', borderRadius: 3 }}>{selectedHolds.get(cid).size} valgt</span>}
                              <button onClick={() => openPicker(cid)}
                                style={{ fontSize: 11, color: pickerOpen ? 'var(--green)' : 'var(--text3)', background: pickerOpen ? '#dcfce7' : 'transparent', border: `1px solid ${pickerOpen ? 'var(--green)' : 'var(--sep)'}`, borderRadius: 4, padding: '2px 7px', cursor: 'pointer' }}>
                                Modtagere {pickerOpen ? '▲' : '▼'}
                              </button>
                            </div>
                            {pickerOpen && (
                              <div style={{ background: 'white', borderTop: '1px solid var(--sep)', padding: '10px 12px 10px 36px' }}>
                                {loadingPicker === cid ? <div className="loading-dots"><span/><span/><span/></div>
                                  : !holdMembers[cid] || holdMembers[cid].length === 0
                                  ? <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Ingen medlemmer fundet.</p>
                                  : (
                                    <>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', paddingBottom: 8, borderBottom: '1px solid var(--sep)', fontSize: 12, fontWeight: 700 }}>
                                        <input type="checkbox" checked={selectedHolds.get(cid) === 'all' || !selectedHolds.has(cid)}
                                          onChange={() => setHoldSelection(cid, (selectedHolds.get(cid) === 'all' || !selectedHolds.has(cid)) ? new Set() : 'all')}
                                          style={{ accentColor: 'var(--green)', width: 14, height: 14 }} />
                                        Alle ({holdMembers[cid].length})
                                      </label>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                                        {holdMembers[cid].map(m => (
                                          <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                                            <input type="checkbox" checked={isMemberChecked(cid, m.id)} onChange={() => toggleMemberInPicker(cid, m.id)}
                                              style={{ accentColor: 'var(--green)', width: 13, height: 13, flexShrink: 0 }} />
                                            <span style={{ flex: 1 }}>{m.name}</span>
                                            {channel === 'sms'
                                              ? (m.mobil && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{m.mobil}</span>)
                                              : (m.email && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{m.email}</span>)
                                            }
                                          </label>
                                        ))}
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--sep)' }}>
                                        <button onClick={() => setHoldSelection(cid, 'all')} style={{ fontSize: 11, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Vælg alle</button>
                                        <button onClick={() => setHoldSelection(cid, new Set())} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Fravælg alle</button>
                                        <button onClick={() => setPickerHoldId(null)} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>Luk ▲</button>
                                      </div>
                                    </>
                                  )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {holds.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Indlæser…</div>}
                  {holds.length > 0 && afdelinger.filter(afdMatchesSearch).length === 0 && orphanHolds.filter(holdMatchesSearch).length === 0 && (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Ingen resultater for "{holdSearch}"</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Feedback + preview */}
          {error  && <div className="alert-error">{error}</div>}
          {result && (
            <div className="alert-success">
              {channel === 'sms'
                ? `✓ SMS sendt til ${result.sent} modtagere · ${result.cost}`
                : `✓ Email sendt til ${result.sent} modtagere${result.failed > 0 ? ` · ${result.failed} fejlede` : ''}`}
            </div>
          )}
          {result?.errorSamples?.length > 0 && (
            <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#9a3412' }}>
              <strong>SMTP-fejl fra serveren (årsag til fejlede leveringer):</strong>
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {result.errorSamples.map((e, i) => <li key={i} style={{ fontFamily: 'monospace' }}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* Debug-panel: vises kun når count=0 og der er debug-data */}
          {preview && preview.count === 0 && preview.debug && !error && (
            <div style={{ background: '#fafafa', border: '1px solid var(--sep)', borderRadius: 10, padding: '14px 16px', fontSize: 12 }}>
              <p style={{ fontWeight: 700, marginBottom: 10, color: 'var(--text2)' }}>🔍 Ingen modtagere fundet — diagnostik</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: preview.debug.conventus_ok ? 'var(--green)' : '#dc2626', fontWeight: 700 }}>
                    {preview.debug.conventus_ok ? '✓' : '✗'}
                  </span>
                  <span>
                    {preview.debug.conventus_ok
                      ? `Conventus svarede — ${preview.debug.conventus_fetched} aktive membres fundet`
                      : 'Conventus API svarede ikke (timeout eller nøglefejl)'}
                  </span>
                </div>
                {preview.debug.conventus_ok && (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text3)', minWidth: 16 }}>→</span>
                      <span>Hold-ID sendt til server: <code style={{ background: '#f0f0f0', padding: '1px 5px', borderRadius: 4 }}>{JSON.stringify(preview.debug.hold_ids_received)}</code></span>
                    </div>
                    {preview.debug.sample_groups?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <p style={{ color: 'var(--text3)', marginBottom: 4 }}>
                          Gruppe-IDs fra de første {preview.debug.sample_groups.length} membres i Conventus:
                        </p>
                        {preview.debug.sample_groups.map((s, i) => (
                          <div key={i} style={{ padding: '4px 8px', background: '#f5f5f5', borderRadius: 5, marginBottom: 3, fontFamily: 'monospace', fontSize: 11 }}>
                            Medlem {i + 1}: [{s.groups?.join(', ') || 'ingen'}]
                          </div>
                        ))}
                        <p style={{ marginTop: 6, color: '#dc2626', fontSize: 11 }}>
                          Kontrollér at et af disse IDs matcher det sendte hold-ID ovenfor.
                          Matcher ingen → hold-ID'et i Firestore stemmer ikke overens med Conventus-gruppen.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {preview && !error && (
            <div style={{ display: 'flex', gap: 12, padding: '14px 18px', background: preview.count > 0 ? '#f0fdf4' : '#fafafa', borderRadius: 10, border: `1px solid ${preview.count > 0 ? '#bbf7d0' : 'var(--sep)'}` }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)', lineHeight: 1 }}>{preview.count}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>modtagere</div>
              </div>
              {channel === 'sms' && preview.estimatedCost != null && <>
                <div style={{ width: 1, background: 'var(--sep)' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b', lineHeight: 1 }}>{preview.estimatedCost} kr.</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>estimeret</div>
                </div>
                <div style={{ width: 1, background: 'var(--sep)' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{preview.parts}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                    SMS-{preview.parts > 1 ? 'dele' : 'del'}
                    {preview.ucs2 && <span style={{ color: '#f59e0b', display: 'block' }}>emoji/UCS-2</span>}
                  </div>
                </div>
              </>}
            </div>
          )}

          {/* Send-handlinger */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={async () => { if (!text.trim()) { setError('Skriv en besked'); return } if (channel === 'email' && !subject.trim()) { setError('Skriv et emne'); return } if (scope === 'gruppe' && !scopeId) { setError('Vælg modtagergruppe'); return } await fetchPreview() }} disabled={previewing || sending || !canSend} style={{ flex: 1 }}>
              {previewing ? 'Henter fra Conventus…' : 'Beregn modtagere'}
            </button>
            <button className="btn btn-primary" onClick={handleSendClick} disabled={sending || previewing || !canSend} style={{ flex: 1, fontWeight: 700 }}>
              {sending ? 'Sender…'
               : preview ? (channel === 'sms' ? `Send SMS til ${preview.count} · ~${preview.estimatedCost} kr.` : `Send email til ${preview.count}`)
               : (channel === 'sms' ? 'Send SMS' : 'Send email')}
            </button>
          </div>
        </div>

        {/* ── Højre: Aktivitetslog ── */}
        <div className="card card-pad">
          {/* SMS-forbrug */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>SMS-forbrug</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {[{ label: 'I alt', val: totalSmsKr }, { label: 'Denne måned', val: monthSmsKr }].map(s => (
              <div key={s.label} style={{ background: '#f8f9fa', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{s.val.toFixed(2)} kr.</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Seneste udsendelser</p>
          {logsLoading ? (
            <div className="loading-dots"><span/><span/><span/></div>
          ) : logs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: '16px 0' }}>Ingen beskeder sendt endnu</p>
          ) : (
            <div>
              {logs.slice(0, 10).map(l => {
                const isSms  = l.channel === 'sms'
                const cost   = isSms ? (l.actualCost != null ? `${(l.actualCost).toFixed(2)} kr.` : l.estimatedCost != null ? `~${l.estimatedCost.toFixed(2)} kr.` : null) : null
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--sep)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: l.ok !== false ? 'var(--green-soft)' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: l.ok !== false ? 'var(--green)' : '#dc2626' }}>
                      {(l.senderName || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.senderName || '–'}</span>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: isSms ? '#e0f2fe' : '#f0fdf4', color: isSms ? '#0369a1' : 'var(--green)', fontWeight: 600, flexShrink: 0 }}>
                          {isSms ? 'SMS' : 'Email'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {l.recipients ?? '?'} modtagere · {formatDate(l.sentAt)}
                        {cost && <span style={{ color: '#f59e0b', fontWeight: 600, marginLeft: 5 }}>· {cost}</span>}
                      </div>
                      {(l.failed > 0) && <div style={{ fontSize: 11, color: '#dc2626' }}>{l.failed} fejlede</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, lineHeight: 1.5 }}>~0,29 kr./SMS via GatewayAPI · Email gratis via SMTP</p>
        </div>
      </div>

      {/* ── Historik-tabel ── */}
      {logs.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Historik</p>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tidspunkt</th>
                    <th>Afsender</th>
                    <th>Kanal</th>
                    <th style={{ textAlign: 'right' }}>Modtagere</th>
                    <th>Modtagergruppe</th>
                    <th>Besked / Emne</th>
                    <th style={{ textAlign: 'right' }}>Pris</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => {
                    const isSms = l.channel === 'sms'
                    const cost  = isSms ? (l.actualCost != null ? `${(l.actualCost).toFixed(2)} kr.` : l.estimatedCost != null ? `~${l.estimatedCost.toFixed(2)} kr.` : '–') : '–'
                    return (
                      <tr key={l.id}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{formatDate(l.sentAt)}</td>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{l.senderName || '–'}</td>
                        <td><span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: isSms ? '#e0f2fe' : '#f0fdf4', color: isSms ? '#0369a1' : 'var(--green)', fontWeight: 700 }}>{isSms ? 'SMS' : 'Email'}</span></td>
                        <td style={{ fontSize: 13, textAlign: 'right' }}>{l.recipients ?? '–'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{l.scope || '–'}</td>
                        <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }} title={l.subject || l.text}>{l.subject ? `[${l.subject}] ` : ''}{l.text}</td>
                        <td style={{ fontSize: 12, textAlign: 'right', fontWeight: 600, color: '#f59e0b' }}>{cost}</td>
                        <td><span className={`badge ${l.ok !== false ? 'badge-green' : 'badge-red'}`}>{l.ok !== false ? 'Sendt' : 'Fejl'}</span></td>
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


// ─── Support Page ─────────────────────────────────────────────────────────────

const SUPPORT_CATEGORIES = ['Login', 'Hold', 'Notifikationer', 'Beskeder', 'Andet']
const SUPPORT_FILTERS    = [
  { id: 'afventer', label: 'Afventer' },
  { id: 'besvaret', label: 'Besvaret' },
  { id: 'faq',      label: 'FAQ'      },
  { id: 'alle',     label: 'Alle'     },
]

function SupportPage({ authUser }) {
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [filter,     setFilter]     = useState('afventer')
  const [expandedId, setExpandedId] = useState(null)
  const [answerDraft, setAnswerDraft] = useState({})
  const [saving,     setSaving]     = useState(null)

  function load() {
    setLoading(true)
    getDocs(query(collection(db, 'support'), orderBy('createdAt', 'desc')))
      .then(snap => {
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const counts = {
    afventer: items.filter(i => i.status === 'afventer').length,
    besvaret: items.filter(i => i.status === 'besvaret').length,
    faq:      items.filter(i => i.status === 'faq').length,
    alle:     items.length,
  }
  const filtered = filter === 'alle' ? items : items.filter(i => i.status === filter)

  async function handleAnswer(item) {
    const answer = (answerDraft[item.id] || '').trim()
    if (!answer) return
    setSaving(item.id)
    try {
      await updateDoc(doc(db, 'support', item.id), {
        answer,
        status:     'besvaret',
        answeredAt: serverTimestamp(),
        answeredBy: authUser.email,
      })
      load()
      setExpandedId(null)
    } catch { alert('Fejl ved lagring') }
    setSaving(null)
  }

  async function setStatus(item, status) {
    try {
      await updateDoc(doc(db, 'support', item.id), { status })
      load()
    } catch { alert('Fejl') }
  }

  async function handleDelete(item) {
    if (!window.confirm('Slet dette spørgsmål? Det kan ikke fortrydes.')) return
    try {
      await deleteDoc(doc(db, 'support', item.id))
      load()
    } catch { alert('Fejl') }
  }

  const statusColor = { afventer: '#b45309', besvaret: '#15803d', faq: '#1d4ed8' }
  const statusBg    = { afventer: '#fef3c7', besvaret: '#dcfce7', faq: '#dbeafe' }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Support</h1>
        <button onClick={load} className="btn btn-ghost btn-sm">↻ Opdater</button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUPPORT_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 13,
              background: filter === f.id ? '#1a5c2a' : '#f3f4f6',
              color:      filter === f.id ? 'white'    : '#374151',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {f.label}
            {counts[f.id] > 0 && (
              <span style={{
                background: filter === f.id ? 'rgba(255,255,255,.25)' : '#d1d5db',
                color:      filter === f.id ? 'white' : '#6b7280',
                borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700,
              }}>
                {counts[f.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? <LoadingScreen /> : filtered.length === 0 ? (
        <EmptyState icon="message" text="Ingen spørgsmål i denne kategori" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(item => (
            <div key={item.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                    background: statusBg[item.status] || '#f3f4f6',
                    color:      statusColor[item.status] || '#6b7280',
                    textTransform: 'uppercase', letterSpacing: '.3px',
                  }}>
                    {item.status}
                  </span>
                  <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{formatDate(item.createdAt)}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 4, lineHeight: 1.4 }}>
                  {item.question}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  {item.name} · {item.email} · <span style={{ fontWeight: 600, color: '#6b7280' }}>{item.category}</span>
                </div>
              </div>

              {/* Existing answer */}
              {item.answer && (
                <div style={{ padding: '10px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 4 }}>SVAR</div>
                  <div style={{ fontSize: 14, color: '#166534', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.answer}</div>
                </div>
              )}

              {/* Answer form (expanded) */}
              {expandedId === item.id && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
                  <textarea
                    className="form-control"
                    rows={4}
                    placeholder={item.answer ? 'Rediger svar…' : 'Skriv svar til brugeren…'}
                    value={answerDraft[item.id] ?? (item.answer || '')}
                    onChange={e => setAnswerDraft(prev => ({ ...prev, [item.id]: e.target.value }))}
                    style={{ marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={saving === item.id || !(answerDraft[item.id] || '').trim()}
                      onClick={() => handleAnswer(item)}
                    >
                      {saving === item.id ? 'Gemmer…' : '✓ Gem svar'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpandedId(null)}>Annuller</button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ padding: '10px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  {item.answer ? 'Rediger svar' : 'Besvar'}
                </button>
                {item.status !== 'faq' && item.answer && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setStatus(item, 'faq')}>
                    ★ Marker som FAQ
                  </button>
                )}
                {item.status === 'faq' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setStatus(item, 'besvaret')}>
                    Fjern fra FAQ
                  </button>
                )}
                {item.status === 'afventer' && item.answer && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setStatus(item, 'besvaret')}>
                    Marker besvaret
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto', color: '#dc3545' }}
                  onClick={() => handleDelete(item)}
                >
                  Slet
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Infoskærme ───────────────────────────────────────────────────────────────

const INFOSCREEN_BASE_URL = 'https://sejssvejbaek-if.dk/app/infoscreen/?s='

const BLOCK_DEFS = [
  { type: 'events',    label: 'Begivenheder', icon: '📅', desc: 'Live liste over kommende begivenheder' },
  { type: 'news',      label: 'Nyheder',      icon: '📰', desc: 'Seneste nyheder fra SSIF' },
  { type: 'image',     label: 'Billede',       icon: '🖼',  desc: 'Foto, logo eller grafik' },
  { type: 'text',      label: 'Tekst',         icon: '✏️', desc: 'Fritekst med valgfri styling' },
  { type: 'countdown', label: 'Nedtælling',    icon: '⏱',  desc: 'Dage til en bestemt dato' },
  { type: 'embed',     label: 'Indlejring',    icon: '🌐', desc: 'URL, iframe-widget eller HTML/JS-script' },
]

const SLIDE_LAYOUTS = [
  { id: 'full',       label: 'Fuld',        slots: 1 },
  { id: 'top-bottom', label: 'Top / bund',  slots: 2 },
  { id: 'left-right', label: 'Side / side', slots: 2 },
  { id: 'zones',      label: 'Zoner',       slots: Infinity },
]

function isUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function defaultBlock(type) {
  const id = isUid()
  switch (type) {
    case 'events':    return { id, type, holdIds: [] }
    case 'news':      return { id, type }
    case 'image':     return { id, type, url: '', fit: 'cover' }
    case 'text':      return { id, type, text: '', fontSize: 64, color: '#ffffff', bold: false, italic: false, align: 'center' }
    case 'countdown': return { id, type, label: 'Dage til', targetDate: '' }
    case 'embed':     return { id, type, mode: 'iframe', src: '', html: '', bg: '#000000' }
    default:          return { id, type }
  }
}

function blankSlide() {
  return {
    id: isUid(), duration: 15, layout: 'full', blocks: [],
    bgColor: '', bgImageUrl: '',
    schedule: { enabled: false, days: [], timeFrom: '', timeTo: '' },
    zones: [],
  }
}

function BlockEditor({ block, onChange, holds }) {
  if (block.type === 'news') return (
    <p style={{ fontSize: 12, color: 'var(--text3)' }}>Viser automatisk de seneste 4 nyheder — ingen indstillinger.</p>
  )
  if (block.type === 'events') return (
    <>
      <label className="form-label">Hold-filter <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(tomt = alle)</span></label>
      {holds.length === 0
        ? <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Ingen aktive hold fundet</p>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
            {holds.map(h => {
              const sid = String(h.conventus_id)
              const on  = (block.holdIds || []).includes(sid)
              return (
                <label key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: on ? 'var(--green-soft,#f0fdf4)' : 'transparent' }}>
                  <input type="checkbox" checked={on} style={{ accentColor: 'var(--green)' }}
                    onChange={() => onChange({ holdIds: on ? block.holdIds.filter(x => x !== sid) : [...(block.holdIds || []), sid] })} />
                  <span style={{ fontSize: 13, color: on ? 'var(--green)' : 'var(--text)', fontWeight: on ? 600 : 400 }}>{h.titel}</span>
                </label>
              )
            })}
          </div>
      }
    </>
  )
  if (block.type === 'image') return (
    <>
      <ImageUploader value={block.url} onChange={url => onChange({ url })} hint="Anbefalet 1920×1080 · maks 10 MB" />
      <input className="form-control" type="url" value={block.url}
        onChange={e => onChange({ url: e.target.value })}
        placeholder="https://…" style={{ marginTop: 8, marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        {[['cover', 'Udfyld'], ['contain', 'Tilpas']].map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange({ fit: v })}
            style={{ padding: '5px 14px', borderRadius: 6, border: '1.5px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderColor: (block.fit || 'cover') === v ? 'var(--green)' : 'var(--border)',
              background:  (block.fit || 'cover') === v ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)',
              color:       (block.fit || 'cover') === v ? 'var(--green)' : 'var(--text2)' }}>{l}</button>
        ))}
      </div>
    </>
  )
  if (block.type === 'text') return (
    <>
      <textarea className="form-control" rows={3} value={block.text}
        onChange={e => onChange({ text: e.target.value })}
        placeholder="Skriv din tekst…" style={{ marginBottom: 10, resize: 'vertical' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
          Størrelse
          <input type="number" min={12} max={200} value={block.fontSize || 64}
            onChange={e => onChange({ fontSize: parseInt(e.target.value) || 64 })}
            className="form-control" style={{ width: 68, marginLeft: 4 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
          Farve
          <input type="color" value={block.color || '#ffffff'}
            onChange={e => onChange({ color: e.target.value })}
            style={{ width: 36, height: 28, padding: 2, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['bold', 'B'], ['italic', 'I']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => onChange({ [k]: !block[k] })}
              style={{ padding: '4px 9px', borderRadius: 6, border: '1.5px solid', fontSize: 13,
                fontWeight: k === 'bold' ? 800 : 400, fontStyle: k === 'italic' ? 'italic' : 'normal', cursor: 'pointer',
                borderColor: block[k] ? 'var(--green)' : 'var(--border)',
                background:  block[k] ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)',
                color:       block[k] ? 'var(--green)' : 'var(--text2)' }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['left', '←'], ['center', '↔'], ['right', '→']].map(([a, ic]) => (
            <button key={a} type="button" onClick={() => onChange({ align: a })}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1.5px solid', fontSize: 12, cursor: 'pointer',
                borderColor: (block.align || 'center') === a ? 'var(--green)' : 'var(--border)',
                background:  (block.align || 'center') === a ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)',
                color:       (block.align || 'center') === a ? 'var(--green)' : 'var(--text2)' }}>{ic}</button>
          ))}
        </div>
      </div>
    </>
  )
  if (block.type === 'countdown') return (
    <>
      <div className="form-group">
        <label className="form-label">Label</label>
        <input className="form-control" value={block.label || ''}
          onChange={e => onChange({ label: e.target.value })}
          placeholder="fx Dage til sæsonstart" />
      </div>
      <div className="form-group" style={{ marginTop: 10 }}>
        <label className="form-label">Dato</label>
        <input type="date" className="form-control" value={block.targetDate || ''}
          onChange={e => onChange({ targetDate: e.target.value })} />
      </div>
    </>
  )
  if (block.type === 'embed') return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['iframe', '🔗 URL / iframe'], ['html', '💻 HTML / JavaScript']].map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange({ mode: v })}
            style={{ padding: '5px 14px', borderRadius: 6, border: '1.5px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderColor: (block.mode || 'iframe') === v ? 'var(--green)' : 'var(--border)',
              background:  (block.mode || 'iframe') === v ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)',
              color:       (block.mode || 'iframe') === v ? 'var(--green)' : 'var(--text2)' }}>{l}</button>
        ))}
      </div>
      {(block.mode || 'iframe') === 'iframe' ? (
        <div className="form-group">
          <label className="form-label">URL</label>
          <input className="form-control" type="url" value={block.src || ''}
            onChange={e => onChange({ src: e.target.value })} placeholder="https://…" />
          <p className="form-hint">Understøtter de fleste widgets og embeds der tillader iframe</p>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label">HTML / JavaScript</label>
          <textarea className="form-control" rows={8} value={block.html || ''}
            onChange={e => onChange({ html: e.target.value })}
            placeholder={'<div id="widget"></div>\n<script>\n  // Hent data og vis det her\n  document.getElementById(\'widget\').textContent = \'Hej!\'\n</script>'}
            style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
          <p className="form-hint">Kører isoleret — kan bruge &lt;script&gt;, fetch() og eksterne CDN-biblioteker</p>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Baggrund</label>
        <input type="color" value={block.bg || '#000000'}
          onChange={e => onChange({ bg: e.target.value })}
          style={{ width: 36, height: 28, padding: 2, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
        <input className="form-control" value={block.bg || '#000000'}
          onChange={e => onChange({ bg: e.target.value })} style={{ width: 90 }} placeholder="#000000" />
      </div>
    </>
  )
  return null
}

function migrateScreen(sc) {
  if (sc.slides) return sc
  const slides = []
  if (sc.mode === 'image') {
    const urls = sc.imageUrls?.length ? sc.imageUrls : (sc.imageUrl ? [sc.imageUrl] : [])
    for (const url of urls) {
      slides.push({ id: isUid(), duration: sc.duration || 15, layout: 'full', blocks: [{ id: isUid(), type: 'image', url, fit: 'cover' }] })
    }
  } else {
    for (const tpl of (sc.templates || ['events'])) {
      const slide = { id: isUid(), duration: sc.duration || 15, layout: 'full', blocks: [] }
      if (tpl === 'events')       slide.blocks.push({ id: isUid(), type: 'events', holdIds: sc.holdIds || [] })
      else if (tpl === 'news')    slide.blocks.push({ id: isUid(), type: 'news' })
      else if (tpl === 'custom')  slide.blocks.push(...(sc.customBlocks || []).map(b => ({ ...b, id: isUid() })))
      slides.push(slide)
    }
  }
  return {
    ...sc,
    header: { text: sc.headerText || '', logoUrl: sc.headerLogoUrl || '', bgColor: sc.headerBgColor || '#1a5c2a', textColor: '#ffffff' },
    slides,
  }
}

function BgImageLibraryBtn({ value, onSelect }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button"
        onClick={() => setOpen(true)}
        style={{ padding: '0 12px', borderRadius: 6, border: '1px solid var(--border)', background: value ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)', cursor: 'pointer', fontSize: 12, color: value ? 'var(--green)' : 'var(--text2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        📚 Bibliotek
      </button>
      {open && (
        <MediaLibraryPicker
          onSelect={url => { onSelect(url); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function InfoScreensPage({ authUser }) {
  const [screens,       setScreens]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [holds,         setHolds]         = useState([])
  const [editor,        setEditor]        = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [deleting,      setDeleting]      = useState(null)
  const [copied,        setCopied]        = useState(null)
  const [pushing,       setPushing]       = useState(null)
  const [selectedSlide, setSelectedSlide] = useState(0)
  const [activeTab,     setActiveTab]     = useState('slides')

  useEffect(() => {
    getDocs(query(collection(db, 'infoscreens'), orderBy('createdAt', 'desc')))
      .then(s => setScreens(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLoading(false))
    getDocs(collection(db, 'holds'))
      .then(s => setHolds(
        s.docs.map(d => ({ id: d.id, ...d.data() }))
              .filter(h => h.aktiv)
              .sort((a, b) => (a.titel || '').localeCompare(b.titel || '', 'da'))
      ))
      .catch(() => {})
  }, [])

  function openNew() {
    setEditor({ id: 'new', config: { name: '', header: { text: '', logoUrl: '', bgColor: '#1a5c2a', textColor: '#ffffff' }, slides: [blankSlide()] } })
    setSelectedSlide(0)
    setActiveTab('slides')
  }

  function openEdit(sc) {
    setEditor({ id: sc.id, config: migrateScreen(sc) })
    setSelectedSlide(0)
    setActiveTab('slides')
  }

  function closeEditor() { setEditor(null) }

  function patchConfig(fn) { setEditor(e => ({ ...e, config: fn(e.config) })) }
  function patchHeader(p)  { patchConfig(c => ({ ...c, header: { ...c.header, ...p } })) }
  function patchSlides(fn) { patchConfig(c => ({ ...c, slides: fn(c.slides) })) }
  function patchSlide(idx, p) {
    patchSlides(ss => ss.map((s, i) => i === idx ? { ...s, ...p } : s))
  }
  function patchBlock(slideIdx, blockId, p) {
    patchSlides(ss => ss.map((s, i) => i === slideIdx
      ? { ...s, blocks: s.blocks.map(b => b.id === blockId ? { ...b, ...p } : b) } : s))
  }

  async function handleSave() {
    const { id, config } = editor
    if (!config.name.trim())   { alert('Skriv et navn til skærmen'); return }
    if (!config.slides.length) { alert('Tilføj mindst ét slide'); return }
    setSaving(true)
    const data = { name: config.name.trim(), header: config.header, slides: config.slides, updatedAt: serverTimestamp() }
    try {
      if (id === 'new') {
        const ref = await addDoc(collection(db, 'infoscreens'), { ...data, createdAt: serverTimestamp() })
        setScreens(p => [{ ...data, id: ref.id }, ...p])
      } else {
        await updateDoc(doc(db, 'infoscreens', id), data)
        setScreens(p => p.map(s => s.id === id ? { ...s, ...data } : s))
      }
      closeEditor()
    } catch (err) { alert('Fejl: ' + err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(sc) {
    if (!window.confirm(`Slet "${sc.name}"?`)) return
    setDeleting(sc.id)
    try { await deleteDoc(doc(db, 'infoscreens', sc.id)); setScreens(p => p.filter(s => s.id !== sc.id)) } catch {}
    setDeleting(null)
  }

  async function pushContent(id) {
    setPushing(id)
    try { await updateDoc(doc(db, 'infoscreens', id), { contentVersion: Date.now() }) } catch {}
    setPushing(null)
  }

  function copyUrl(id) {
    const url = INFOSCREEN_BASE_URL + id
    navigator.clipboard?.writeText(url).catch(() => {
      const el = document.createElement('textarea'); el.value = url
      document.body.appendChild(el); el.select()
      try { document.execCommand('copy') } finally { document.body.removeChild(el) }
    })
    setCopied(id)
    setTimeout(() => setCopied(c => c === id ? null : c), 2000)
  }

  // ── Editor view ──────────────────────────────────────────────────────────────
  if (editor) {
    const { id, config } = editor
    const slides = config.slides || []
    const safeIdx = Math.min(selectedSlide, Math.max(0, slides.length - 1))
    const slide = slides[safeIdx]
    const layout = SLIDE_LAYOUTS.find(l => l.id === (slide?.layout || 'full')) || SLIDE_LAYOUTS[0]

    function addSlide() {
      const s = blankSlide()
      patchSlides(ss => [...ss, s])
      setSelectedSlide(slides.length)
    }
    function delSlide(i) {
      patchSlides(ss => ss.filter((_, j) => j !== i))
      setSelectedSlide(p => Math.min(p, Math.max(0, slides.length - 2)))
    }
    function moveSlide(i, dir) {
      patchSlides(ss => { const a = [...ss]; const [item] = a.splice(i, 1); a.splice(i + dir, 0, item); return a })
      setSelectedSlide(i + dir)
    }
    function addBlock(type) {
      patchSlide(safeIdx, { blocks: [...(slide?.blocks || []), defaultBlock(type)] })
    }
    function delBlock(blockId) {
      patchSlide(safeIdx, { blocks: (slide?.blocks || []).filter(b => b.id !== blockId) })
    }
    function moveBlock(blockId, dir) {
      const blocks = [...(slide?.blocks || [])]
      const i = blocks.findIndex(b => b.id === blockId)
      if (i + dir < 0 || i + dir >= blocks.length) return
      const [b] = blocks.splice(i, 1); blocks.splice(i + dir, 0, b)
      patchSlide(safeIdx, { blocks })
    }
    function patchZone(zi, p) {
      patchSlide(safeIdx, { zones: (slide?.zones||[]).map((z, i) => i === zi ? { ...z, ...p } : z) })
    }
    function addZone() {
      patchSlide(safeIdx, { zones: [...(slide?.zones||[]), { id: isUid(), label: '', size: '50%', duration: 10, blocks: [] }] })
    }
    function delZone(zi) {
      patchSlide(safeIdx, { zones: (slide?.zones||[]).filter((_, i) => i !== zi) })
    }
    function addZoneBlock(zi, type) {
      patchSlide(safeIdx, { zones: (slide?.zones||[]).map((z, i) => i === zi ? { ...z, blocks: [...(z.blocks||[]), defaultBlock(type)] } : z) })
    }
    function delZoneBlock(zi, blockId) {
      patchSlide(safeIdx, { zones: (slide?.zones||[]).map((z, i) => i === zi ? { ...z, blocks: (z.blocks||[]).filter(b => b.id !== blockId) } : z) })
    }
    function moveZoneBlock(zi, blockId, dir) {
      const zones = (slide?.zones||[]).slice()
      const blocks = [...(zones[zi]?.blocks||[])]
      const idx = blocks.findIndex(b => b.id === blockId)
      if (idx + dir < 0 || idx + dir >= blocks.length) return
      const [b] = blocks.splice(idx, 1); blocks.splice(idx + dir, 0, b)
      patchSlide(safeIdx, { zones: zones.map((z, i) => i === zi ? { ...z, blocks } : z) })
    }
    function patchZoneBlock(zi, blockId, p) {
      patchSlide(safeIdx, { zones: (slide?.zones||[]).map((z, i) => i === zi ? { ...z, blocks: (z.blocks||[]).map(b => b.id === blockId ? { ...b, ...p } : b) } : z) })
    }

    return (
      <>
        {/* Top bar */}
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={closeEditor}>← Tilbage</button>
            <input value={config.name}
              onChange={e => patchConfig(c => ({ ...c, name: e.target.value }))}
              placeholder="Skærmens navn…"
              style={{ fontSize: 18, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', flex: 1, minWidth: 0 }} />
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Gemmer…' : '💾 Gem skærm'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '2px solid var(--border)' }}>
          {[['slides', '📋 Slides'], ['header', '🎨 Topbjælke']].map(([tab, label]) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)}
              style={{ padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
                fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? 'var(--green)' : 'var(--text2)',
                borderBottom: activeTab === tab ? '2px solid var(--green)' : '2px solid transparent',
                marginBottom: -2 }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Header tab ── */}
        {activeTab === 'header' && (
          <div style={{ maxWidth: 520 }}>
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}>
                <div style={{ background: config.header.bgColor || '#1a5c2a', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {config.header.logoUrl
                      ? <img src={config.header.logoUrl} style={{ height: 28, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />
                      : <div style={{ width: 28, height: 28, borderRadius: 4, background: 'rgba(255,255,255,.2)' }} />}
                    <span style={{ color: config.header.textColor || '#ffffff', fontWeight: 800, fontSize: 15 }}>{config.header.text || 'Sejs-Svejbæk IF'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: config.header.textColor || '#ffffff', fontWeight: 800, fontSize: 22, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>12:34</div>
                    <div style={{ color: config.header.textColor || '#ffffff', opacity: .65, fontSize: 10, marginTop: 2 }}>Tirsdag 17. jun 2026</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Baggrundsfarve</label>
                <input type="color" value={config.header.bgColor || '#1a5c2a'}
                  onChange={e => patchHeader({ bgColor: e.target.value })}
                  style={{ width: 40, height: 30, padding: 2, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchHeader({ bgColor: '#1a5c2a' })}>Nulstil</button>
                <span style={{ color: 'var(--border)', fontSize: 16 }}>|</span>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Tekstfarve</label>
                <input type="color" value={config.header.textColor || '#ffffff'}
                  onChange={e => patchHeader({ textColor: e.target.value })}
                  style={{ width: 40, height: 30, padding: 2, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchHeader({ textColor: '#ffffff' })}>Nulstil</button>
              </div>
              <div className="form-group">
                <label className="form-label">Tekst / klubnavn</label>
                <input className="form-control" value={config.header.text}
                  onChange={e => patchHeader({ text: e.target.value })} placeholder="Sejs-Svejbæk IF" />
                <p className="form-hint">Tomt = "Sejs-Svejbæk IF"</p>
              </div>
              <div className="form-group">
                <label className="form-label">Logo</label>
                <ImageUploader value={config.header.logoUrl} onChange={url => patchHeader({ logoUrl: url })} hint="PNG med transparent baggrund anbefales · maks 2 MB" />
                <input className="form-control" type="url" value={config.header.logoUrl}
                  onChange={e => patchHeader({ logoUrl: e.target.value })} placeholder="https://…" style={{ marginTop: 8 }} />
                <p className="form-hint">Tomt = SSIF-logo</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Slides tab ── */}
        {activeTab === 'slides' && (
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' }}>

            {/* Left: slide list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {slides.map((s, i) => {
                const isActive = i === safeIdx
                const icons = [...new Set((s.blocks || []).map(b => BLOCK_DEFS.find(d => d.type === b.type)?.icon || ''))].join(' ')
                const names = (s.blocks || []).map(b => BLOCK_DEFS.find(d => d.type === b.type)?.label || b.type).join(' + ')
                return (
                  <div key={s.id} onClick={() => setSelectedSlide(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: '1.5px solid', userSelect: 'none',
                      borderColor: isActive ? 'var(--green)' : 'var(--border)',
                      background:  isActive ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      background: isActive ? 'var(--green)' : 'var(--muted,#e5e7eb)' }}>
                      <span style={{ color: isActive ? '#fff' : 'var(--text2)', fontSize: 11, fontWeight: 800 }}>{i + 1}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? 'var(--green)' : 'var(--text)' }}>
                        {icons || '—'}&nbsp;<span style={{ opacity: .6, fontWeight: 400 }}>{s.duration}s</span>
                      </div>
                      {names && <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{names}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveSlide(i, -1)} style={{ padding: '2px 4px' }}>↑</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === slides.length - 1} onClick={() => moveSlide(i, 1)} style={{ padding: '2px 4px' }}>↓</button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#dc2626', padding: '2px 4px' }} onClick={() => delSlide(i)}>
                        <Icon name="trash" size={11} />
                      </button>
                    </div>
                  </div>
                )
              })}
              <button type="button" onClick={addSlide}
                style={{ padding: '10px', borderRadius: 8, border: '1.5px dashed var(--border)', background: 'none', color: 'var(--text3)', fontSize: 13, cursor: 'pointer' }}>
                + Tilføj slide
              </button>
            </div>

            {/* Right: slide editor */}
            {slide ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Slide settings */}
                <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label className="form-label">Layout</label>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {SLIDE_LAYOUTS.map(l => (
                          <button key={l.id} type="button" onClick={() => patchSlide(safeIdx, { layout: l.id })}
                            style={{ padding: '6px 14px', borderRadius: 6, border: '1.5px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              borderColor: (slide.layout || 'full') === l.id ? 'var(--green)' : 'var(--border)',
                              background:  (slide.layout || 'full') === l.id ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)',
                              color:       (slide.layout || 'full') === l.id ? 'var(--green)' : 'var(--text2)' }}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Varighed</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <input type="number" min={3} max={300} value={slide.duration}
                          onChange={e => patchSlide(safeIdx, { duration: parseInt(e.target.value) || 15 })}
                          className="form-control" style={{ width: 72 }} />
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>sek</span>
                      </div>
                    </div>
                  </div>

                  {/* Background */}
                  <div>
                    <label className="form-label">Baggrund</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <input type="color" value={slide.bgColor || '#000000'}
                        onChange={e => patchSlide(safeIdx, { bgColor: e.target.value })}
                        style={{ width: 36, height: 28, padding: 2, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>Farve</span>
                      {slide.bgColor && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchSlide(safeIdx, { bgColor: '' })}>✕ Ryd</button>
                      )}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Baggrundsbillede</p>
                      <ImageUploader
                        value={slide.bgImageUrl || ''}
                        onChange={url => patchSlide(safeIdx, { bgImageUrl: url })}
                        hint="Anbefalet 1920×1080 · maks 10 MB"
                      />
                    </div>
                  </div>

                  {/* Schedule */}
                  <div>
                    <label className="form-label">Tidsstyring</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={slide.schedule?.enabled || false}
                        onChange={e => patchSlide(safeIdx, { schedule: { ...(slide.schedule||{}), enabled: e.target.checked } })}
                        style={{ accentColor: 'var(--green)' }} />
                      <span style={{ fontSize: 13, color: 'var(--text2)' }}>Aktivér tidsstyring</span>
                    </label>
                    {slide.schedule?.enabled && (
                      <>
                        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                          {[['Sø',0],['Ma',1],['Ti',2],['On',3],['To',4],['Fr',5],['Lø',6]].map(([lbl, day]) => {
                            const on = (slide.schedule?.days || []).includes(day)
                            return (
                              <button key={day} type="button"
                                onClick={() => {
                                  const days = on
                                    ? (slide.schedule?.days||[]).filter(d => d !== day)
                                    : [...(slide.schedule?.days||[]), day]
                                  patchSlide(safeIdx, { schedule: { ...(slide.schedule||{}), days } })
                                }}
                                style={{ padding: '4px 9px', borderRadius: 6, border: '1.5px solid', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                  borderColor: on ? 'var(--green)' : 'var(--border)',
                                  background:  on ? 'var(--green-soft,#f0fdf4)' : 'var(--bg)',
                                  color:       on ? 'var(--green)' : 'var(--text2)' }}>
                                {lbl}
                              </button>
                            )
                          })}
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>Ingen dage valgt = alle dage</p>
                        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            Fra <input type="time" value={slide.schedule?.timeFrom || ''}
                              onChange={e => patchSlide(safeIdx, { schedule: { ...(slide.schedule||{}), timeFrom: e.target.value } })}
                              className="form-control" style={{ width: 110, marginLeft: 4 }} />
                          </label>
                          <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            Til <input type="time" value={slide.schedule?.timeTo || ''}
                              onChange={e => patchSlide(safeIdx, { schedule: { ...(slide.schedule||{}), timeTo: e.target.value } })}
                              className="form-control" style={{ width: 110, marginLeft: 4 }} />
                          </label>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>Tomt tidsinterval = hele dagen</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Blocks — for regular layouts */}
                {slide.layout !== 'zones' && (
                  <>
                    {(slide.blocks || []).map((block, bi) => {
                      const def = BLOCK_DEFS.find(d => d.type === block.type)
                      return (
                        <div key={block.id} className="card card-pad">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                            <span style={{ fontSize: 18, lineHeight: 1 }}>{def?.icon}</span>
                            <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{def?.label}</span>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={bi === 0} onClick={() => moveBlock(block.id, -1)}>↑</button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={bi === slide.blocks.length - 1} onClick={() => moveBlock(block.id, 1)}>↓</button>
                            <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => delBlock(block.id)}>
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                          <BlockEditor block={block} onChange={p => patchBlock(safeIdx, block.id, p)} holds={holds} />
                        </div>
                      )
                    })}
                    {(slide.blocks || []).length < layout.slots && (
                      <div className="card card-pad">
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                          Vælg indhold{layout.slots > 1 ? ` — slot ${(slide.blocks || []).length + 1} / ${layout.slots}` : ''}
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: 8 }}>
                          {BLOCK_DEFS.map(def => (
                            <button key={def.type} type="button" onClick={() => addBlock(def.type)}
                              style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '12px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', textAlign: 'left' }}
                              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--green)'}
                              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                              <span style={{ fontSize: 22 }}>{def.icon}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{def.label}</span>
                              <span style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>{def.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Zones editor */}
                {slide.layout === 'zones' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(slide.zones || []).map((zone, zi) => (
                      <div key={zone.id} className="card card-pad">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>Zone {zi + 1}</span>
                          <input value={zone.label || ''}
                            onChange={e => patchZone(zi, { label: e.target.value })}
                            placeholder="Navn på zone…"
                            style={{ fontSize: 13, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 80 }} />
                          <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            Bredde
                            <input value={zone.size || '50%'}
                              onChange={e => patchZone(zi, { size: e.target.value })}
                              className="form-control" style={{ width: 68, marginLeft: 4 }} placeholder="50%" />
                          </label>
                          {(zone.blocks || []).length > 1 && (
                            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                              Skift
                              <input type="number" min={3} max={300} value={zone.duration || 10}
                                onChange={e => patchZone(zi, { duration: parseInt(e.target.value) || 10 })}
                                className="form-control" style={{ width: 60, marginLeft: 4 }} />
                              s
                            </label>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => delZone(zi)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '3px solid var(--border)' }}>
                          {(zone.blocks || []).map((block, bi) => {
                            const def = BLOCK_DEFS.find(d => d.type === block.type)
                            return (
                              <div key={block.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                  <span style={{ fontSize: 15 }}>{def?.icon}</span>
                                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{def?.label}</span>
                                  <button type="button" className="btn btn-ghost btn-sm" disabled={bi === 0} onClick={() => moveZoneBlock(zi, block.id, -1)} style={{ padding: '2px 5px' }}>↑</button>
                                  <button type="button" className="btn btn-ghost btn-sm" disabled={bi === (zone.blocks.length - 1)} onClick={() => moveZoneBlock(zi, block.id, 1)} style={{ padding: '2px 5px' }}>↓</button>
                                  <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => delZoneBlock(zi, block.id)}>
                                    <Icon name="trash" size={11} />
                                  </button>
                                </div>
                                <BlockEditor block={block} onChange={p => patchZoneBlock(zi, block.id, p)} holds={holds} />
                              </div>
                            )
                          })}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {BLOCK_DEFS.map(def => (
                              <button key={def.type} type="button" onClick={() => addZoneBlock(zi, def.type)}
                                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px dashed var(--border)', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>
                                {def.icon} {def.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={addZone}
                      style={{ padding: '10px', borderRadius: 8, border: '1.5px dashed var(--border)', background: 'none', color: 'var(--text3)', fontSize: 13, cursor: 'pointer' }}>
                      + Tilføj zone
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="card card-pad" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text3)' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                <p style={{ fontSize: 14 }}>Tilføj et slide til venstre for at komme i gang.</p>
              </div>
            )}
          </div>
        )}
      </>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Infoskærme</h1>
        <button className="btn btn-primary" onClick={openNew}>+ Ny skærm</button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16, background: '#f0fdf4', border: '1px solid #86efac' }}>
        <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.6 }}>
          <strong>Sådan virker det:</strong> Opret en skærm og byg dit indhold med slides.
          Indsæt skærmens URL i Chrome/Edge i kiosk-tilstand (F11).
          Brug <strong>↻</strong>-knappen til at sende opdateret indhold til alle tilsluttede skærme øjeblikkeligt.
        </p>
      </div>

      {loading ? (
        <div className="loading-dots"><span/><span/><span/></div>
      ) : screens.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🖥</div>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Ingen infoskærme endnu</p>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>Opret din første skærm og vis live-indhold på din hal-skærm, kantine-tv eller udendørs tavle.</p>
          <button className="btn btn-primary" onClick={openNew}>Opret første skærm</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {screens.map(sc => {
            const url        = INFOSCREEN_BASE_URL + sc.id
            const isCopied   = copied === sc.id
            const slideCount = sc.slides?.length || 0
            const icons      = [...new Set((sc.slides || []).flatMap(s => (s.blocks || []).map(b => BLOCK_DEFS.find(d => d.type === b.type)?.icon || '')))].filter(Boolean).join(' ')
            return (
              <div key={sc.id} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--green-soft,#f0fdf4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="monitor" size={20} color="var(--green)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{sc.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                    {slideCount} slide{slideCount !== 1 ? 's' : ''} · {icons || '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <code style={{ fontSize: 11, background: '#f1f5f9', padding: '3px 8px', borderRadius: 5, color: '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
                    <button type="button" onClick={() => copyUrl(sc.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: isCopied ? 'var(--green-soft,#f0fdf4)' : 'white', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: isCopied ? 'var(--green)' : 'var(--text2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      <Icon name={isCopied ? 'check' : 'copy'} size={12} color={isCopied ? 'var(--green)' : 'var(--text2)'} sw={2.5} />
                      {isCopied ? 'Kopieret!' : 'Kopiér URL'}
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', textDecoration: 'none', fontSize: 11, fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      <Icon name="link" size={12} color="var(--text2)" />
                      Åbn
                    </a>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" title="Send opdateret indhold til skærmen" disabled={pushing === sc.id} onClick={() => pushContent(sc.id)} style={{ color: pushing === sc.id ? 'var(--green)' : undefined }}>
                    <Icon name="refresh" size={14} />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(sc)}>
                    <Icon name="edit" size={14} />
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} disabled={deleting === sc.id} onClick={() => handleDelete(sc)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}


const PAGE_TITLES = {
  dashboard:    'Dashboard',
  messages:     'Beskeder',
  news:         'Nyheder',
  teams:        'Hold',
  events:       'Begivenheder',
  banners:      'Forsidebanners',
  infoscreens:  'Infoskærme',
  kommunikation:'Kommunikation',
  appusers:     'App-brugere',
  users:        'Adgang',
  support:      'Support',
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
      if (!fbUser) { setAuthUser(null); setUserDoc(null); return }
      setAuthUser(fbUser)

      const ref  = doc(db, 'users', fbUser.uid)
      const snap = await getDoc(ref)

      // 1. Eksisterende bruger med gyldig backoffice-rolle
      if (snap.exists() && (snap.data().role === 'admin' || snap.data().role === 'trainer')) {
        setUserDoc({ id: snap.id, ...snap.data() })
        return
      }

      // 2. Første bruger nogensinde → bootstrap-admin
      if (!snap.exists()) {
        const adminSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin'), limit(1)))
        if (adminSnap.empty) {
          const newDoc = {
            email:       fbUser.email,
            displayName: fbUser.displayName || fbUser.email.split('@')[0],
            role:        'admin',
            permissions: null,
            holds:       [],
            createdAt:   serverTimestamp(),
          }
          await setDoc(ref, newDoc)
          setUserDoc({ id: fbUser.uid, ...newDoc })
          return
        }
      }

      // 3. Tjek for afventende invitation (document-ID = lowercase email)
      const invEmail = fbUser.email?.toLowerCase()
      if (invEmail) {
        try {
          const invSnap = await getDoc(doc(db, 'invitations', invEmail))
          if (invSnap.exists()) {
            const inv    = invSnap.data()
            const newDoc = {
              email:       fbUser.email,
              displayName: fbUser.displayName || fbUser.email.split('@')[0],
              role:        inv.role,
              permissions: inv.permissions ?? null,
              holds:       [],
              createdAt:   serverTimestamp(),
            }
            await setDoc(ref, newDoc)
            deleteDoc(doc(db, 'invitations', invEmail)).catch(() => {})
            setUserDoc({ id: fbUser.uid, ...newDoc })
            return
          }
        } catch { /* ingen invitation eller permission denied */ }
      }

      // 4. Ingen invitation → adgang nægtet
      setUserDoc({ id: fbUser.uid, email: fbUser.email, role: null })
    })
  }, [])

  if (authUser === undefined) return <LoadingScreen />
  if (!authUser)              return <LoginPage />
  if (userDoc?.role !== 'admin' && userDoc?.role !== 'trainer') return <InvitationRequiredPage user={authUser} />

  function renderPage() {
    // Administration is always superadmin-only
    if (page === 'users') {
      return userDoc.role === 'admin'
        ? <UsersPage authUser={authUser} userDoc={userDoc} />
        : <EmptyState icon="shield" text="Kun Superadmin har adgang til Administration" />
    }
    // All other pages respect granular permissions
    if (!hasPageAccess(userDoc, page)) {
      return <EmptyState icon="shield" text="Du har ikke adgang til denne side" />
    }
    switch (page) {
      case 'dashboard':    return <DashboardPage    userDoc={userDoc} />
      case 'messages':     return <MessagesPage      userDoc={userDoc} authUser={authUser} />
      case 'news':         return <NewsPage          userDoc={userDoc} authUser={authUser} />
      case 'teams':        return <TeamsPage         userDoc={userDoc} authUser={authUser} />
      case 'events':       return <EventsPage        userDoc={userDoc} authUser={authUser} />
      case 'banners':      return <BannersPage       userDoc={userDoc} authUser={authUser} />
      case 'kommunikation':return <KommunikationPage authUser={authUser} userDoc={userDoc} />
      case 'support':      return <SupportPage       authUser={authUser} />
      case 'appusers':     return <AppUsersPage />
      case 'infoscreens':  return <InfoScreensPage   authUser={authUser} />
      default:             return null
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
              {userDoc.role === 'admin' ? 'Superadmin' : 'Redaktør'}
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
