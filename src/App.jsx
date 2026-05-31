import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import './App.css'
import { auth, db, getAppMessaging } from './firebase.js'
import { getToken, onMessage } from 'firebase/messaging'
import {
  GoogleAuthProvider,

  signInWithPopup,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  signInWithCustomToken,
  onAuthStateChanged,
} from 'firebase/auth'
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, deleteField, arrayUnion, arrayRemove, serverTimestamp, limit, increment,
  doc, getDoc, setDoc, getDocs,
} from 'firebase/firestore'

// ─── Icons ──────────────────────────────────────────────────────────────────

function Icon({ name, size = 24, color = 'currentColor', sw = 1.75 }) {
  const paths = {
    home:     <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    users:    <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
    news:     <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>,
    message:  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
    chevron:  <polyline points="9 18 15 12 9 6"/>,
    back:     <polyline points="15 18 9 12 15 6"/>,
    person:   <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    mail:     <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
    lock:     <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>,
    send:     <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    location: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></>,
    trophy:   <><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></>,
    shirt:    <><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/></>,
    phone:    <><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></>,
    logout:    <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    star:      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    x:         <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    'user-plus':<><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></>,
    heart:         <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>,
    bell:          <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>,
    eye:           <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    'eye-off':     <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>,
    check:         <polyline points="20 6 9 17 4 12"/>,
    'check-circle':<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></>,
    'alert-circle':<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    'person-circle':<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    clock:    <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></>,
    search:   <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
         style={{ display: 'block', flexShrink: 0 }}>
      {paths[name]}
    </svg>
  )
}

// ─── Consent version — bump to re-show consent screen to all users ───────────
const CONSENT_VERSION = '1.0'

// ─── Firebase error codes → Danish messages ──────────────────────────────────

const AUTH_ERRORS = {
  'auth/invalid-email':                             'Ugyldig email-adresse.',
  'auth/user-not-found':                            'Ingen bruger med denne email.',
  'auth/wrong-password':                            'Forkert adgangskode.',
  'auth/invalid-credential':                        'Forkert email eller adgangskode.',
  'auth/email-already-in-use':                      'Email-adressen er allerede i brug.',
  'auth/weak-password':                             'Adgangskoden skal være mindst 6 tegn.',
  'auth/too-many-requests':                         'For mange forsøg. Prøv igen om lidt.',
  'auth/user-disabled':                             'Denne konto er deaktiveret.',
  'auth/network-request-failed':                    'Ingen netværksforbindelse.',
  'auth/popup-closed-by-user':                      '',
  'auth/cancelled-popup-request':                   '',
  'auth/account-exists-with-different-credential':  'Denne email er registreret med en anden login-metode.',
  'auth/requires-recent-login':                     'Log venligst ind igen for at gøre dette.',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Avatar({ initials, color = '#1a5c2a', size = 40 }) {
  const text = initials || ''
  const fs = text.length <= 2 ? size * 0.36
           : text.length <= 4 ? size * 0.28
           : size * 0.22
  return (
    <div className="avatar" style={{ width: size, height: size, borderRadius: size / 2, background: color, fontSize: fs }}>
      {text}
    </div>
  )
}

function Badge({ count }) {
  if (!count) return null
  return <span className="badge">{count > 9 ? '9+' : count}</span>
}

function CategoryPill({ label, color }) {
  return <span className="category-pill" style={{ background: color + '18', color }}>{label}</span>
}

function SectionHeader({ title }) {
  return <div className="section-header">{title}</div>
}

function Chevron() {
  return <Icon name="chevron" size={17} color="var(--text3)" sw={2.5} />
}

function FirestoreDot({ live }) {
  if (!live) return null
  return <span className="firestore-dot" title="Live fra Firebase" />
}

// ─── Splash ───────────────────────────────────────────────────────────────────

function SplashScreen({ label }) {
  return (
    <div className="splash-screen">
      <div className="splash-logo">
        <img src={`${import.meta.env.BASE_URL}ssif-logo.png`} alt="SSIF" className="splash-logo-img"
             onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }} />
        <span style={{ display: 'none' }}>SSIF</span>
      </div>
      <div className="spinner spinner--white" />
      {label && <p className="splash-label">{label}</p>}
    </div>
  )
}

// ─── PWA-installationsprompt ─────────────────────────────────────────────────

function InstallPromptScreen({ onContinue }) {
  const [prompt, setPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const handler = e => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isAndroid = /android/i.test(navigator.userAgent)

  async function installNative() {
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--green)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: `max(env(safe-area-inset-top,24px),24px) 24px max(env(safe-area-inset-bottom,24px),24px)`,
      maxWidth: 430, margin: '0 auto',
    }}>
      {/* Logo */}
      <div style={{ width: 120, height: 120, borderRadius: 28, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, marginBottom: 28, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
        <img src={`${import.meta.env.BASE_URL}ssif-logo.png`} alt="SSIF" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
             onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='block' }} />
        <span style={{ display:'none', color:'var(--green)', fontSize:32, fontWeight:800 }}>S</span>
      </div>

      <h1 style={{ color: 'white', fontSize: 26, fontWeight: 800, textAlign: 'center', marginBottom: 10 }}>
        Sejs-Svejbæk IF
      </h1>
      <p style={{ color: 'rgba(255,255,255,.8)', fontSize: 15, textAlign: 'center', lineHeight: 1.5, marginBottom: 32, maxWidth: 280 }}>
        Dette er en <strong style={{ color: 'white' }}>app</strong> — ikke en hjemmeside. Gem den på din hjemmeskærm for den bedste oplevelse med notifikationer og hurtig adgang.
      </p>

      {/* Platform-specifikke instruktioner */}
      <div style={{ background: 'rgba(255,255,255,.12)', borderRadius: 16, padding: '20px 20px', width: '100%', maxWidth: 340, marginBottom: 24 }}>
        {installed ? (
          <p style={{ color: 'white', textAlign: 'center', fontWeight: 700, fontSize: 16 }}>
            ✅ Appen er installeret!
          </p>
        ) : isIOS ? (
          <>
            <p style={{ color: 'white', fontWeight: 700, marginBottom: 14, fontSize: 14 }}>Sådan gemmer du den på iPhone/iPad:</p>
            {[
              { n: 1, icon: '⬆️', text: 'Tryk på deleknappen i bunden af Safari' },
              { n: 2, icon: '📱', text: 'Vælg "Føj til hjemmeskærm"' },
              { n: 3, icon: '✅', text: 'Tryk "Tilføj" øverst til højre' },
            ].map(s => (
              <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{s.icon}</span>
                <span style={{ color: 'rgba(255,255,255,.9)', fontSize: 14, lineHeight: 1.4 }}>{s.text}</span>
              </div>
            ))}
          </>
        ) : prompt ? (
          <>
            <p style={{ color: 'white', fontWeight: 700, marginBottom: 14, fontSize: 14 }}>Installer appen direkte:</p>
            <button onClick={installNative} style={{ width: '100%', background: 'white', color: 'var(--green)', border: 'none', borderRadius: 12, height: 48, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
              📲 Installer app
            </button>
          </>
        ) : (
          <>
            <p style={{ color: 'white', fontWeight: 700, marginBottom: 14, fontSize: 14 }}>Sådan gemmer du den:</p>
            {[
              { icon: '⋮', text: 'Tryk på menu-ikonet i din browser' },
              { icon: '📱', text: 'Vælg "Tilføj til startskærm" eller "Installer app"' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                <span style={{ fontSize: 18, flexShrink: 0, fontWeight: 700, color: 'white' }}>{s.icon}</span>
                <span style={{ color: 'rgba(255,255,255,.9)', fontSize: 14, lineHeight: 1.4 }}>{s.text}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <button onClick={onContinue} style={{ background: 'none', border: '1.5px solid rgba(255,255,255,.4)', color: 'rgba(255,255,255,.75)', borderRadius: 12, padding: '12px 24px', fontSize: 14, cursor: 'pointer' }}>
        Fortsæt til login uden at installere
      </button>
    </div>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ initialError }) {
  const [mode, setMode]         = useState('main') // 'main' | 'forgot' | 'create' | 'conventus' | 'conventus-profiles'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(null)  // null | 'google' | 'email' | 'create' | 'reset'
  const [error, setError]       = useState(initialError || '')
  const [info, setInfo]         = useState('')

  // Conventus-specifik tilstand
  const [cvEmail, setCvEmail]       = useState('')
  const [cvPass, setCvPass]         = useState('')
  const [cvShowPw, setCvShowPw]     = useState(false)
  const [cvError, setCvError]       = useState('')
  const [cvLoading, setCvLoading]   = useState(false)
  const [cvProfiles, setCvProfiles] = useState([])  // [{ id, name }] ved multiple_profiles
  const [cvPending, setCvPending]   = useState('')  // pendingToken til profilvælger

  function reset(m = 'main') { setMode(m); setError(''); setInfo(''); setCvError('') }

  async function conventusLogin(e) {
    e.preventDefault()
    setCvLoading(true); setCvError('')
    try {
      const res  = await fetch('/api/conventus-login.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: cvEmail, password: cvPass }),
      })
      const data = await res.json()
      if (!res.ok) { setCvError(data.error || 'Forkert email eller adgangskode'); return }

      if (data.status === 'ok') {
        sessionStorage.setItem('_ssif_cv', JSON.stringify({
          email:       data.email,
          displayName: data.displayName,
          conventusId: data.conventusId,
        }))
        await signInWithCustomToken(auth, data.customToken)
      } else if (data.status === 'multiple_profiles') {
        setCvProfiles(data.profiles)
        setCvPending(data.pendingToken)
        setMode('conventus-profiles')
      }
    } catch {
      setCvError('Netværksfejl — prøv igen')
    } finally {
      setCvLoading(false)
    }
  }

  async function conventusSelectProfile(profileId) {
    setCvLoading(true); setCvError('')
    try {
      const res  = await fetch('/api/conventus-select-profile.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pendingToken: cvPending, profileId }),
      })
      const data = await res.json()
      if (!res.ok) { setCvError(data.error || 'Noget gik galt — prøv igen'); return }

      sessionStorage.setItem('_ssif_cv', JSON.stringify({
        email:       data.email,
        displayName: data.displayName,
        conventusId: data.conventusId,
      }))
      await signInWithCustomToken(auth, data.customToken)
    } catch {
      setCvError('Netværksfejl — prøv igen')
    } finally {
      setCvLoading(false)
    }
  }

  async function social(ProviderClass) {
    const key = ProviderClass === GoogleAuthProvider ? 'google' : 'facebook'
    setLoading(key); setError('')
    // signInWithPopup bruges på alle platforme inkl. iOS PWA (kræver iOS 16.4+).
    // signInWithRedirect virker ikke i iOS PWA — Google redirecter tilbage til Safari,
    // ikke til PWA-konteksten, og getRedirectResult finder ingen session.
    try {
      await signInWithPopup(auth, new ProviderClass())
      // onAuthStateChanged fyrer med brugeren direkte — ingen redirect nødvendig
    } catch (e) {
      const msg = AUTH_ERRORS[e.code]
      if (msg) setError(msg)
      setLoading(null)
    }
  }

  async function emailLogin(e) {
    e.preventDefault(); setLoading('email'); setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      setError(AUTH_ERRORS[e.code] || 'Forkert email eller adgangskode.')
      setLoading(null)
    }
  }

  async function createAccount(e) {
    e.preventDefault(); setLoading('create'); setError('')
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await sendEmailVerification(cred.user)
      setInfo('Konto oprettet! Tjek din email for at bekræfte adressen.')
      setMode('main')
    } catch (e) {
      setError(AUTH_ERRORS[e.code] || e.message)
    } finally { setLoading(null) }
  }

  async function resetPassword(e) {
    e.preventDefault(); setLoading('reset'); setError('')
    try {
      await sendPasswordResetEmail(auth, email)
      setInfo(`Nulstillingsmail sendt til ${email}`)
      reset('main')
    } catch (e) {
      setError(AUTH_ERRORS[e.code] || e.message)
    } finally { setLoading(null) }
  }

  return (
    <div className="login-screen">
      <div className="login-top">
        <div className="login-logo">
          <img src={`${import.meta.env.BASE_URL}ssif-logo.png`} alt="SSIF" className="login-logo-img"
               onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }} />
          <span style={{ display: 'none' }}>SSIF</span>
        </div>
        <h1 className="login-club">Sejs-Svejbæk IF</h1>
        <p className="login-subtitle">
          {mode === 'forgot'               ? 'Nulstil adgangskode'
           : mode === 'create'            ? 'Opret konto'
           : mode === 'conventus'         ? 'Log ind med Conventus'
           : mode === 'conventus-profiles'? 'Vælg profil'
           :                               'Log ind på din konto'}
        </p>
      </div>

      {info && <p className="login-info">{info}</p>}
      {error && <p className="login-error">{error}</p>}

      {/* ── Glemt kodeord ─────────────────────────────── */}
      {mode === 'forgot' && (
        <form className="login-form" onSubmit={resetPassword}>
          <div className="input-group">
            <div className="input-row">
              <span className="input-icon"><Icon name="mail" size={18} color="var(--text3)" /></span>
              <input className="input-field" type="email" placeholder="Din email" autoComplete="email" autoFocus required
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary btn-full" type="submit" disabled={loading === 'reset'}>
            {loading === 'reset' ? <span className="spinner" /> : 'Send nulstillingsmail'}
          </button>
          <button className="btn btn-secondary btn-full" type="button" onClick={() => reset()}>← Tilbage</button>
        </form>
      )}

      {/* ── Opret konto ───────────────────────────────── */}
      {mode === 'create' && (
        <form className="login-form" onSubmit={createAccount}>
          <div className="input-group">
            <div className="input-row">
              <span className="input-icon"><Icon name="mail" size={18} color="var(--text3)" /></span>
              <input className="input-field" type="email" placeholder="Email" autoComplete="email" autoFocus required
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="input-separator" />
            <div className="input-row">
              <span className="input-icon"><Icon name="lock" size={18} color="var(--text3)" /></span>
              <input className="input-field" type={showPw ? 'text' : 'password'} placeholder="Adgangskode (min. 6 tegn)"
                autoComplete="new-password" required minLength={6}
                value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" className="input-pw-toggle" onClick={() => setShowPw(p => !p)}>
                <Icon name={showPw ? 'eye-off' : 'eye'} size={17} color="var(--text3)" />
              </button>
            </div>
          </div>
          <button className="btn btn-primary btn-full" type="submit" disabled={loading === 'create'}>
            {loading === 'create' ? <span className="spinner" /> : 'Opret konto'}
          </button>
          <button className="btn btn-secondary btn-full" type="button" onClick={() => reset()}>← Tilbage</button>
        </form>
      )}

      {/* ── Conventus login ───────────────────────────── */}
      {mode === 'conventus' && (
        <form className="login-form" onSubmit={conventusLogin}>
          <div className="input-group">
            <div className="input-row">
              <span className="input-icon"><Icon name="mail" size={18} color="var(--text3)" /></span>
              <input className="input-field" type="email" placeholder="Conventus email" autoComplete="email" autoFocus required
                value={cvEmail} onChange={e => setCvEmail(e.target.value)} />
            </div>
            <div className="input-separator" />
            <div className="input-row">
              <span className="input-icon"><Icon name="lock" size={18} color="var(--text3)" /></span>
              <input className="input-field" type={cvShowPw ? 'text' : 'password'} placeholder="Conventus adgangskode"
                autoComplete="current-password" required
                value={cvPass} onChange={e => setCvPass(e.target.value)} />
              <button type="button" className="input-pw-toggle" onClick={() => setCvShowPw(p => !p)}>
                <Icon name={cvShowPw ? 'eye-off' : 'eye'} size={17} color="var(--text3)" />
              </button>
            </div>
          </div>
          {cvError && <p className="login-error">{cvError}</p>}
          <button className="btn btn-conventus btn-full" type="submit" disabled={cvLoading}>
            {cvLoading ? <span className="spinner" /> : 'Log ind med Conventus'}
          </button>
          <button className="btn btn-secondary btn-full" type="button" onClick={() => reset()}>← Tilbage</button>
        </form>
      )}

      {/* ── Conventus profilvælger ─────────────────────── */}
      {mode === 'conventus-profiles' && (
        <div className="login-form">
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text2)', textAlign: 'center' }}>
            Din Conventus-konto har flere profiler. Vælg den du vil logge ind som:
          </p>
          {cvError && <p className="login-error">{cvError}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cvProfiles.map(p => (
              <button key={p.id} className="conventus-profile-btn"
                      onClick={() => conventusSelectProfile(p.id)} disabled={cvLoading}>
                <span className="conventus-profile-initials">
                  {p.name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'}
                </span>
                <span className="conventus-profile-name">{p.name}</span>
                {cvLoading && <span className="spinner spinner--dark" style={{ marginLeft: 'auto' }} />}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-full" type="button"
                  onClick={() => reset()} style={{ marginTop: 4 }}>← Tilbage</button>
        </div>
      )}

      {/* ── Hoved login ───────────────────────────────── */}
      {mode === 'main' && (
        <div className="login-form">
          {/* Social login */}
          <button className="btn btn-social btn-google" onClick={() => social(GoogleAuthProvider)}
                  disabled={!!loading}>
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
              <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {loading === 'google' ? <span className="spinner spinner--dark" /> : 'Log ind med Google'}
          </button>

          <button className="btn btn-social btn-conventus" onClick={() => reset('conventus')}
                  disabled={!!loading}>
            <img src={`${import.meta.env.BASE_URL}conventus-logo_inv.svg`} alt="Conventus" height="20"
                 style={{ flexShrink: 0 }}
                 onError={e => { e.target.style.display = 'none' }} />
            Log ind med Conventus
          </button>

<div className="login-divider"><span>eller</span></div>

          {/* Email/adgangskode */}
          <form onSubmit={emailLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="input-group">
              <div className="input-row">
                <span className="input-icon"><Icon name="mail" size={18} color="var(--text3)" /></span>
                <input className="input-field" type="email" placeholder="Email" autoComplete="email" required
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="input-separator" />
              <div className="input-row">
                <span className="input-icon"><Icon name="lock" size={18} color="var(--text3)" /></span>
                <input className="input-field" type={showPw ? 'text' : 'password'} placeholder="Adgangskode"
                  autoComplete="current-password" required
                  value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="input-pw-toggle" onClick={() => setShowPw(p => !p)}>
                  <Icon name={showPw ? 'eye-off' : 'eye'} size={17} color="var(--text3)" />
                </button>
              </div>
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={!!loading}>
              {loading === 'email' ? <span className="spinner" /> : 'Log ind'}
            </button>
          </form>

          <div className="login-links">
            <button className="login-link" type="button" onClick={() => reset('forgot')}>Glemt kodeord?</button>
            <button className="login-link" type="button" onClick={() => reset('create')}>Opret konto</button>
          </div>

        </div>
      )}
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function AppHeader({ title, onBack, backLabel, right }) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        {onBack
          ? <button className="header-back" onClick={onBack}>
              <Icon name="back" size={20} color="var(--green)" sw={2.5} />
              {backLabel && <span>{backLabel}</span>}
            </button>
          : <img src={`${import.meta.env.BASE_URL}ssif-logo.png`} alt="SSIF" className="header-logo-img" />
        }
      </div>
      <span className="header-title">{title}</span>
      <div className="app-header-right">{right}</div>
    </header>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

function BottomNav({ activeTab, onChange, unreadCount }) {
  const tabs = [
    { id: 'dashboard', label: 'Hjem',     icon: 'home'     },
    { id: 'teams',     label: 'Hold',     icon: 'users'    },
    { id: 'news',      label: 'Nyheder',  icon: 'news'     },
    { id: 'messages',  label: 'Beskeder', icon: 'message'  },
    { id: 'kalender',  label: 'Kalender', icon: 'calendar' },
  ]
  return (
    <nav className="tab-bar">
      {tabs.map(tab => (
        <button key={tab.id}
          className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}>
          <span className="tab-icon-wrap">
            <Icon name={tab.icon} size={22}
              color={activeTab === tab.id ? 'var(--green)' : 'var(--text3)'}
              sw={activeTab === tab.id ? 2 : 1.75} />
            {tab.id === 'messages' && unreadCount > 0 && <Badge count={unreadCount} />}
          </span>
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

// ─── Welcome / onboarding ─────────────────────────────────────────────────────

const WELCOME_FEATURES = [
  {
    icon: 'news',
    color: '#5856d6',
    bg:    '#ede9fe',
    title: 'Nyheder fra klubben',
    desc:  'Hold dig opdateret med nyheder, kampresultater og arrangementer direkte fra SSIF.',
  },
  {
    icon: 'message',
    color: '#1a5c2a',
    bg:    '#e8f5ec',
    title: 'Beskeder fra din træner',
    desc:  'Trænere sender beskeder til holdet her. Du kan reagere med 👍 ✅ ❤️ — men det er kun trænere der skriver.',
  },
  {
    icon: 'calendar',
    color: '#ff9500',
    bg:    '#fff3e0',
    title: 'Ugeoversigt over træning',
    desc:  'Forsiden viser en ugekalender med træningstider for dine hold og dine børns hold — et hurtigt overblik hver dag.',
  },
  {
    icon: 'users',
    color: '#007aff',
    bg:    '#eff6ff',
    title: 'Hold og tilmeldinger',
    desc:  'Under Hold-fanen ser du alle de hold, du eller dine børn er tilmeldt via Conventus.',
  },
]

// ─── Consent screen ───────────────────────────────────────────────────────────

function LegalViewer({ url, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1001,
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderBottom: '1px solid var(--sep)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', color: 'var(--green)',
          fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 6px',
        }}>
          <div style={{ transform: 'rotate(180deg)', display: 'flex' }}>
            <Icon name="chevron" size={18} color="var(--green)" sw={2.5} />
          </div>
          Tilbage
        </button>
      </div>
      <iframe
        src={url}
        title="Juridisk dokument"
        style={{ flex: 1, border: 'none', width: '100%' }}
      />
    </div>
  )
}

function ConsentScreen({ user, onConsent }) {
  const [termsChecked,    setTermsChecked]    = useState(false)
  const [emailChecked,    setEmailChecked]    = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [signingOut,      setSigningOut]      = useState(false)
  const [confirmDecline,  setConfirmDecline]  = useState(false)
  const [legalUrl,        setLegalUrl]        = useState(null)

  async function handleAccept() {
    if (!termsChecked || saving) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        consentGiven:       true,
        consentVersion:     CONSENT_VERSION,
        consentTimestamp:   serverTimestamp(),
        emailNotifications: emailChecked,
      })
      onConsent({ emailNotifications: emailChecked })
    } catch {
      alert('Der opstod en fejl. Prøv igen.')
      setSaving(false)
    }
  }

  async function handleDecline() {
    setSigningOut(true)
    try {
      await signOut(auth)
    } catch {
      setSigningOut(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'var(--bg)', overflowY: 'auto',
      paddingTop: 'env(safe-area-inset-top, 0)',
      maxWidth: 430, margin: '0 auto',
    }}>
      {legalUrl && <LegalViewer url={legalUrl} onClose={() => setLegalUrl(null)} />}

      {/* Header */}
      <div style={{ background: 'var(--green)', padding: '36px 28px 32px', textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: 'rgba(255,255,255,.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 18px',
        }}>
          <Icon name="lock" size={28} color="white" sw={2} />
        </div>
        <h1 style={{ color: 'white', fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>
          Dine oplysninger
        </h1>
        <p style={{ color: 'rgba(255,255,255,.82)', fontSize: 14, lineHeight: 1.55, margin: 0, maxWidth: 280, marginInline: 'auto' }}>
          Inden du fortsætter, beder vi dig om at acceptere, hvordan vi håndterer dine data.
        </p>
      </div>

      {/* Content */}
      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Required consent */}
        <label className="consent-row consent-row--required">
          <div className="consent-checkbox-wrap">
            <input
              type="checkbox"
              className="consent-checkbox"
              checked={termsChecked}
              onChange={e => setTermsChecked(e.target.checked)}
            />
            <div className={`consent-check-box ${termsChecked ? 'consent-check-box--on' : ''}`}>
              {termsChecked && <Icon name="check" size={14} color="white" sw={3} />}
            </div>
          </div>
          <div>
            <span className="consent-row-title">
              Jeg accepterer{' '}
              <button type="button" className="consent-link"
                onClick={e => { e.stopPropagation(); e.preventDefault(); setLegalUrl('/legal/privatlivspolitik.html') }}>
                privatlivspolitikken
              </button>
              {' '}og{' '}
              <button type="button" className="consent-link"
                onClick={e => { e.stopPropagation(); e.preventDefault(); setLegalUrl('/legal/vilkaar-for-brug.html') }}>
                vilkårene for brug
              </button>
            </span>
            <span className="consent-row-sub">Krævet for at bruge appen</span>
          </div>
        </label>

        {/* Optional: email */}
        <label className="consent-row">
          <div className="consent-checkbox-wrap">
            <input
              type="checkbox"
              className="consent-checkbox"
              checked={emailChecked}
              onChange={e => setEmailChecked(e.target.checked)}
            />
            <div className={`consent-check-box ${emailChecked ? 'consent-check-box--on' : ''}`}>
              {emailChecked && <Icon name="check" size={14} color="white" sw={3} />}
            </div>
          </div>
          <div>
            <span className="consent-row-title">Email-notifikationer</span>
            <span className="consent-row-sub">Modtag en email når din træner sender en besked eller opretter et event. Du kan ændre dette til enhver tid under Profil.</span>
          </div>
        </label>

        {/* Push info */}
        <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: '#eff6ff', borderRadius: 12, border: '1px solid #bfdbfe' }}>
          <Icon name="bell" size={18} color="#2563eb" />
          <p style={{ margin: 0, fontSize: 13, color: '#1e40af', lineHeight: 1.55 }}>
            <strong>Push-notifikationer</strong> aktiveres separat via din telefons systemprompt.
            Vi spørger dig om tilladelse, første gang du tilgår notifikationsindstillinger.
          </p>
        </div>
      </div>

      {/* Sticky buttons */}
      <div style={{
        position: 'sticky', bottom: 0,
        padding: `12px 16px calc(12px + env(safe-area-inset-bottom, 0))`,
        background: 'linear-gradient(to top, var(--bg) 75%, transparent)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', height: 52, fontSize: 17, fontWeight: 700, borderRadius: 14, opacity: termsChecked ? 1 : .45 }}
          onClick={handleAccept}
          disabled={!termsChecked || saving}
        >
          {saving ? 'Gemmer…' : 'Acceptér og fortsæt'}
        </button>
        <button
          onClick={() => setConfirmDecline(true)}
          style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}
        >
          Afvis og log ud
        </button>
      </div>

      {/* In-app afvisningsbekræftelse */}
      {confirmDecline && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1002,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            width: '100%', maxWidth: 430,
            background: 'var(--bg)', borderRadius: '20px 20px 0 0',
            padding: `20px 20px calc(20px + env(safe-area-inset-bottom, 0))`,
          }}>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>
              Log ud uden at acceptere?
            </p>
            <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, marginBottom: 20 }}>
              Du kan ikke bruge appen uden at acceptere privatlivspolitikken. Du vil blive sendt tilbage til velkomstskærmen.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmDecline(false)}
                style={{ flex: 1, height: 46, borderRadius: 12, border: '1.5px solid var(--sep)', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
              >
                Fortryd
              </button>
              <button
                onClick={handleDecline}
                disabled={signingOut}
                style={{ flex: 1, height: 46, borderRadius: 12, border: 'none', background: '#ff3b30', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                {signingOut ? 'Logger ud…' : 'Log ud'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WelcomeScreen({ user, onDone }) {
  const [saving, setSaving] = useState(false)

  async function done() {
    setSaving(true)
    updateDoc(doc(db, 'users', user.uid), { onboardingDone: true }).catch(() => {})
    onDone()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'var(--bg)',
      overflowY: 'auto',
      paddingTop: 'env(safe-area-inset-top, 0)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 100px)',
      maxWidth: 430,
      margin: '0 auto',
    }}>
      {/* Top hero */}
      <div style={{
        background: 'var(--green)',
        padding: '40px 28px 36px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: 'rgba(255,255,255,.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          fontSize: 32, fontWeight: 800, color: 'white',
          letterSpacing: 1,
        }}>
          S
        </div>
        <h1 style={{ color: 'white', fontSize: 26, fontWeight: 800, marginBottom: 8 }}>
          Hej, {user.firstName || user.name}! 👋
        </h1>
        <p style={{ color: 'rgba(255,255,255,.8)', fontSize: 15, lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>
          Velkommen til Sejs-Svejbæk IF's app — ét sted til alt om din klub.
        </p>
      </div>

      {/* Feature cards */}
      <div style={{ padding: '24px 16px 0' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
          Det kan appen
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {WELCOME_FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: f.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon name={f.icon} size={20} color={f.color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.45 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tip: link Conventus */}
        <div style={{
          marginTop: 16, padding: '14px 16px',
          background: '#fff3e0', borderRadius: 'var(--radius)',
          display: 'flex', gap: 12, alignItems: 'flex-start',
          border: '1px solid #fed7aa',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: '#ff9500', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon name="person" size={18} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 3 }}>
              Tilknyt dine hold
            </div>
            <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.45 }}>
              Gå til <strong>Profil → Tilknyttede emails</strong> og tilføj den email du bruger i Conventus. Så ser du automatisk dine hold og dine børns hold.
            </div>
          </div>
        </div>
      </div>

      {/* Sticky button */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 430,
        padding: `16px 16px calc(16px + env(safe-area-inset-bottom, 0))`,
        background: 'linear-gradient(to top, var(--bg) 70%, transparent)',
      }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', height: 52, fontSize: 17, fontWeight: 700, borderRadius: 14 }}
          onClick={done}
          disabled={saving}
        >
          Kom i gang
        </button>
      </div>
    </div>
  )
}

// ─── Træner-introduktion ──────────────────────────────────────────────────────

const TRAINER_FEATURES = [
  {
    icon: 'send',
    color: '#1a5c2a',
    bg:   '#e8f5ec',
    title: 'Send beskeder til holdet',
    desc:  'Skriv direkte til alle spillere og forældre på dit hold. De får besked med det samme.',
  },
  {
    icon: 'calendar',
    color: '#e65c00',
    bg:   '#fff0e6',
    title: 'Opret kampe og events',
    desc:  'Planlæg kampe, stævner og andre events. Vælg dato, tid og sted — holdet notificeres automatisk.',
  },
  {
    icon: 'users',
    color: '#2563eb',
    bg:   '#eff6ff',
    title: 'Udtag spillere til kampe',
    desc:  'Vælg hvilke spillere der er udtaget til en kamp. Alle på holdet kan se udtagelsen i kalenderen.',
  },
  {
    icon: 'eye',
    color: '#7c3aed',
    bg:   '#f5f3ff',
    title: 'Se din holdliste',
    desc:  'Få et fuldt overblik over alle tilmeldte på dit hold under Hold-fanen.',
  },
  {
    icon: 'bell',
    color: '#b45309',
    bg:   '#fef3c7',
    title: 'Push- og email-notifikationer',
    desc:  'Spillere og forældre modtager automatisk besked om dine events og beskeder — du behøver ikke gøre noget ekstra.',
  },
]

function TrainerWelcomeScreen({ user, onDone }) {
  const [saving, setSaving] = useState(false)

  async function done() {
    setSaving(true)
    updateDoc(doc(db, 'users', user.uid), { trainerOnboardingDone: true }).catch(() => {})
    onDone()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'var(--bg)', overflowY: 'auto',
      paddingTop: 'env(safe-area-inset-top, 0)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 100px)',
      maxWidth: 430, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ background: 'var(--green)', padding: '36px 24px 28px', textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: 'rgba(255,255,255,.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <Icon name="shirt" size={28} color="white" sw={1.75} />
        </div>
        <h1 style={{ color: 'white', fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>
          Du er registreret som træner
        </h1>
        <p style={{ color: 'rgba(255,255,255,.85)', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          Her er et hurtigt overblik over hvad du kan gøre i SSIF-appen som træner.
        </p>
      </div>

      {/* Feature cards */}
      <div style={{ padding: '20px 16px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {TRAINER_FEATURES.map((f, i) => (
            <div key={i} style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: f.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon name={f.icon} size={20} color={f.color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tip */}
        <div style={{
          marginTop: 14, padding: '14px 16px',
          background: 'var(--green-soft)', borderRadius: 'var(--radius)',
          display: 'flex', gap: 12, alignItems: 'flex-start',
          border: '1px solid rgba(26,92,42,.15)',
        }}>
          <Icon name="alert-circle" size={20} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--green)', lineHeight: 1.5 }}>
            <strong>Trænertilladelse styres via Conventus.</strong> Har du spørgsmål til dine rettigheder i appen, kontakt foreningens administrator.
          </p>
        </div>
      </div>

      {/* Sticky button */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 430,
        padding: `16px 16px calc(16px + env(safe-area-inset-bottom, 0))`,
        background: 'linear-gradient(to top, var(--bg) 70%, transparent)',
      }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', height: 52, fontSize: 17, fontWeight: 700, borderRadius: 14 }}
          onClick={done}
          disabled={saving}
        >
          Forstået — kom i gang
        </button>
      </div>
    </div>
  )
}

// ─── Banner-karrusel ─────────────────────────────────────────────────────────

function BannerCarousel({ banners }) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (banners.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % banners.length), 5000)
    return () => clearInterval(t)
  }, [banners.length])

  if (!banners.length) return null
  const b = banners[Math.min(idx, banners.length - 1)]

  const inner = (
    <div style={{ position: 'relative', width: '100%', height: 180, flexShrink: 0, overflow: 'hidden', borderRadius: 'var(--radius)' }}>
      <img src={b.imageUrl} alt={b.title || ''}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={e => { e.target.style.display = 'none' }} />
      {(b.title || b.subtitle) && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 14px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,.65))' }}>
          {b.title    && <div style={{ color: 'white', fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{b.title}</div>}
          {b.subtitle && <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 12, marginTop: 2 }}>{b.subtitle}</div>}
        </div>
      )}
      {banners.length > 1 && (
        <div style={{ position: 'absolute', bottom: 10, right: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
          {banners.map((_, i) => (
            <button key={i} onClick={e => { e.preventDefault(); e.stopPropagation(); setIdx(i) }}
              style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3, border: 'none', padding: 0, cursor: 'pointer', transition: 'all .3s', background: i === idx ? 'white' : 'rgba(255,255,255,.5)' }} />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ padding: '12px 16px 0' }}>
      {b.linkUrl
        ? <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none' }}>{inner}</a>
        : inner}
    </div>
  )
}

// ─── Dashboard helpers ────────────────────────────────────────────────────────

const _DAY_MAP = {
  'mandag':0,'man':0,'tirsdag':1,'tir':1,'tirsd':1,
  'onsdag':2,'ons':2,'torsdag':3,'tor':3,'tors':3,
  'fredag':4,'fre':4,'lørdag':5,'lör':5,'søndag':6,'søn':6,'son':6,
}
const DAY_SHORT = ['Man','Tir','Ons','Tor','Fre','Lør','Søn']

function parseSessions(traeningstider) {
  if (!traeningstider) return []
  const out = []
  traeningstider.split(/[,;\n]+/).forEach(seg => {
    const s = seg.trim().toLowerCase()
    if (!s) return
    let dayIdx = -1, best = ''
    for (const [k, v] of Object.entries(_DAY_MAP)) {
      if (s.startsWith(k) && k.length > best.length) { dayIdx = v; best = k }
    }
    if (dayIdx < 0) return
    const m = seg.match(/(\d{1,2})[.:h](\d{2})/)
    out.push({ dayIdx, time: m ? `${m[1].padStart(2,'0')}:${m[2]}` : '' })
  })
  return out
}

// ─── ICS helpers ─────────────────────────────────────────────────────────────

function icsTime(dato, hhmm) {
  return dato.replace(/-/g, '') + 'T' + (hhmm || '080000').replace(':', '') + '00'
}

function makeVEvent({ uid, summary, dato, tidStart, tidSlut, sted, rrule }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${icsTime(dato, tidStart)}`,
    `DTEND:${icsTime(dato, tidSlut || tidStart)}`,
    `SUMMARY:${(summary || '').replace(/[,;\\]/g, s => '\\' + s)}`,
    sted ? `LOCATION:${sted.replace(/[,;\\]/g, s => '\\' + s)}` : null,
    rrule ? `RRULE:${rrule}` : null,
    'END:VEVENT',
  ]
  return lines.filter(Boolean).join('\r\n')
}

function downloadICSFile(filename, vevents) {
  const cal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SSIF//SSIF App//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:SSIF',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n')
  const blob = new Blob([cal], { type: 'text/calendar;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const RRULE_DAY = ['MO','TU','WE','TH','FR','SA','SU']

function expandTrainingSessions(holds, weeksAhead = 10) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysFromMonday = (today.getDay() + 6) % 7
  const monday = new Date(today)
  monday.setDate(today.getDate() - daysFromMonday)

  const results = []
  holds.forEach(hold => {
    parseSessions(hold.traeningstider).forEach(({ dayIdx, time }) => {
      for (let week = 0; week < weeksAhead; week++) {
        const d = new Date(monday)
        d.setDate(monday.getDate() + week * 7 + dayIdx)
        if (d < today) continue
        const dato = d.toISOString().slice(0, 10)
        results.push({
          _isTraening: true,
          id: `traening_${hold.conventus_id}_${dato}_${time}`,
          type: 'træning',
          dato,
          dayIdx,
          tidStart: time,
          titel: 'Træning',
          holdNavn: hold.titel,
          holdId: String(hold.conventus_id),
        })
      }
    })
  })
  results.sort((a, b) =>
    (a.dato || '').localeCompare(b.dato || '') ||
    (a.tidStart || '').localeCompare(b.tidStart || '')
  )
  return results
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardScreen({ user, unreadMsgs = 0, news, onNavigate, showPushBanner, onEnableNotifications }) {
  const totalUnread = unreadMsgs
  const [calHolds,     setCalHolds]     = useState([])
  const [events,       setEvents]       = useState([])
  const [banners,      setBanners]      = useState([])
  const [eventsCount,  setEventsCount]  = useState(3)

  useEffect(() => {
    const ids = new Set((user.holdIds || []).map(String))
    ;(user.familyMembers || []).forEach(m => m.holdId && ids.add(String(m.holdId)))
    if (!ids.size) return
    getDocs(collection(db, 'holds'))
      .then(snap => {
        setCalHolds(
          snap.docs.map(d => d.data())
            .filter(h => ids.has(String(h.conventus_id)) && h.traeningstider)
        )
      })
      .catch(() => {})
  }, [JSON.stringify(user.holdIds), JSON.stringify(user.familyMembers)])

  useEffect(() => {
    const today   = new Date().toISOString().slice(0, 10)
    const dashIds = [...new Set([
      ...(user.holdIds      || []).map(String),
      ...(user.lederHoldIds || []).map(String),
    ])]
    if (dashIds.length) {
      const chunks = []
      for (let i = 0; i < dashIds.length; i += 30) chunks.push(dashIds.slice(i, i + 30))
      Promise.all(chunks.map(chunk =>
        getDocs(query(collection(db, 'events'), where('holdId', 'in', chunk)))
      ))
        .then(snaps => {
          const seen = new Set()
          const all  = snaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
            .filter(ev => {
              if (seen.has(ev.id) || (ev.dato || '') < today) return false
              seen.add(ev.id); return true
            })
          all.sort((a, b) =>
            (a.dato || '').localeCompare(b.dato || '') ||
            (a.tidStart || '').localeCompare(b.tidStart || '')
          )
          setEvents(all)
        })
        .catch(() => {})
    }
    getDocs(query(collection(db, 'banners'), orderBy('order')))
      .then(snap => setBanners(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.aktiv !== false)))
      .catch(() => {})
    getDoc(doc(db, 'settings', 'app'))
      .then(s => { if (s.exists() && s.data().eventsOnDashboard !== undefined) setEventsCount(s.data().eventsOnDashboard) })
      .catch(() => {})
  }, [])

  // holdPersonMap: holdId → fornavn — kun ikke-tomt når der er familiemedlemmer
  const holdPersonMap = (() => {
    const fm = user.familyMembers || []
    if (!fm.length) return {}
    const fn = n => (n || '').split(' ')[0] || ''
    const map = {}
    ;(user.holdIds || []).forEach(id => { map[String(id)] = fn(user.firstName || user.name) })
    fm.forEach(m => { if (m.holdId) map[String(m.holdId)] = fn(m.name) })
    return map
  })()

  // Bygger ugeoversigt: sessions per dag
  const today    = new Date()
  const todayIdx = (today.getDay() + 6) % 7  // 0=Man … 6=Søn
  const monday   = new Date(today)
  monday.setDate(today.getDate() - todayIdx)
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d
  })

  const weekStart = weekDates[0].toISOString().slice(0, 10)
  const weekEnd   = weekDates[6].toISOString().slice(0, 10)
  const weekEvents   = events.filter(ev => ev.dato >= weekStart && ev.dato <= weekEnd)
  const futureEvents = events.filter(ev => ev.dato > weekEnd)

  const byDay = [[], [], [], [], [], [], []]
  calHolds.forEach(hold => {
    parseSessions(hold.traeningstider).forEach(({ dayIdx, time }) => {
      byDay[dayIdx].push({ hold, time })
    })
  })
  byDay.forEach(day => day.sort((a, b) => a.time.localeCompare(b.time)))

  const weekDayItems = weekDates.map((date, i) => {
    const dato = date.toISOString().slice(0, 10)
    const trainings = byDay[i].map(s => ({
      _type: 'træning', time: s.time,
      label: s.hold.titel,
      person: holdPersonMap[String(s.hold.conventus_id)] || null,
      hold: s.hold,
    }))
    const evs = weekEvents.filter(ev => ev.dato === dato).map(ev => ({
      _type: ev.type || 'generel',
      time: ev.tidStart || '', label: ev.titel, sted: ev.sted || '',
      person: holdPersonMap[String(ev.holdId)] || null,
      ev,
    }))
    const items = [...trainings, ...evs].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    return { date, i, dato, items }
  })
  const hasWeekActivity = weekDayItems.some(d => d.items.length > 0)

  return (
    <div className="screen">
      {showPushBanner && (
        <button className="push-banner" onClick={onEnableNotifications}>
          <div className="push-banner-icon">
            <Icon name="bell" size={20} color="var(--green)" />
          </div>
          <div className="push-banner-text">
            <span className="push-banner-title">Aktivér notifikationer</span>
            <span className="push-banner-body">Få besked om kampe og vigtige meddelelser</span>
          </div>
          <Icon name="chevron" size={18} color="var(--green)" sw={2.5} />
        </button>
      )}

      <div className="dashboard-greeting">
        <div>
          <p className="greeting-sub">God dag</p>
          <h2 className="greeting-name">{user.firstName || user.name} 👋</h2>
        </div>
        <button onClick={() => onNavigate('profil')} className="dashboard-profile-btn" aria-label="Gå til profil">
          <div style={{ position: 'relative' }}>
            <Avatar initials={(user.firstName || user.initials || '').slice(0, 7)} size={44} />
            <span className="dashboard-profile-badge">
              <Icon name="person" size={10} color="white" sw={2.5} />
            </span>
          </div>
          <span className="dashboard-profile-label">Profil</span>
        </button>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat-card" onClick={() => onNavigate('messages')}>
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <Icon name="message" size={22} color="#5856d6" />
            {totalUnread > 0 && <span className="stat-badge">{totalUnread}</span>}
          </div>
          <p className="stat-value" style={{ color: '#5856d6' }}>{totalUnread}</p>
          <p className="stat-label">Ulæste beskeder</p>
        </div>
        <div className="stat-card" onClick={() => onNavigate('news')}>
          <Icon name="news" size={22} color="#ff9500" />
          <p className="stat-value" style={{ color: '#ff9500' }}>{news.length}</p>
          <p className="stat-label">Nyheder</p>
        </div>
      </div>

      {/* ── Sponsor-/reklamebanners ────────────────── */}
      {banners.length > 0 && <BannerCarousel banners={banners} />}

      {/* ── Denne uge (træning + events samlet) ── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '20px 16px 10px' }}>
        <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Denne uge</span>
        <button onClick={() => onNavigate('kalender')}
          style={{ border: 'none', background: 'none', color: 'var(--green)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '4px 0', WebkitTapHighlightColor: 'transparent' }}>
          Se alt →
        </button>
      </div>
      <div style={{ padding: '0 16px 4px' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>

          {/* Dag-strip */}
          <div style={{ display: 'flex', padding: '12px 6px 10px', borderBottom: '1px solid var(--sep)' }}>
            {weekDates.map((date, i) => {
              const isToday = i === todayIdx
              const isPast  = i < todayIdx
              const dayItems = weekDayItems[i].items
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: isToday ? 'var(--green)' : 'var(--text3)' }}>
                    {DAY_SHORT[i]}
                  </span>
                  <div style={{
                    width: 28, height: 28, borderRadius: 14,
                    background: isToday ? 'var(--green)' : 'transparent',
                    color: isToday ? 'white' : isPast ? 'var(--text3)' : 'var(--text)',
                    fontSize: 13, fontWeight: isToday ? 700 : 500,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {date.getDate()}
                  </div>
                  <div style={{ display: 'flex', gap: 2, height: 5, alignItems: 'center' }}>
                    {dayItems.slice(0, 3).map((item, j) => (
                      <div key={j} style={{
                        width: 4, height: 4, borderRadius: 2,
                        background: isPast ? '#d1d5db'
                          : item._type === 'træning' ? 'var(--green)'
                          : item._type === 'kamp'    ? '#e65c00'
                          : '#5856d6',
                      }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Aktivitetsliste */}
          {!hasWeekActivity ? (
            <p style={{ padding: '16px', textAlign: 'center', fontSize: 13, color: 'var(--text3)', margin: 0 }}>
              Ingen aktiviteter denne uge
            </p>
          ) : weekDayItems.map(({ date, i, dato, items }) => {
            if (!items.length) return null
            const isToday = i === todayIdx
            const isPast  = i < todayIdx
            const dayLabel = isToday ? 'I dag'
              : date.toLocaleDateString('da-DK', { weekday: 'long' }).replace(/^./, c => c.toUpperCase())
            return (
              <div key={dato} style={{ opacity: isPast ? 0.5 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 3px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--green)' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
                    {dayLabel}
                  </span>
                  {isToday && (
                    <span style={{ fontSize: 9, background: 'var(--green)', color: 'white', padding: '1px 6px', borderRadius: 8, fontWeight: 800 }}>
                      I DAG
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
                    {date.getDate()}. {date.toLocaleDateString('da-DK', { month: 'short' })}
                  </span>
                </div>
                {items.map((item, j) => {
                  const accentColor = item._type === 'træning' ? 'var(--green)'
                    : item._type === 'kamp'   ? '#e65c00'
                    : item._type === 'stævne' ? '#ff9500'
                    : '#5856d6'
                  const typeLabel = item._type === 'træning' ? 'Træning'
                    : item._type === 'kamp'   ? 'Kamp'
                    : item._type === 'stævne' ? 'Stævne'
                    : 'Event'
                  const inner = <>
                    <div style={{ width: 3, alignSelf: 'stretch', background: accentColor, borderRadius: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: accentColor, minWidth: 42, flexShrink: 0 }}>
                      {item.time || '——'}
                    </span>
                    <span style={{ flex: 1, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.person
                        ? <><b style={{ fontWeight: 700 }}>{item.person}</b><span style={{ color: 'var(--text2)', fontWeight: 400 }}> · {item.label}</span></>
                        : <span style={{ fontWeight: 600 }}>{item.label}</span>
                      }
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: accentColor, background: accentColor + '1a', padding: '2px 8px', borderRadius: 20, flexShrink: 0 }}>
                      {typeLabel}
                    </span>
                  </>
                  const rowStyle = { width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }
                  return item._type === 'træning' ? (
                    <button key={j} onClick={() => onNavigate('team-detail', item.hold)} style={rowStyle}>{inner}</button>
                  ) : (
                    <button key={j} onClick={() => onNavigate('event-detail', item.ev)} style={rowStyle}>{inner}</button>
                  )
                })}
                <div style={{ height: 4 }} />
              </div>
            )
          })}

          <button onClick={() => onNavigate('kalender')}
            style={{ display: 'block', width: '100%', padding: '11px 14px', border: 'none', background: 'none', color: 'var(--green)', fontSize: 13, fontWeight: 600, textAlign: 'center', borderTop: '1px solid var(--sep)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
            Vis fuld kalender →
          </button>
        </div>
      </div>

      {/* ── Kommende (events efter denne uge) ─────────────────── */}
      {futureEvents.length > 0 && eventsCount > 0 && (
        <>
          <SectionHeader title="Kommende" />
          <div className="card-list">
            {futureEvents.slice(0, eventsCount).map(ev => {
              const d = ev.dato ? new Date(ev.dato + 'T12:00:00') : null
              const typeColor = { kamp: '#e65c00', generel: '#5856d6', stævne: '#ff9500' }
              const color = typeColor[ev.type] || '#5856d6'
              return (
                <button key={ev.id} onClick={() => onNavigate('event-detail', ev)} style={{
                  width: '100%', background: 'var(--surface)', borderRadius: 'var(--radius)',
                  padding: '12px 14px', display: 'flex', alignItems: 'center',
                  gap: 12, boxShadow: 'var(--shadow)', border: 'none', cursor: 'pointer',
                  textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, background: color + '18',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>
                      {d ? d.getDate() : '?'}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 600, color, textTransform: 'uppercase' }}>
                      {d ? d.toLocaleDateString('da-DK', { month: 'short' }) : ''}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                      {ev.titel}
                      {holdPersonMap[String(ev.holdId)] && (
                        <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 13 }}> ({holdPersonMap[String(ev.holdId)]})</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                      {ev.holdNavn}{ev.tidStart ? ` · ${ev.tidStart}` : ''}{ev.sted ? ` · ${ev.sted}` : ''}
                    </div>
                  </div>
                  {ev.type && ev.type !== 'generel' && (
                    <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '18', padding: '2px 8px', borderRadius: 20, flexShrink: 0, textTransform: 'capitalize' }}>
                      {ev.type}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── Seneste nyheder ────────────────────────── */}
      <SectionHeader title="Seneste nyheder" />
      <div className="card-list">
        {news.slice(0, 2).map(article => (
          <div className="news-preview-card" key={article.id} onClick={() => onNavigate('news-detail', article)}>
            {article.imageUrl && (
              <img
                src={article.imageUrl} alt=""
                style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                onError={e => { e.target.style.display = 'none' }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <CategoryPill label={article.category} color={article.categoryColor || '#1a5c2a'} />
              <span className="news-preview-date">{article.date}</span>
            </div>
            <p className="news-preview-title">{article.title}</p>
            {article.excerpt && (
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.45, margin: 0 }}>
                {article.excerpt.length > 90 ? article.excerpt.slice(0, 90) + '…' : article.excerpt}
              </p>
            )}
            <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>Læs mere →</span>
          </div>
        ))}
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function relevantHoldIds(user) {
  const ids = new Set()
  ;(user.holds         ?? []).forEach(id => ids.add(String(id)))
  ;(user.familyMembers ?? []).forEach(m => m.holdId && ids.add(String(m.holdId)))
  return ids
}

function TeamsScreen({ onSelectTeam, user, onGoToProfile }) {
  const [holds,         setHolds]         = useState([])
  const [afdelinger,    setAfdelinger]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [linkedMembers, setLinkedMembers] = useState(null) // null=loading, []=ingen

  useEffect(() => {
    getDocs(collection(db, 'holds'))
      .then(snap => setHolds(snap.docs.map(d => ({ _id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLoading(false))
    getDocs(collection(db, 'afdelinger'))
      .then(snap => setAfdelinger(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  // Hent Conventus-tilmeldinger for brugerens emails (primær + verificerede extra)
  useEffect(() => {
    const extras       = (user.extraEmails || []).map(e => typeof e === 'string' ? { email: e, verified: false } : e)
    const verifiedExtra = extras.filter(e => e.verified).map(e => e.email)
    const allEmails    = [user.email, ...verifiedExtra].filter(Boolean)
    if (!allEmails.length) { setLinkedMembers([]); return }

    getDocs(query(
      collection(db, 'members'),
      where('allEmails', 'array-contains-any', allEmails.slice(0, 30))
    )).then(snap => setLinkedMembers(snap.docs.map(d => d.data())))
      .catch(() => setLinkedMembers([]))
  }, [user.email, JSON.stringify(user.extraEmails)])

  // Opslag: holds og afdelinger fra Firestore
  const holdById = {}
  holds.forEach(h => { holdById[String(h.conventus_id)] = h })

  const afdById = {}
  afdelinger.forEach(a => { afdById[String(a.id)] = a })

  if (loading || linkedMembers === null) return (
    <div className="screen" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
      Henter hold…
    </div>
  )

  if (!linkedMembers.length) return (
    <div className="screen" style={{ padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <Icon name="users" size={44} color="var(--text3)" />
      <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Ingen holdtilmeldinger fundet</p>
      <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, margin: 0, maxWidth: 280 }}>
        Din email er muligvis ikke tilknyttet Conventus. Prøv at tilføje den email du bruger i din klub.
      </p>
      {onGoToProfile && (
        <button type="button" className="btn btn-primary" style={{ marginTop: 4 }} onClick={onGoToProfile}>
          Gå til Profil og tilføj email
        </button>
      )}
    </div>
  )

  return (
    <div className="screen">
      {linkedMembers.map(m => (
        <div key={m.conventus_id} style={{ marginBottom: 4 }}>
          {/* Person-header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 6px' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: 'var(--green-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="person-circle" size={16} color="var(--green)" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{m.name}</span>
          </div>

          {m.holds?.length > 0 ? (
            <div className="list-group" style={{ marginTop: 0 }}>
              {m.holds.map((h, hi) => {
                // Kilde til sandheden: holds/{conventus_id} i Firestore
                const fsHold   = holdById[String(h.conventus_id)]
                const titel    = fsHold?.titel    ?? `Hold #${h.conventus_id}`
                const afdNavn  = afdById[String(fsHold?.afdeling_id)]?.navn
                               ?? fsHold?.aktivitet_titel
                               ?? null
                const brugerApp = fsHold?.aktiv === true
                const tappable  = !!fsHold
                const detalje  = [
                  afdNavn,
                  fsHold?.traeningstider
                    || (fsHold?.periode_fra ? `${fsHold.periode_fra} – ${fsHold.periode_til}` : null),
                ].filter(Boolean).join(' · ')

                const inner = (
                  <>
                    <div className="list-item-icon" style={{
                      background: brugerApp ? 'var(--green-soft)' : 'var(--bg)',
                    }}>
                      <Icon name="users" size={17} color={brugerApp ? 'var(--green)' : 'var(--text3)'} />
                    </div>
                    <div className="list-item-body">
                      <span className="list-item-title">{titel}</span>
                      {detalje
                        ? <span className="list-item-detail">{detalje}</span>
                        : null}
                    </div>
                    {tappable && <Chevron />}
                  </>
                )

                return (
                  <div key={h.conventus_id ?? hi}>
                    {hi > 0 && <div className="list-separator" />}
                    {tappable
                      ? <button className="list-item" onClick={() => onSelectTeam(fsHold)}>{inner}</button>
                      : <div className="list-item" style={{ cursor: 'default' }}>{inner}</div>
                    }
                  </div>
                )
              })}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text3)', padding: '0 16px 8px 58px' }}>
              Ingen holdtilmeldinger
            </p>
          )}
        </div>
      ))}
      {/* Hint: tilføj email */}
      {onGoToProfile && (
        <div style={{ margin: '16px 16px 0', padding: '12px 14px', background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon name="mail" size={18} color="var(--text3)" />
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text2)', lineHeight: 1.45 }}>
            Mangler du et hold? Tilføj den email du bruger i Conventus under{' '}
            <button type="button" onClick={onGoToProfile}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--green)', fontWeight: 700, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
              Profil
            </button>
            .
          </span>
        </div>
      )}

      {/* Tilmeldingslink */}
      <div style={{ margin: '20px 16px 0' }}>
        <a href="https://www.sejssvejbaek-if.dk/tilmelding"
           target="_blank" rel="noopener noreferrer"
           style={{ textDecoration: 'none', display: 'block' }}>
          <div style={{
            background: 'var(--green)',
            borderRadius: 'var(--radius)',
            padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 16,
            boxShadow: '0 4px 14px rgba(26,92,42,.35)',
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, flexShrink: 0,
              background: 'rgba(255,255,255,.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="user-plus" size={24} color="white" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'white', lineHeight: 1.2 }}>
                Tilmeld dig selv eller dit barn
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: 3 }}>
                Tilmelding til hold på sejssvejbaek-if.dk →
              </div>
            </div>
          </div>
        </a>
      </div>
      <div style={{ height: 20 }} />
    </div>
  )
}

function TeamDetailScreen({ team: hold, user }) {
  const [members,        setMembers]        = useState([])
  const [membersLoading, setMembersLoading] = useState(false)

  const isTrainerForTeam = user?.role === 'admin' ||
    (user?.lederHoldIds || []).map(String).includes(String(hold.conventus_id))

  useEffect(() => {
    if (!isTrainerForTeam) return
    setMembersLoading(true)
    getDocs(query(
      collection(db, 'members'),
      where('holdIds', 'array-contains', String(hold.conventus_id))
    ))
      .then(snap => {
        const all = snap.docs.map(d => ({
          conventus_id: d.data().conventus_id,
          name:  d.data().name || 'Ukendt',
          email: (d.data().allEmails || [])[0] || '',
        }))
        all.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'))
        setMembers(all)
      })
      .catch(() => {})
      .finally(() => setMembersLoading(false))
  }, [String(hold.conventus_id), isTrainerForTeam])

  return (
    <div className="screen">
      <div className="team-hero">
        <div className="team-hero-icon"><Icon name="trophy" size={36} color="white" /></div>
        <h2 className="team-hero-name">{hold.titel}</h2>
        {hold.aktivitet_titel && <p className="team-hero-category">{hold.aktivitet_titel}</p>}
      </div>

      <SectionHeader title="Oplysninger" />
      <div className="list-group">
        {hold.traeningstider && (
          <div className="list-item" style={{ cursor: 'default' }}>
            <div className="list-item-icon" style={{ background: 'var(--green-soft)' }}>
              <Icon name="calendar" size={17} color="var(--green)" />
            </div>
            <div className="list-item-body">
              <span className="list-item-title">Træningstider</span>
              <span className="list-item-detail">{hold.traeningstider}</span>
            </div>
          </div>
        )}
        {hold.periode_fra && (
          <>
            {hold.traeningstider && <div className="list-separator" />}
            <div className="list-item" style={{ cursor: 'default' }}>
              <div className="list-item-icon" style={{ background: '#fff3e0' }}>
                <Icon name="calendar" size={17} color="#ff9500" />
              </div>
              <div className="list-item-body">
                <span className="list-item-title">Sæson</span>
                <span className="list-item-detail">{hold.periode_fra} – {hold.periode_til}</span>
              </div>
            </div>
          </>
        )}
        {!hold.traeningstider && !hold.periode_fra && (
          <div className="list-item" style={{ cursor: 'default' }}>
            <div className="list-item-body">
              <span className="list-item-detail" style={{ color: 'var(--text3)' }}>Ingen oplysninger tilgængelige endnu</span>
            </div>
          </div>
        )}
      </div>

      {hold.beskrivelse ? (
        <>
          <SectionHeader title="Om holdet" />
          <div style={{ margin: '0 16px' }}>
            <div className="hold-beskrivelse"
                 dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(hold.beskrivelse) }} />
          </div>
        </>
      ) : null}

      {/* ── Spillerliste — kun for holdets egne trænere ── */}
      {isTrainerForTeam && (
        <>
          <SectionHeader title={members.length ? `Spillere (${members.length})` : 'Spillere'} />
          {membersLoading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <div className="loading-dots"><span /><span /><span /></div>
            </div>
          ) : members.length === 0 ? (
            <p style={{ padding: '4px 16px 12px', fontSize: 13, color: 'var(--text3)' }}>
              Ingen spillere fundet — kør sync-members i admin-panelet.
            </p>
          ) : (
            <div className="list-group">
              {members.map((m, i) => {
                const initials = (m.name || '??').split(' ')
                  .map(w => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={m.conventus_id ?? i}>
                    {i > 0 && <div className="list-separator" />}
                    <div className="list-item" style={{ cursor: 'default' }}>
                      <div className="list-item-icon"
                           style={{ background: 'var(--green-soft)', borderRadius: '50%' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
                          {initials}
                        </span>
                      </div>
                      <div className="list-item-body">
                        <span className="list-item-title">{m.name}</span>
                        {m.email && (
                          <span className="list-item-detail">{m.email}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <div style={{ height: 20 }} />
    </div>
  )
}

// ─── News (Firestore + fallback) ──────────────────────────────────────────────

function NewsScreen({ onSelectArticle, articles, isLive }) {
  return (
    <div className="screen">
      <div className="section-header-row">
        <span className="section-header-text">Alle nyheder</span>
        <FirestoreDot live={isLive} />
      </div>
      <div className="card-list">
        {articles.map(article => (
          <div className="news-card" key={article.id} onClick={() => onSelectArticle(article)}>
            {article.imageUrl && (
              <img className="news-card-image" src={article.imageUrl} alt=""
                   onError={e => { e.target.style.display = 'none' }} />
            )}
            <div className="news-card-top">
              <CategoryPill label={article.category} color={article.categoryColor || '#1a5c2a'} />
              <span className="news-date">{article.date}</span>
            </div>
            <h3 className="news-title">{article.title}</h3>
            {article.excerpt && <p className="news-excerpt">{article.excerpt}</p>}
          </div>
        ))}
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

function NewsDetailScreen({ article }) {
  return (
    <div className="screen">
      {article.imageUrl && (
        <img className="article-hero-image" src={article.imageUrl} alt=""
             onError={e => { e.target.style.display = 'none' }} />
      )}
      <div className="article">
        <div className="article-meta">
          <CategoryPill label={article.category} color={article.categoryColor || '#1a5c2a'} />
          <span className="news-date">{article.date}</span>
        </div>
        <h1 className="article-title">{article.title}</h1>
        <div className="article-divider" />
        {(article.body || '').split('\n\n').map((para, i) => {
          if (para.startsWith('•') || para.includes('\n•')) {
            const items = para.split('\n').filter(l => l.startsWith('•'))
            return (
              <ul className="article-list" key={i}>
                {items.map((item, j) => <li key={j}>{item.replace('•', '').trim()}</li>)}
              </ul>
            )
          }
          return <p className="article-para" key={i}>{para}</p>
        })}
      </div>
    </div>
  )
}

// ─── Messages (feed med emoji-reaktioner) ─────────────────────────────────────

const EMOJIS = ['👍', '✅', '❤️']

function fmtMsgDate(ts) {
  if (!ts) return ''
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  const diff = Date.now() - d.getTime()
  if (diff < 3600000)   return `${Math.floor(diff / 60000)} min`
  if (diff < 86400000)  return d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString('da-DK', { weekday: 'short' })
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
}

function MessageCard({ msg, unread, onTap }) {
  const total = Object.values(msg.reaktioner || {}).reduce((s, n) => s + (Number(n) || 0), 0)
  return (
    <div className="news-preview-card" onClick={onTap}
         style={{ borderLeft: `3px solid ${unread ? 'var(--green)' : 'transparent'}`, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 18,
          background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>
            {(msg.afsenderNavn || msg.authorName || 'T').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
            {msg.afsenderNavn || msg.authorName || 'Træner'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {msg.holdNavn || (msg.targetHolds?.[0]?.titel) || ''}{(msg.holdNavn || msg.targetHolds?.[0]?.titel) ? ' · ' : ''}{fmtMsgDate(msg.oprettet || msg.createdAt)}
          </div>
        </div>
        {unread && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--green)', flexShrink: 0 }} />}
      </div>
      <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>
        {((msg.tekst || msg.text) ?? '').slice(0, 130)}{((msg.tekst || msg.text) ?? '').length > 130 ? '…' : ''}
      </p>
      {total > 0 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          {EMOJIS.map(e => {
            const c = Number(msg.reaktioner?.[e] || 0)
            return c > 0 ? <span key={e} style={{ fontSize: 12, color: 'var(--text2)' }}>{e} {c}</span> : null
          })}
        </div>
      )}
    </div>
  )
}

function MessageDetailScreen({ msg, user, onBack }) {
  const [reak, setReak]       = useState({ ...(msg.reaktioner || { '👍': 0, '✅': 0, '❤️': 0 }) })
  const [userR, setUserR]     = useState({ ...(msg.userReactions || {}) })
  const [saving, setSaving]   = useState(false)
  const myEmoji = userR[user.uid] ?? null

  async function react(emoji) {
    if (saving) return
    setSaving(true)
    const ref  = doc(db, 'messages', msg.id)
    const prev = myEmoji
    try {
      const updates = {}
      if (prev === emoji) {
        updates[`userReactions.${user.uid}`] = deleteField()
        updates[`reaktioner.${emoji}`]       = increment(-1)
        setUserR(u => { const n = { ...u }; delete n[user.uid]; return n })
        setReak(r  => ({ ...r, [emoji]: Math.max(0, (Number(r[emoji]) || 0) - 1) }))
      } else {
        if (prev) {
          updates[`reaktioner.${prev}`] = increment(-1)
          setReak(r => ({ ...r, [prev]: Math.max(0, (Number(r[prev]) || 0) - 1) }))
        }
        updates[`userReactions.${user.uid}`] = emoji
        updates[`reaktioner.${emoji}`]       = increment(1)
        setUserR(u => ({ ...u, [user.uid]: emoji }))
        setReak(r  => ({ ...r, [emoji]: (Number(r[emoji]) || 0) + 1 }))
      }
      await updateDoc(ref, updates)
    } catch {}
    setSaving(false)
  }

  return (
    <div className="screen">
      <div className="article">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontSize: 16, fontWeight: 700 }}>
              {(msg.afsenderNavn || msg.authorName || 'T').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{msg.afsenderNavn || msg.authorName || 'Træner'}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {msg.holdNavn || (msg.targetHolds?.[0]?.titel) || ''}{(msg.holdNavn || msg.targetHolds?.[0]?.titel) ? ' · ' : ''}{fmtMsgDate(msg.oprettet || msg.createdAt)}
            </div>
          </div>
        </div>

        <div className="article-divider" />

        {(msg.tekst || msg.text || '').split('\n').filter(Boolean).map((line, i) => (
          <p key={i} className="article-para">{line}</p>
        ))}

        {/* Reaktioner */}
        <div style={{ marginTop: 28 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textAlign: 'center', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.4px' }}>
            Reager på beskeden
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            {EMOJIS.map(e => {
              const count  = Number(reak[e] || 0)
              const active = myEmoji === e
              return (
                <button key={e} onClick={() => react(e)} disabled={saving}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '12px 20px', borderRadius: 14, minWidth: 72,
                    border: `2px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                    background: active ? 'var(--green-soft)' : 'var(--surface)',
                    cursor: saving ? 'default' : 'pointer',
                    transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
                  }}>
                  <span style={{ fontSize: 26 }}>{e}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--green)' : 'var(--text2)' }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 24, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
            Kun trænere kan sende beskeder
          </p>
        </div>
      </div>
    </div>
  )
}

function ComposeSheet({ user, onClose }) {
  const [holds,       setHolds]       = useState([])
  const [holdsReady,  setHoldsReady]  = useState(false)
  const [holdId,      setHoldId]      = useState('')
  const [tekst,       setTekst]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [done,        setDone]        = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => {
        let all = snap.docs.map(d => d.data())
        if (user.role !== 'admin') {
          const mine = new Set((user.lederHoldIds || []).map(String))
          all = all.filter(h => mine.has(String(h.conventus_id)))
        }
        all.sort((a, b) =>
          (a.aktivitet_titel || '').localeCompare(b.aktivitet_titel || '', 'da') ||
          (a.titel || '').localeCompare(b.titel || '', 'da')
        )
        setHolds(all)
        if (all.length === 1) setHoldId(String(all[0].conventus_id))
        setHoldsReady(true)
      })
      .catch(() => { setHoldsReady(true) })
  }, [])

  async function send(e) {
    e.preventDefault()
    if (!holdId || !tekst.trim()) return
    setSaving(true)
    const hold = holds.find(h => String(h.conventus_id) === holdId)
    try {
      await addDoc(collection(db, 'messages'), {
        holdId:        holdId,
        holdNavn:      hold?.titel || holdId,
        afsenderNavn:  user.name   || user.email,
        afsenderUid:   user.uid,
        tekst:         tekst.trim(),
        reaktioner:    { '👍': 0, '✅': 0, '❤️': 0 },
        userReactions: {},
        oprettet:      serverTimestamp(),
        createdAt:     serverTimestamp(),
      })
      // Fire-and-forget email notification — failure doesn't block UX
      auth.currentUser?.getIdToken().then(idToken => {
        fetch('/api/send-message-email.php', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            holdIds:    [holdId],
            senderName: user.name || user.email,
            text:       tekst.trim(),
            holdNavn:   hold?.titel || holdId,
          }),
        }).catch(() => {})
      }).catch(() => {})
      setDone(true)
      setTimeout(onClose, 1400)
    } catch (err) {
      alert('Fejl: ' + err.message)
      setSaving(false)
    }
  }

  const selectedHold = holds.find(h => String(h.conventus_id) === holdId)
  const MAX_CHARS = 500

  if (done) return (
    <div className="compose-success">
      <div className="compose-success-icon">
        <Icon name="check-circle" size={52} color="white" />
      </div>
      <h3 className="compose-success-title">Besked sendt!</h3>
      <p className="compose-success-body">Holdet modtager din besked nu</p>
      {selectedHold && (
        <div className="compose-success-hold">{selectedHold.titel}</div>
      )}
    </div>
  )

  return (
    <div className="compose-sheet">
      {/* Header */}
      <div className="compose-header">
        <div className="compose-header-left">
          <div className="compose-icon">
            <Icon name="send" size={18} color="white" />
          </div>
          <div>
            <h2 className="compose-title">Ny besked</h2>
            <p className="compose-subtitle">Send til dit hold</p>
          </div>
        </div>
        <button onClick={onClose} className="compose-close" type="button" aria-label="Luk">
          <Icon name="x" size={20} color="var(--text3)" />
        </button>
      </div>

      <form onSubmit={send} className="compose-form">
        {/* Holdvælger */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="users" size={14} color="var(--green)" />
            Send til hold
          </label>
          {!holdsReady ? (
            <p className="compose-holds-loading">Henter hold…</p>
          ) : holds.length === 0 ? (
            <p className="compose-holds-loading">Ingen hold tilknyttet</p>
          ) : holds.length <= 5 ? (
            <div className="compose-hold-grid">
              {holds.map(h => {
                const active = String(h.conventus_id) === holdId
                return (
                  <button
                    key={h.conventus_id}
                    type="button"
                    className={`compose-hold-chip${active ? ' compose-hold-chip--active' : ''}`}
                    onClick={() => setHoldId(String(h.conventus_id))}
                  >
                    <span className="compose-hold-initials">
                      {(h.titel || '?').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="compose-hold-name">{h.titel}</span>
                    {active && <Icon name="check-circle" size={16} color="var(--green)" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <select
              className="compose-select"
              value={holdId}
              onChange={e => setHoldId(e.target.value)}
              required
            >
              <option value="">Vælg hold…</option>
              {holds.map(h => <option key={h.conventus_id} value={String(h.conventus_id)}>{h.titel}</option>)}
            </select>
          )}
        </div>

        {/* Beskedtekst */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="message" size={14} color="var(--green)" />
            Besked
          </label>
          <div className="compose-textarea-wrap">
            <textarea
              className="compose-textarea"
              rows={5}
              value={tekst}
              onChange={e => setTekst(e.target.value.slice(0, MAX_CHARS))}
              placeholder="Skriv din besked til holdet…"
              required
              autoFocus
            />
            <span className={`compose-char-count${tekst.length > MAX_CHARS * 0.85 ? ' compose-char-count--warn' : ''}`}>
              {tekst.length}/{MAX_CHARS}
            </span>
          </div>
        </div>

        {/* Send-knap */}
        <button
          className="compose-send-btn"
          type="submit"
          disabled={saving || !holdId || !tekst.trim()}
        >
          {saving
            ? <><span className="spinner" /> Sender…</>
            : <><Icon name="send" size={18} color="white" /> Send til {selectedHold?.titel || 'holdet'}</>
          }
        </button>
      </form>
    </div>
  )
}

function FeedScreen({ user, onSelectMsg, onMarkSeen, onEnableNotifications }) {
  const [msgs,    setMsgs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [compose, setCompose] = useState(false)
  const seenTs = useRef(parseInt(localStorage.getItem('ssif_msgs_seen') || '0', 10))

  const isTrainer = user.role === 'trainer' || user.role === 'admin'
  const holdIds   = [...new Set([
    ...(user.holdIds       || []).map(String),
    ...(user.holds         || []).map(String),
    ...(user.familyMembers || []).filter(m => m.holdId).map(m => String(m.holdId)),
  ])]

  useEffect(() => {
    const q = query(collection(db, 'messages'), orderBy('oprettet', 'desc'), limit(60))
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const filtered = isTrainer
        ? all
        : all.filter(m => {
            if (!m.holdId) {
              // Gammel format med targetHolds
              return (m.targetHolds || []).some(h => {
                const id = typeof h === 'object' ? String(h.conventus_id) : String(h)
                return holdIds.includes(id)
              })
            }
            return holdIds.includes(String(m.holdId))
          })
      setMsgs(filtered)
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  useEffect(() => {
    // Mark as seen when entering messages tab
    const now = Date.now()
    seenTs.current = now
    localStorage.setItem('ssif_msgs_seen', String(now))
    onMarkSeen()
  }, [])

  function isUnread(msg) {
    const ts = (msg.oprettet || msg.createdAt)?.toDate?.().getTime() ?? 0
    return ts > seenTs.current
  }

  function getPermission() {
    try { return 'Notification' in window ? Notification.permission : null } catch { return null }
  }
  const perm      = getPermission()
  const isGranted = perm === 'granted'
  const isDenied  = perm === 'denied'

  if (compose) {
    return (
      <div className="screen">
        <ComposeSheet user={user} onClose={() => setCompose(false)} />
      </div>
    )
  }

  return (
    <div className="screen">
      {/* Compose-hero for trænere */}
      {isTrainer && (
        <button className="compose-trigger" onClick={() => setCompose(true)}>
          <div className="compose-trigger-icon">
            <Icon name="send" size={20} color="white" />
          </div>
          <div className="compose-trigger-body">
            <span className="compose-trigger-title">Send besked til holdet</span>
            <span className="compose-trigger-sub">Tryk for at skrive en ny besked</span>
          </div>
          <Icon name="chevron" size={18} color="rgba(255,255,255,.6)" sw={2.5} />
        </button>
      )}

      <div className="section-header-row">
        <span className="section-header-text">Beskeder</span>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <div className="loading-dots"><span/><span/><span/></div>
        </div>
      ) : msgs.length === 0 ? (
        <div style={{ padding: '48px 28px', textAlign: 'center' }}>
          <Icon name="message" size={44} color="var(--text3)" />
          <p style={{ marginTop: 14, fontSize: 15, color: 'var(--text2)', fontWeight: 600 }}>Ingen beskeder endnu</p>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 6, lineHeight: 1.5 }}>
            Trænere sender beskeder til holdet her.{'\n'}Du kan reagere med emoji.
          </p>
        </div>
      ) : (
        <div className="card-list">
          {msgs.map(msg => (
            <MessageCard key={msg.id} msg={msg} unread={isUnread(msg)} onTap={() => onSelectMsg(msg)} />
          ))}
        </div>
      )}

      {/* Notifikationsindstillinger */}
      <SectionHeader title="Indstillinger" />
      <div className="list-group">
        <button className="list-item"
          onClick={() => { if (!isGranted && !isDenied && perm !== null) onEnableNotifications() }}
          disabled={isGranted || isDenied || perm === null}
          style={{ cursor: (isGranted || isDenied || perm === null) ? 'default' : 'pointer' }}>
          <div className="list-item-icon" style={{ background: isGranted ? 'var(--green-soft)' : 'var(--bg)' }}>
            <Icon name="bell" size={17} color={isGranted ? 'var(--green)' : 'var(--text3)'} />
          </div>
          <div className="list-item-body">
            <span className="list-item-title">Notifikationer</span>
            <span className="list-item-detail">
              {isGranted ? 'Aktiveret – du modtager beskeder'
             : isDenied  ? 'Blokeret – tillad i telefonens indstillinger'
             : perm === null ? 'Ikke understøttet'
             : 'Tryk for at modtage notifikationer fra trænerne'}
            </span>
          </div>
          <div className={`notif-checkbox ${isGranted ? 'notif-checkbox--checked' : ''}`}>
            {isGranted && <Icon name="check" size={12} color="white" sw={3} />}
          </div>
        </button>
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── Kalender / Events ────────────────────────────────────────────────────────

const DK_MONTHS      = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec']
const DK_MONTHS_LONG = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december']
const DK_DAYS        = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag']

function fmtEventDate(dato) {
  if (!dato) return ''
  const [y, m, d] = dato.split('-').map(Number)
  return `${d}. ${DK_MONTHS_LONG[m - 1]} ${y}`
}
function fmtEventWeekday(dato) {
  if (!dato) return ''
  return DK_DAYS[new Date(dato + 'T12:00:00').getDay()]
}

function EventTypeBadge({ type }) {
  if (type === 'kamp')    return <span className="event-type-badge event-type-badge--kamp">⚽ Kamp</span>
  if (type === 'træning') return <span className="event-type-badge event-type-badge--traening">🏃 Træning</span>
  return <span className="event-type-badge event-type-badge--generel">📅 Event</span>
}

function EventDetailRow({ icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--text2)', fontSize: 15 }}>
      <span style={{ flexShrink: 0, marginTop: 2 }}><Icon name={icon} size={17} color="var(--green)" /></span>
      <span>{children}</span>
    </div>
  )
}

const CAL_MO = ['Januar','Februar','Marts','April','Maj','Juni','Juli','August','September','Oktober','November','December']

function KalenderScreen({ user, onSelectEvent }) {
  const [events,     setEvents]     = useState([])
  const [calHolds,   setCalHolds]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [viewMonth,  setViewMonth]  = useState(() => { const d = new Date(); d.setDate(1); return d })

  const isTrainer = user.role === 'trainer' || user.role === 'admin'
  const myHoldIds = [...new Set([
    ...(user.holdIds     || []).map(String),
    ...(user.lederHoldIds || []).map(String),
  ])]

  const holdPersonMap = (() => {
    const fm = user.familyMembers || []
    if (!fm.length) return {}
    const fn = n => (n || '').split(' ')[0] || ''
    const map = {}
    ;(user.holdIds || []).forEach(id => { map[String(id)] = fn(user.firstName || user.name) })
    fm.forEach(m => { if (m.holdId) map[String(m.holdId)] = fn(m.name) })
    return map
  })()

  useEffect(() => {
    const ids = new Set(myHoldIds)
    if (!ids.size) return
    getDocs(collection(db, 'holds'))
      .then(snap => setCalHolds(
        snap.docs.map(d => d.data()).filter(h => ids.has(String(h.conventus_id)) && h.traeningstider)
      ))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!myHoldIds.length) { setLoading(false); return }
    const today  = new Date().toISOString().slice(0, 10)
    const chunks = []
    for (let i = 0; i < myHoldIds.length; i += 30) chunks.push(myHoldIds.slice(i, i + 30))
    Promise.all(chunks.map(chunk =>
      getDocs(query(collection(db, 'events'), where('holdId', 'in', chunk)))
    ))
      .then(snaps => {
        const seen = new Set()
        const all  = snaps
          .flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
          .filter(ev => {
            if (seen.has(ev.id) || (ev.dato || '') < today) return false
            seen.add(ev.id); return true
          })
        const relevant = all.filter(ev => {
          if (ev.type === 'generel' || ev.type === 'træning') return true
          if (isTrainer && (user.lederHoldIds || []).map(String).includes(String(ev.holdId))) return true
          return (ev.udtagneSpillere || []).some(s =>
            s.email?.toLowerCase() === user.email?.toLowerCase() ||
            (user.conventus_id && s.conventus_id === user.conventus_id)
          )
        })
        setEvents(relevant)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshKey])

  // Synthetic training items — skip any date+hold covered by a real Firestore træning event
  const realTrainingKeys = new Set(
    events.filter(e => e.type === 'træning').map(e => `${e.dato}_${e.holdId}`)
  )
  const trainingItems = expandTrainingSessions(calHolds)
    .filter(item => !realTrainingKeys.has(`${item.dato}_${item.holdId}`))

  const allItems = [...events, ...trainingItems].sort((a, b) =>
    (a.dato || '').localeCompare(b.dato || '') ||
    (a.tidStart || '').localeCompare(b.tidStart || '')
  )

  // Mini-calendar data
  const todayStr  = new Date().toISOString().slice(0, 10)
  const yr = viewMonth.getFullYear()
  const mo = viewMonth.getMonth()
  const firstDOW  = (new Date(yr, mo, 1).getDay() + 6) % 7
  const daysInMo  = new Date(yr, mo + 1, 0).getDate()
  const activeDates = new Set(allItems.map(i => i.dato))

  // Group by date
  const grouped = {}
  allItems.forEach(item => {
    if (!grouped[item.dato]) grouped[item.dato] = []
    grouped[item.dato].push(item)
  })
  const sortedDates = Object.keys(grouped).sort()

  return (
    <div className="screen">
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div className="loading-dots"><span /><span /><span /></div>
        </div>
      ) : (
        <>
          {/* ── Mini-månedkalender ── */}
          <div className="kal-month-card">
            <div className="kal-month-nav">
              <button className="kal-month-btn" onClick={() => setViewMonth(new Date(yr, mo - 1, 1))} aria-label="Forrige måned">
                <div style={{ transform: 'rotate(180deg)', display: 'flex' }}>
                  <Icon name="chevron" size={16} color="var(--green)" sw={2.5} />
                </div>
              </button>
              <span className="kal-month-title">{CAL_MO[mo]} {yr}</span>
              <button className="kal-month-btn" onClick={() => setViewMonth(new Date(yr, mo + 1, 1))} aria-label="Næste måned">
                <Icon name="chevron" size={16} color="var(--green)" sw={2.5} />
              </button>
            </div>
            <div className="kal-month-grid">
              {['Ma','Ti','On','To','Fr','Lø','Sø'].map(d => (
                <div key={d} className="kal-month-dayname">{d}</div>
              ))}
              {Array.from({ length: firstDOW }, (_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMo }, (_, i) => {
                const day     = i + 1
                const dateStr = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const isToday = dateStr === todayStr
                const hasAct  = activeDates.has(dateStr)
                const isPast  = dateStr < todayStr
                return (
                  <div key={day} className="kal-month-cell">
                    <div className={`kal-month-day${isToday ? ' kal-month-day--today' : isPast ? ' kal-month-day--past' : ''}`}>
                      {day}
                    </div>
                    <div className={`kal-month-dot${hasAct ? (isPast ? ' kal-month-dot--past' : ' kal-month-dot--active') : ''}`} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Aktivitetsliste ── */}
          {sortedDates.length === 0 ? (
            <div className="kalender-empty">
              <Icon name="calendar" size={48} color="var(--text3)" />
              <h3 className="kalender-empty-title">Ingen kommende aktiviteter</h3>
              <p className="kalender-empty-body">
                {isTrainer ? 'Tryk + for at oprette et event for dit hold.'
                           : 'Trænerne på dine hold har ikke oprettet nogen kommende events.'}
              </p>
            </div>
          ) : (
            <div style={{ paddingBottom: 88 }}>
              {sortedDates.map((dato, di) => {
                const d        = new Date(dato + 'T12:00:00')
                const isToday  = dato === todayStr
                const dayLabel = d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })
                  .replace(/^./, c => c.toUpperCase())
                return (
                  <div key={dato}>
                    <div className={`kal-date-sep${di === 0 ? ' kal-date-sep--first' : ''}${isToday ? ' kal-date-sep--today' : ''}`}>
                      <span className="kal-date-label">{dayLabel}</span>
                      {isToday && <span className="kal-date-badge">I dag</span>}
                    </div>
                    {grouped[dato].map(item => {
                      const ac = item.type === 'kamp' ? '#e65c00' : item.type === 'stævne' ? '#ff9500' : 'var(--green)'
                      if (item._isTraening) {
                        function downloadHoldICS() {
                          const hold = calHolds.find(h => String(h.conventus_id) === item.holdId)
                          const sessions = parseSessions(hold?.traeningstider || '')
                          const vevents = sessions.map(({ dayIdx: di, time }) =>
                            makeVEvent({
                              uid: `training-${item.holdId}-${di}@ssif.app`,
                              summary: `Træning — ${item.holdNavn}`,
                              dato: item.dato,
                              tidStart: time,
                              sted: hold?.sted || null,
                              rrule: `FREQ=WEEKLY;BYDAY=${RRULE_DAY[di]};COUNT=52`,
                            })
                          )
                          downloadICSFile(`traening-${item.holdNavn}.ics`, vevents)
                        }
                        return (
                          <div key={item.id} className="kal-item">
                            <div className="kal-item-bar" style={{ background: 'var(--green)' }} />
                            <span className="kal-item-time" style={{ color: 'var(--green)' }}>{item.tidStart || '——'}</span>
                            <div className="kal-item-body">
                              <div className="kal-item-title">
                                {item.holdNavn}
                                {holdPersonMap[item.holdId] && <span className="kal-item-person"> ({holdPersonMap[item.holdId]})</span>}
                              </div>
                              <EventTypeBadge type="træning" />
                            </div>
                            <button onClick={downloadHoldICS} title="Tilføj til kalender"
                              style={{ flexShrink: 0, background: 'var(--green-soft)', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                              <Icon name="download" size={15} color="var(--green)" />
                            </button>
                          </div>
                        )
                      }
                      return (
                        <button key={item.id} className="kal-item kal-item--btn" onClick={() => onSelectEvent(item)}>
                          <div className="kal-item-bar" style={{ background: ac }} />
                          <span className="kal-item-time" style={{ color: ac }}>{item.tidStart || '——'}</span>
                          <div className="kal-item-body">
                            <div className="kal-item-title">
                              {item.titel}
                              {holdPersonMap[String(item.holdId)] && <span className="kal-item-person"> ({holdPersonMap[String(item.holdId)]})</span>}
                            </div>
                            {(item.holdNavn || item.sted) && (
                              <div className="kal-item-sub">{[item.holdNavn, item.sted].filter(Boolean).join(' · ')}</div>
                            )}
                          </div>
                          <EventTypeBadge type={item.type} />
                          <Icon name="chevron" size={16} color="var(--text3)" />
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {isTrainer && (
        <button className="kalender-fab" onClick={() => setCreateOpen(true)} aria-label="Opret event">
          <Icon name="plus" size={26} color="white" sw={2.5} />
        </button>
      )}

      {createOpen && (
        <CreateEventSheet
          user={user}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); setRefreshKey(k => k + 1) }}
        />
      )}
    </div>
  )
}

function CreateEventSheet({ user, onClose, onCreated }) {
  const [type,        setType]        = useState('generel')
  const [holdId,      setHoldId]      = useState('')
  const [holds,       setHolds]       = useState([])
  const [holdsReady,  setHoldsReady]  = useState(false)
  const [titel,       setTitel]       = useState('')
  const [dato,        setDato]        = useState('')
  const [tidStart,    setTidStart]    = useState('')
  const [tidSlut,     setTidSlut]     = useState('')
  const [sted,        setSted]        = useState('')
  const [beskrivelse, setBeskrivelse] = useState('')
  const [members,     setMembers]     = useState([])
  const [membersReady, setMembersReady] = useState(false)
  const [udtagne,     setUdtagne]     = useState([])
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => {
        let all = snap.docs.map(d => d.data())
        if (user.role !== 'admin') {
          const mine = new Set((user.lederHoldIds || []).map(String))
          all = all.filter(h => mine.has(String(h.conventus_id)))
        }
        all.sort((a, b) => (a.titel || '').localeCompare(b.titel || '', 'da'))
        setHolds(all)
        if (all.length === 1) setHoldId(String(all[0].conventus_id))
        setHoldsReady(true)
      })
      .catch(() => setHoldsReady(true))
  }, [])

  useEffect(() => {
    if (!holdId || type !== 'kamp') { setMembers([]); setMembersReady(false); return }
    setMembersReady(false)
    getDocs(query(collection(db, 'members'), where('holdIds', 'array-contains', holdId)))
      .then(snap => {
        const all = snap.docs.map(d => ({
          conventus_id: d.data().conventus_id,
          name:  d.data().name || 'Ukendt',
          email: (d.data().allEmails || [])[0] || '',
        })).filter(m => m.email)
        all.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'))
        setMembers(all)
        setMembersReady(true)
      })
      .catch(() => setMembersReady(true))
  }, [holdId, type])

  function togglePlayer(player) {
    setUdtagne(prev => {
      const idx = prev.findIndex(p => p.conventus_id === player.conventus_id)
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, player]
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!holdId || !titel.trim() || !dato || !tidStart) return
    if (type === 'kamp' && udtagne.length === 0) { alert('Vælg mindst én spiller til udtagelse'); return }
    setSaving(true)
    const hold     = holds.find(h => String(h.conventus_id) === holdId)
    const icsToken = crypto.randomUUID()
    try {
      const eventData = {
        type,
        titel:         titel.trim(),
        dato,
        tidStart,
        tidSlut:       tidSlut  || null,
        sted:          sted.trim() || null,
        beskrivelse:   beskrivelse.trim() || null,
        holdId,
        holdNavn:      hold?.titel || holdId,
        oprettetAf:    user.uid,
        oprettetAfNavn: user.name,
        icsToken,
        createdAt:     serverTimestamp(),
        ...(type === 'kamp' ? { udtagneSpillere: udtagne } : {}),
      }
      const ref = await addDoc(collection(db, 'events'), eventData)

      auth.currentUser?.getIdToken().then(idToken => {
        fetch('/api/send-event-notifications.php', {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ eventId: ref.id }),
        }).catch(() => {})
      }).catch(() => {})

      onCreated()
    } catch (err) {
      alert('Fejl: ' + err.message)
      setSaving(false)
    }
  }

  const selectedHold = holds.find(h => String(h.conventus_id) === holdId)

  return (
    <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet-panel">
    <div className="compose-sheet">
      <div className="compose-header">
        <div className="compose-header-left">
          <div className="compose-icon">
            <Icon name="calendar" size={18} color="white" />
          </div>
          <div>
            <h2 className="compose-title">Nyt event</h2>
            <p className="compose-subtitle">Opret og notificér holdet</p>
          </div>
        </div>
        <button onClick={onClose} className="compose-close" type="button" aria-label="Luk">
          <Icon name="x" size={20} color="var(--text3)" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="compose-form">
        {/* Type */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="calendar" size={14} color="var(--green)" /> Type
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'generel', label: '📅 Generel event'    },
              { id: 'kamp',   label: '⚽ Kamp / udtagelse' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                className={`compose-hold-chip${type === t.id ? ' compose-hold-chip--active' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => { setType(t.id); setUdtagne([]) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hold */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="users" size={14} color="var(--green)" /> Hold
          </label>
          {!holdsReady ? (
            <p className="compose-holds-loading">Henter hold…</p>
          ) : holds.length === 0 ? (
            <p className="compose-holds-loading">Ingen hold tilknyttet</p>
          ) : holds.length <= 5 ? (
            <div className="compose-hold-grid">
              {holds.map(h => {
                const active = String(h.conventus_id) === holdId
                return (
                  <button
                    key={h.conventus_id}
                    type="button"
                    className={`compose-hold-chip${active ? ' compose-hold-chip--active' : ''}`}
                    onClick={() => { setHoldId(String(h.conventus_id)); setUdtagne([]) }}
                  >
                    <span className="compose-hold-initials">{(h.titel || '?').slice(0, 2).toUpperCase()}</span>
                    <span className="compose-hold-name">{h.titel}</span>
                    {active && <Icon name="check-circle" size={16} color="var(--green)" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <select className="compose-select" value={holdId}
              onChange={e => { setHoldId(e.target.value); setUdtagne([]) }} required>
              <option value="">Vælg hold…</option>
              {holds.map(h => <option key={h.conventus_id} value={String(h.conventus_id)}>{h.titel}</option>)}
            </select>
          )}
        </div>

        {/* Titel */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="send" size={14} color="var(--green)" /> Titel
          </label>
          <input
            className="compose-select"
            type="text"
            value={titel}
            onChange={e => setTitel(e.target.value)}
            placeholder={type === 'kamp' ? 'F.eks. Kamp mod Silkeborg IF' : 'F.eks. Stævne i Horsens'}
            required
          />
        </div>

        {/* Dato + tid */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="clock" size={14} color="var(--green)" /> Dato og tidspunkt
          </label>
          <div className="event-time-row">
            <input className="compose-select" type="date" value={dato} onChange={e => setDato(e.target.value)} required />
            <input className="compose-select event-time-input" type="time" value={tidStart} onChange={e => setTidStart(e.target.value)} required title="Start" />
            <input className="compose-select event-time-input" type="time" value={tidSlut}  onChange={e => setTidSlut(e.target.value)}  title="Slut (valgfrit)" />
          </div>
          <p className="event-time-hint">Sluttidspunkt er valgfrit</p>
        </div>

        {/* Sted */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="location" size={14} color="var(--green)" /> Sted (valgfrit)
          </label>
          <input className="compose-select" type="text" value={sted} onChange={e => setSted(e.target.value)} placeholder="F.eks. Sejs Idrætsanlæg" />
        </div>

        {/* Beskrivelse */}
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="message" size={14} color="var(--green)" /> Beskrivelse (valgfrit)
          </label>
          <textarea className="compose-textarea" rows={3} value={beskrivelse} onChange={e => setBeskrivelse(e.target.value)} placeholder="Ekstra info om eventen…" />
        </div>

        {/* Spillervælger — kun ved kamp */}
        {type === 'kamp' && holdId && (
          <div className="compose-section">
            <label className="compose-label">
              <Icon name="users" size={14} color="var(--green)" />
              Udtag spillere
              {udtagne.length > 0 && <span className="player-count-badge">{udtagne.length} valgt</span>}
            </label>
            {!membersReady ? (
              <p className="compose-holds-loading">Henter spillere…</p>
            ) : members.length === 0 ? (
              <p className="compose-holds-loading">Ingen spillere fundet — kør sync-members først</p>
            ) : (
              <div className="player-grid">
                {members.map(p => {
                  const sel = udtagne.some(u => u.conventus_id === p.conventus_id)
                  return (
                    <button
                      key={p.conventus_id}
                      type="button"
                      className={`player-chip${sel ? ' player-chip--selected' : ''}`}
                      onClick={() => togglePlayer(p)}
                    >
                      <span className="player-chip-initials">
                        {(p.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="player-chip-name">{(p.name || '').split(' ')[0]}</span>
                      {sel && <Icon name="check" size={13} color="var(--green)" sw={2.5} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <button
          className="compose-send-btn"
          type="submit"
          disabled={saving || !holdId || !titel.trim() || !dato || !tidStart || (type === 'kamp' && udtagne.length === 0)}
        >
          {saving
            ? <><span className="spinner" /> Opretter…</>
            : <><Icon name="send" size={18} color="white" /> Opret og notificér</>
          }
        </button>
      </form>
    </div>
    </div>
    </div>
  )
}

function EditEventSheet({ event: ev, user, onClose, onSaved }) {
  const [titel,       setTitel]       = useState(ev.titel || '')
  const [dato,        setDato]        = useState(ev.dato || '')
  const [tidStart,    setTidStart]    = useState(ev.tidStart || '')
  const [tidSlut,     setTidSlut]     = useState(ev.tidSlut || '')
  const [sted,        setSted]        = useState(ev.sted || '')
  const [beskrivelse, setBeskrivelse] = useState(ev.beskrivelse || '')
  const [members,     setMembers]     = useState([])
  const [membersReady, setMembersReady] = useState(false)
  const [udtagne,     setUdtagne]     = useState(ev.udtagneSpillere || [])
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    if (!ev.holdId) return
    getDocs(query(collection(db, 'members'), where('holdIds', 'array-contains', String(ev.holdId))))
      .then(snap => {
        const all = snap.docs.map(d => ({
          conventus_id: d.data().conventus_id,
          name:  d.data().name || 'Ukendt',
          email: (d.data().allEmails || [])[0] || '',
        })).filter(m => m.email)
        all.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'))
        setMembers(all)
        setMembersReady(true)
      })
      .catch(() => setMembersReady(true))
  }, [ev.holdId])

  function togglePlayer(player) {
    setUdtagne(prev => {
      const idx = prev.findIndex(p => p.conventus_id === player.conventus_id)
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, player]
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!titel.trim() || !dato || !tidStart) return
    setSaving(true)
    try {
      const updates = {
        titel:          titel.trim(),
        dato,
        tidStart,
        tidSlut:        tidSlut || null,
        sted:           sted.trim() || null,
        beskrivelse:    beskrivelse.trim() || null,
        udtagneSpillere: udtagne,
      }
      await updateDoc(doc(db, 'events', ev.id), updates)
      onSaved({ ...ev, ...updates })
    } catch (err) {
      alert('Fejl: ' + err.message)
      setSaving(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet-panel">
    <div className="compose-sheet">
      <div className="compose-header">
        <div className="compose-header-left">
          <div className="compose-icon">
            <Icon name="calendar" size={18} color="white" />
          </div>
          <div>
            <h2 className="compose-title">Rediger kamp</h2>
            <p className="compose-subtitle">{ev.holdNavn || ''}</p>
          </div>
        </div>
        <button onClick={onClose} className="compose-close" type="button" aria-label="Luk">
          <Icon name="x" size={20} color="var(--text3)" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="compose-form">
        <div className="compose-section">
          <label className="compose-label">
            <Icon name="send" size={14} color="var(--green)" /> Titel
          </label>
          <input className="compose-select" type="text" value={titel} onChange={e => setTitel(e.target.value)} required />
        </div>

        <div className="compose-section">
          <label className="compose-label">
            <Icon name="clock" size={14} color="var(--green)" /> Dato og tidspunkt
          </label>
          <div className="event-time-row">
            <input className="compose-select" type="date" value={dato} onChange={e => setDato(e.target.value)} required />
            <input className="compose-select event-time-input" type="time" value={tidStart} onChange={e => setTidStart(e.target.value)} required title="Start" />
            <input className="compose-select event-time-input" type="time" value={tidSlut}  onChange={e => setTidSlut(e.target.value)}  title="Slut (valgfrit)" />
          </div>
          <p className="event-time-hint">Sluttidspunkt er valgfrit</p>
        </div>

        <div className="compose-section">
          <label className="compose-label">
            <Icon name="location" size={14} color="var(--green)" /> Sted (valgfrit)
          </label>
          <input className="compose-select" type="text" value={sted} onChange={e => setSted(e.target.value)} placeholder="F.eks. Sejs Idrætsanlæg" />
        </div>

        <div className="compose-section">
          <label className="compose-label">
            <Icon name="message" size={14} color="var(--green)" /> Beskrivelse (valgfrit)
          </label>
          <textarea className="compose-textarea" rows={3} value={beskrivelse} onChange={e => setBeskrivelse(e.target.value)} placeholder="Ekstra info om kampen…" />
        </div>

        <div className="compose-section">
          <label className="compose-label">
            <Icon name="users" size={14} color="var(--green)" />
            Udtagne spillere
            {udtagne.length > 0 && <span className="player-count-badge">{udtagne.length} valgt</span>}
          </label>
          {!membersReady ? (
            <p className="compose-holds-loading">Henter spillere…</p>
          ) : members.length === 0 ? (
            <p className="compose-holds-loading">Ingen spillere fundet</p>
          ) : (
            <div className="player-grid">
              {members.map(p => {
                const sel = udtagne.some(u => u.conventus_id === p.conventus_id)
                return (
                  <button key={p.conventus_id} type="button"
                    className={`player-chip${sel ? ' player-chip--selected' : ''}`}
                    onClick={() => togglePlayer(p)}>
                    <span className="player-chip-initials">
                      {(p.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="player-chip-name">{(p.name || '').split(' ')[0]}</span>
                    {sel && <Icon name="check" size={13} color="var(--green)" sw={2.5} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button className="compose-send-btn" type="submit"
          disabled={saving || !titel.trim() || !dato || !tidStart}>
          {saving
            ? <><span className="spinner" /> Gemmer…</>
            : <><Icon name="check" size={18} color="white" /> Gem ændringer</>
          }
        </button>
      </form>
    </div>
    </div>
    </div>
  )
}

function EventDetailScreen({ event: initialEv, user, onEventDeleted, onEventUpdated }) {
  const [ev,      setEv]      = useState(initialEv)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isMyEvent = user.role === 'admin' ||
    (user.role === 'trainer' && (user.lederHoldIds || []).map(String).includes(String(ev.holdId)))

  const timeStr = ev.tidStart
    ? `${ev.tidStart}${ev.tidSlut ? `–${ev.tidSlut}` : ''}`
    : null

  async function handleDelete() {
    if (!window.confirm('Slet dette event? Det kan ikke fortrydes.')) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'events', ev.id))
      onEventDeleted()
    } catch (err) {
      alert('Fejl: ' + err.message)
      setDeleting(false)
    }
  }

  return (
    <div className="screen">
      <div className="article">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <EventTypeBadge type={ev.type} />
          {ev.holdNavn && <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{ev.holdNavn}</span>}
        </div>

        <h1 className="article-title" style={{ marginBottom: 20 }}>{ev.titel}</h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {ev.dato && (
            <EventDetailRow icon="calendar">
              {fmtEventWeekday(ev.dato)}, {fmtEventDate(ev.dato)}
            </EventDetailRow>
          )}
          {timeStr && <EventDetailRow icon="clock">{timeStr}</EventDetailRow>}
          {ev.sted && <EventDetailRow icon="location">{ev.sted}</EventDetailRow>}
        </div>

        {ev.beskrivelse && (
          <div className="event-description">
            <p>{ev.beskrivelse}</p>
          </div>
        )}

        {ev.tilbagevendende && ev.dato && ev.tidStart ? (
          <button className="event-ics-btn" onClick={() => {
            const jsDay  = new Date(ev.dato + 'T12:00:00').getDay()
            const dayIdx = (jsDay + 6) % 7
            downloadICSFile(`traening-${ev.holdNavn || 'ssif'}.ics`, [
              makeVEvent({
                uid: `series-${ev.seriesToken || ev.id}@ssif.app`,
                summary: `Træning — ${ev.holdNavn || ''}`,
                dato: ev.dato,
                tidStart: ev.tidStart,
                sted: ev.sted || null,
                rrule: `FREQ=WEEKLY;BYDAY=${RRULE_DAY[dayIdx]};COUNT=52`,
              })
            ])
          }}>
            <Icon name="download" size={17} color="var(--green)" />
            Tilføj træningsserie til kalender (.ics)
          </button>
        ) : ev.icsToken ? (
          <a href={`/api/event-ics.php?token=${ev.icsToken}`} className="event-ics-btn" download>
            <Icon name="download" size={17} color="var(--green)" />
            Tilføj til kalender (.ics)
          </a>
        ) : null}

        {ev.type === 'kamp' && Array.isArray(ev.udtagneSpillere) && ev.udtagneSpillere.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <SectionHeader title={`Udtagne spillere (${ev.udtagneSpillere.length})`} />
            <div className="player-grid" style={{ padding: '4px 16px 8px' }}>
              {ev.udtagneSpillere.map(p => (
                <div key={p.conventus_id} className="player-chip player-chip--selected" style={{ cursor: 'default' }}>
                  <span className="player-chip-initials">
                    {(p.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="player-chip-name">{(p.name || '').split(' ')[0]}</span>
                  <Icon name="check" size={13} color="var(--green)" sw={2.5} />
                </div>
              ))}
            </div>
          </div>
        )}

        {isMyEvent && ev.type === 'kamp' && (
          <button
            onClick={() => setEditing(true)}
            className="event-ics-btn"
            style={{ marginTop: 12 }}
          >
            <Icon name="send" size={17} color="var(--green)" />
            Rediger kamp og udtagelse
          </button>
        )}

        {isMyEvent && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="event-delete-btn"
          >
            <Icon name="trash" size={16} color="#ff3b30" />
            {deleting ? 'Sletter…' : 'Slet event'}
          </button>
        )}
      </div>

      {editing && (
        <EditEventSheet
          event={ev}
          user={user}
          onClose={() => setEditing(false)}
          onSaved={updated => {
            setEv(updated)
            setEditing(false)
            if (onEventUpdated) onEventUpdated(updated)
          }}
        />
      )}
    </div>
  )
}

// ─── Support & FAQ ───────────────────────────────────────────────────────────

const SUPPORT_CATEGORIES = ['Login', 'Hold', 'Notifikationer', 'Beskeder', 'Andet']

function SupportWidget({ user }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="support-fab-wrap">
        <button className="support-fab" onClick={() => setOpen(true)} aria-label="Hjælp og support">
          ?
        </button>
      </div>
      {open && <SupportModal user={user} onClose={() => setOpen(false)} />}
    </>
  )
}

function SupportModal({ user, onClose }) {
  const [tab, setTab] = useState('faq')
  return (
    <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet-panel" style={{ maxHeight: '92dvh' }}>
        <div className="support-header">
          <div>
            <h2 className="support-header-title">Hjælp &amp; Support</h2>
          </div>
          <button onClick={onClose} className="compose-close" type="button" aria-label="Luk">
            <Icon name="x" size={20} color="var(--text3)" />
          </button>
        </div>
        <div className="support-tabs">
          <button className={`support-tab${tab === 'faq' ? ' support-tab--active' : ''}`} onClick={() => setTab('faq')}>
            FAQ
          </button>
          <button className={`support-tab${tab === 'ask' ? ' support-tab--active' : ''}`} onClick={() => setTab('ask')}>
            Stil et spørgsmål
          </button>
        </div>
        {tab === 'faq'
          ? <FAQTab />
          : <AskTab user={user} onDone={() => setTab('faq')} />
        }
      </div>
    </div>
  )
}

function FAQTab() {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [openId,  setOpenId]  = useState(null)

  useEffect(() => {
    getDocs(query(collection(db, 'support'), where('status', '==', 'faq')))
      .then(snap => { setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? items.filter(i => i.question?.toLowerCase().includes(q) || i.answer?.toLowerCase().includes(q))
    : items

  const grouped = {}
  SUPPORT_CATEGORIES.forEach(cat => {
    const catItems = filtered.filter(i => i.category === cat)
    if (catItems.length) grouped[cat] = catItems
  })

  return (
    <div className="support-content">
      <div className="support-search-wrap">
        <Icon name="search" size={16} color="var(--text3)" />
        <input
          className="support-search"
          type="text"
          placeholder="Søg i FAQ…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="support-search-clear">
            <Icon name="x" size={14} color="var(--text3)" />
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="loading-dots"><span /><span /><span /></div>
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text3)', fontSize: 14 }}>
          {search ? 'Ingen resultater for din søgning' : 'Ingen FAQ-emner endnu'}
        </div>
      ) : Object.entries(grouped).map(([cat, catItems]) => (
        <div key={cat} className="faq-category">
          <div className="faq-category-title">{cat}</div>
          {catItems.map(item => (
            <div key={item.id} className="faq-item">
              <button
                type="button"
                className="faq-question"
                onClick={() => setOpenId(openId === item.id ? null : item.id)}
              >
                <span>{item.question}</span>
                <div style={{ transform: openId === item.id ? 'rotate(90deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>
                  <Icon name="chevron" size={16} color="var(--text3)" sw={2.5} />
                </div>
              </button>
              {openId === item.id && (
                <div className="faq-answer">{item.answer}</div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function AskTab({ user, onDone }) {
  const [category, setCategory] = useState('')
  const [question, setQuestion] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [done,     setDone]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!category || !question.trim()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'support'), {
        uid:       user.uid,
        name:      user.name  || '',
        email:     user.email || '',
        category,
        question:  question.trim(),
        status:    'afventer',
        answer:    null,
        createdAt: serverTimestamp(),
        answeredAt: null,
      })
      setDone(true)
    } catch {
      alert('Der opstod en fejl — prøv igen')
      setSaving(false)
    }
  }

  if (done) return (
    <div className="support-content" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Spørgsmål modtaget</h3>
      <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.65, marginBottom: 24 }}>
        Vi vender tilbage hurtigst muligt. Svaret sendes til din email.
      </p>
      <button type="button" className="compose-send-btn" onClick={onDone}>
        Tilbage til FAQ
      </button>
    </div>
  )

  return (
    <div className="support-content">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="compose-section" style={{ marginBottom: 0 }}>
          <label className="compose-label">
            <Icon name="users" size={14} color="var(--green)" /> Kategori
          </label>
          <select className="compose-select" value={category} onChange={e => setCategory(e.target.value)} required>
            <option value="">Vælg kategori…</option>
            {SUPPORT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="compose-section" style={{ marginBottom: 0 }}>
          <label className="compose-label">
            <Icon name="message" size={14} color="var(--green)" /> Dit spørgsmål
          </label>
          <textarea
            className="compose-textarea"
            rows={5}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Beskriv dit spørgsmål eller problem…"
            required
          />
        </div>
        <button
          className="compose-send-btn"
          type="submit"
          disabled={saving || !category || !question.trim()}
        >
          {saving
            ? <><span className="spinner" /> Sender…</>
            : <><Icon name="send" size={18} color="white" /> Send spørgsmål</>
          }
        </button>
      </form>
    </div>
  )
}

// ─── Profil ───────────────────────────────────────────────────────────────────

function ProfileScreen({ user, onLogout, onUserUpdate, verifyMsg, onEnableNotifications }) {
  const [newEmail,     setNewEmail]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [info,         setInfo]         = useState('')
  const [resent,       setResent]       = useState(false)
  const [lederHolds,   setLederHolds]   = useState([])
  const [supportOpen,  setSupportOpen]  = useState(false)

  const isTrainer = user.role === 'trainer' || user.role === 'admin'

  useEffect(() => {
    const ids = (user.lederHoldIds || []).map(String)
    if (!ids.length) return
    getDocs(collection(db, 'holds'))
      .then(snap => {
        const matched = snap.docs.map(d => d.data()).filter(h => ids.includes(String(h.conventus_id)))
        matched.sort((a, b) => (a.titel || '').localeCompare(b.titel || '', 'da'))
        setLederHolds(matched)
      })
      .catch(() => {})
  }, [JSON.stringify(user.lederHoldIds)])

  // Vis bekræftelsesbesked når en email er verificeret via link
  useEffect(() => {
    if (!verifyMsg) return
    setInfo(verifyMsg)
    const t = setTimeout(() => setInfo(''), 6000)
    return () => clearTimeout(t)
  }, [verifyMsg])

  // Genindlæs extraEmails fra Firestore ved hver profilvisning
  useEffect(() => {
    if (!user?.uid) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (!snap.exists()) return
      const fresh = snap.data().extraEmails || []
      onUserUpdate(prev => ({ ...prev, extraEmails: fresh }))
    }).catch(() => {})
  }, [])

  // Normalisér: extraEmails kan være strenge (ældre format) eller objekter
  const extraEmails = (user.extraEmails || []).map(e =>
    typeof e === 'string' ? { email: e, verified: false, token: null } : e
  )

  async function resendPrimaryVerification() {
    try {
      await sendEmailVerification(auth.currentUser)
      setResent(true)
      setTimeout(() => setResent(false), 5000)
    } catch {}
  }

  async function addExtraEmail(e) {
    e.preventDefault()
    const emailLower = newEmail.trim().toLowerCase()
    if (!emailLower) return
    if (!user?.uid) { setInfo('Log ind for at tilføje emails'); return }
    if (extraEmails.some(x => x.email === emailLower)) { setInfo('Email er allerede tilføjet'); return }

    setSaving(true)
    try {
      const token  = crypto.randomUUID()
      const entry  = { email: emailLower, verified: false, token }
      const ref    = doc(db, 'users', user.uid)
      const snap   = await getDoc(ref)
      const current = snap.data()?.extraEmails || []
      await updateDoc(ref, { extraEmails: [...current, entry] })

      const idToken = await auth.currentUser?.getIdToken() ?? ''
      const res = await fetch('api/send-verification.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ email: emailLower, uid: user.uid, token, idToken }),
      })

      onUserUpdate(prev => ({ ...prev, extraEmails: [...current, entry] }))
      setNewEmail('')
      setInfo(res.ok
        ? 'Verifikationsmail sendt til ' + emailLower
        : 'Email gemt — verifikationsmail kunne ikke sendes')
      setTimeout(() => setInfo(''), 7000)
    } catch (err) { setInfo('Fejl: ' + err.message) }
    finally { setSaving(false) }
  }

  async function removeExtraEmail(emailStr) {
    if (!user?.uid) return
    try {
      const ref     = doc(db, 'users', user.uid)
      const snap    = await getDoc(ref)
      const current = snap.data()?.extraEmails || []
      const updated = current.filter(e => (typeof e === 'string' ? e : e.email) !== emailStr)
      await updateDoc(ref, { extraEmails: updated })
      onUserUpdate(prev => ({ ...prev, extraEmails: updated }))
    } catch (err) { setInfo('Fejl: ' + err.message) }
  }

  async function resendExtraVerification(emailStr) {
    if (!user?.uid) return
    setSaving(true)
    try {
      const token   = crypto.randomUUID()
      const ref     = doc(db, 'users', user.uid)
      const snap    = await getDoc(ref)
      const current = snap.data()?.extraEmails || []
      const updated = current.map(e => {
        const em = typeof e === 'string' ? e : e.email
        return em === emailStr ? { email: em, verified: false, token } : e
      })
      await updateDoc(ref, { extraEmails: updated })
      const idToken2 = await auth.currentUser?.getIdToken() ?? ''
      await fetch('api/send-verification.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken2}` },
        body: JSON.stringify({ email: emailStr, uid: user.uid, token, idToken: idToken2 }),
      })
      onUserUpdate(prev => ({ ...prev, extraEmails: updated }))
      setInfo('Ny verifikationsmail sendt')
      setTimeout(() => setInfo(''), 5000)
    } catch (err) { setInfo('Fejl: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="screen">
      <SectionHeader title="Min konto" />
      <div className="list-group">
        <div className="list-item" style={{ cursor: 'default' }}>
          <Avatar initials={user.initials} size={40} />
          <div className="list-item-body" style={{ marginLeft: 12 }}>
            <span className="list-item-title">{user.name}</span>
            <span className="list-item-detail">{user.email}</span>
          </div>
        </div>
        <div className="list-separator" />
        <div className="list-item" style={{ cursor: 'default' }}>
          <div className="list-item-icon"
               style={{ background: user.emailVerified ? 'var(--green-soft)' : '#fff3e0' }}>
            <Icon name={user.emailVerified ? 'check-circle' : 'alert-circle'} size={17}
                  color={user.emailVerified ? 'var(--green)' : '#ff9500'} />
          </div>
          <div className="list-item-body">
            <span className="list-item-title">
              {user.emailVerified ? 'Email verificeret' : 'Email ikke verificeret'}
            </span>
            {!user.emailVerified && (
              <span className="list-item-detail">Verificér for at se hold og indhold</span>
            )}
          </div>
          {!user.emailVerified && (
            <button className="btn btn-secondary" style={{ height: 32, fontSize: 12, padding: '0 12px' }}
                    onClick={resendPrimaryVerification} disabled={resent}>
              {resent ? '✓ Sendt' : 'Send igen'}
            </button>
          )}
        </div>
      </div>

      {info && (
        <p style={{ fontSize: 13, color: 'var(--green)', padding: '10px 16px 0', lineHeight: 1.5 }}>
          {info}
        </p>
      )}

      {extraEmails.length > 0 && (
        <>
          <SectionHeader title="Tilknyttede emails" />
          <div className="list-group">
            {extraEmails.map((entry, i) => (
              <div key={entry.email}>
                {i > 0 && <div className="list-separator" />}
                <div className="list-item" style={{ cursor: 'default' }}>
                  <div className="list-item-icon"
                       style={{ background: entry.verified ? 'var(--green-soft)' : '#fff3e0' }}>
                    <Icon name={entry.verified ? 'check-circle' : 'alert-circle'} size={17}
                          color={entry.verified ? 'var(--green)' : '#ff9500'} />
                  </div>
                  <div className="list-item-body">
                    <span className="list-item-title">{entry.email}</span>
                    <span className="list-item-detail"
                          style={{ color: entry.verified ? 'var(--text3)' : '#ff9500' }}>
                      {entry.verified
                        ? 'Verificeret · Hold-tilknytning via Conventus'
                        : 'Afventer verificering'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {!entry.verified && (
                      <button className="btn btn-secondary"
                              style={{ height: 32, fontSize: 12, padding: '0 10px' }}
                              onClick={() => resendExtraVerification(entry.email)} disabled={saving}>
                        Send igen
                      </button>
                    )}
                    <button className="fam-remove" onClick={() => removeExtraEmail(entry.email)}>
                      <Icon name="x" size={16} color="var(--text3)" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Conventus-tilknyttede members ── */}
      <SectionHeader title="Tilføj email" />
      <div style={{ padding: '0 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.5 }}>
          Tilføj email-adresser der er tilknyttet Conventus — fx din ægtefælles email.
          Du modtager en bekræftelsesmail til den tilføjede adresse.
        </p>
        <form onSubmit={addExtraEmail} style={{ display: 'flex', gap: 8 }}>
          <div className="input-group" style={{ flex: 1 }}>
            <div className="input-row">
              <span className="input-icon"><Icon name="mail" size={17} color="var(--text3)" /></span>
              <input className="input-field" type="email" placeholder="email@eksempel.dk" required
                     value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary" style={{ height: 50, padding: '0 16px', flexShrink: 0 }}
                  disabled={saving} type="submit">
            {saving ? 'Gemmer…' : 'Tilføj'}
          </button>
        </form>
      </div>

      {/* ── Notifikationer ─────────────────────── */}
      {(() => {
        let perm = null
        try { perm = 'Notification' in window ? Notification.permission : null } catch {}
        const isGranted = perm === 'granted'
        const isDenied  = perm === 'denied'

        async function toggleEmailNotif() {
          const next = !user.emailNotifications
          onUserUpdate(prev => ({ ...prev, emailNotifications: next }))
          updateDoc(doc(db, 'users', user.uid), { emailNotifications: next }).catch(() => {})
        }

        return (
          <>
            <SectionHeader title="Indstillinger" />
            <div className="list-group">
              <button className="list-item"
                onClick={() => { if (!isGranted && !isDenied && perm !== null) onEnableNotifications?.() }}
                disabled={isGranted || isDenied || perm === null}
                style={{ cursor: (isGranted || isDenied || perm === null) ? 'default' : 'pointer' }}>
                <div className="list-item-icon" style={{ background: isGranted ? 'var(--green-soft)' : 'var(--bg)' }}>
                  <Icon name="bell" size={17} color={isGranted ? 'var(--green)' : 'var(--text3)'} />
                </div>
                <div className="list-item-body">
                  <span className="list-item-title">Notifikationer</span>
                  <span className="list-item-detail">
                    {isGranted  ? 'Aktiveret – du modtager beskeder fra trænerne'
                   : isDenied   ? 'Blokeret – tillad i telefonens indstillinger'
                   : perm === null ? 'Ikke understøttet i denne browser'
                   : 'Tryk for at modtage notifikationer fra trænerne'}
                  </span>
                </div>
                <div className={`notif-checkbox ${isGranted ? 'notif-checkbox--checked' : ''}`}>
                  {isGranted && <Icon name="check" size={12} color="white" sw={3} />}
                </div>
              </button>
              <div className="list-separator" />
              <button className="list-item" onClick={toggleEmailNotif} style={{ cursor: 'pointer' }}>
                <div className="list-item-icon" style={{ background: user.emailNotifications ? 'var(--green-soft)' : 'var(--bg)' }}>
                  <Icon name="mail" size={17} color={user.emailNotifications ? 'var(--green)' : 'var(--text3)'} />
                </div>
                <div className="list-item-body">
                  <span className="list-item-title">Email-notifikationer</span>
                  <span className="list-item-detail">
                    {user.emailNotifications
                      ? 'Aktiveret – du modtager beskeder på email'
                      : 'Tryk for at modtage beskeder fra trænerne på email'}
                  </span>
                </div>
                <div className={`notif-checkbox ${user.emailNotifications ? 'notif-checkbox--checked' : ''}`}>
                  {user.emailNotifications && <Icon name="check" size={12} color="white" sw={3} />}
                </div>
              </button>
            </div>
          </>
        )
      })()}

      {/* ── Rolle (kun trænere/admin) ─────────────── */}
      {isTrainer && (
        <>
          <SectionHeader title="Min rolle" />
          <div className="list-group">
            <div className="list-item" style={{ cursor: 'default' }}>
              <div className="list-item-icon" style={{ background: 'var(--green-soft)' }}>
                <Icon name="users" size={17} color="var(--green)" />
              </div>
              <div className="list-item-body">
                <span className="list-item-title">
                  {user.role === 'admin' ? 'Administrator' : 'Træner'}
                </span>
                <span className="list-item-detail">
                  {lederHolds.length > 0
                    ? lederHolds.map(h => h.titel).join(', ')
                    : user.role === 'admin' ? 'Alle hold' : 'Ingen hold tilknyttet endnu'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Support ──────────────────────────────── */}
      <SectionHeader title="Support" />
      <div className="list-group">
        <button className="list-item" onClick={() => setSupportOpen(true)}>
          <div className="list-item-icon" style={{ background: '#eff6ff' }}>
            <Icon name="message" size={17} color="#2563eb" />
          </div>
          <div className="list-item-body">
            <span className="list-item-title">Hjælp &amp; FAQ</span>
            <span className="list-item-detail">Stil et spørgsmål eller søg i FAQ</span>
          </div>
          <Icon name="chevron" size={16} color="var(--text3)" />
        </button>
      </div>

      {supportOpen && <SupportModal user={user} onClose={() => setSupportOpen(false)} />}

      <div style={{ height: 16 }} />
      <div style={{ padding: '0 16px' }}>
        <button type="button" className="btn btn-secondary btn-full" onClick={onLogout}>
          <Icon name="logout" size={17} color="var(--green)" />
          Log ud
        </button>
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

function UnverifiedScreen({ user, onLogout }) {
  const [resent, setResent] = useState(false)
  async function resend() {
    try { await sendEmailVerification(auth.currentUser); setResent(true) } catch {}
  }
  return (
    <div className="screen" style={{ padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Bekræft din email</h2>
      <p style={{ fontSize: 15, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 24 }}>
        Du er logget ind som <strong>{user.email}</strong>,
        men din email er endnu ikke verificeret.
      </p>
      <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 24 }}>
        Tjek din indbakke og klik bekræftelseslinket
        for at få adgang til hold og indhold.
      </p>
      <button className="btn btn-primary btn-full" onClick={resend} disabled={resent}>
        {resent ? '✓ Bekræftelsesmail sendt' : 'Send bekræftelsesmail igen'}
      </button>
      <button className="btn btn-secondary btn-full" style={{ marginTop: 12 }} onClick={onLogout}>
        Log ud
      </button>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser]                           = useState(null)
  const [authChecked, setAuthChecked]             = useState(false)
  const authCheckedRef                            = useRef(false)
  const [installDone, setInstallDone]             = useState(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true
    return standalone || localStorage.getItem('ssif_install_done') === '1'
  })
  const [activeTab, setActiveTab]                 = useState('dashboard')
  const [selectedTeam, setSelectedTeam]           = useState(null)
  const [selectedArticle, setSelectedArticle]     = useState(null)
  const [selectedMsg,   setSelectedMsg]           = useState(null)
  const [selectedEvent, setSelectedEvent]         = useState(null)
  const [msgUnread,    setMsgUnread]              = useState(0)
  const [news, setNews]                           = useState([])
  const [newsLive, setNewsLive]                   = useState(false)
  const [loginError, setLoginError]               = useState('')
  const [pushGranted, setPushGranted]             = useState(false)
  const [verifyMsg, setVerifyMsg]                 = useState('')

  // PHP-endpointet (verify-email.php) håndterer selve Firestore-opdateringen
  // og redirecter hertil med ?verifySuccess=1 eller ?verifyError=X
  useEffect(() => {
    const p       = new URLSearchParams(window.location.search)
    const success = p.get('verifySuccess')
    const error   = p.get('verifyError')
    if (!success && !error) return
    window.history.replaceState({}, '', window.location.pathname + window.location.hash)
    if (success) {
      setVerifyMsg('Email bekræftet!')
      setActiveTab('profil')
    }
    if (error) {
      const msgs = {
        expired:  'Linket er allerede brugt eller udløbet.',
        invalid:  'Ugyldigt verificeringslink.',
        notfound: 'Brugeren blev ikke fundet.',
      }
      setLoginError(msgs[error] || 'Verificering fejlede — prøv at tilføje emailen igen.')
    }
  }, [])

  // ── Load + merge Firestore profile ───────────────────────────────────────
  async function loadAndSetUser(fbUser) {
    let profile = {}
    let memberHoldIds     = []
    let lederHoldIds      = []
    let memberConventusId = null

    // Conventus custom-token brugere har null fbUser.email.
    // Email og navn gemmes i sessionStorage af conventusLogin() inden signInWithCustomToken kaldes.
    let _cvInit = null
    try {
      const _raw = sessionStorage.getItem('_ssif_cv')
      if (_raw) { _cvInit = JSON.parse(_raw); sessionStorage.removeItem('_ssif_cv') }
    } catch {}
    const effectiveEmail  = fbUser.email || _cvInit?.email || ''
    // Conventus-login er i sig selv et bevis på verificeret email — Firebase custom tokens har altid emailVerified=false
    const isConventusUser = fbUser.uid.startsWith('conventus_')
    const emailVerified   = isConventusUser || fbUser.emailVerified

    try {
      const ref  = doc(db, 'users', fbUser.uid)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        profile = snap.data()
      } else {
        profile = {
          primaryEmail:  effectiveEmail,
          displayName:   _cvInit?.displayName || fbUser.displayName || effectiveEmail.split('@')[0] || 'Bruger',
          emailVerified,
          extraEmails:   [],
          holdIds:       [],
          role:          'Medlem',
          createdAt:     serverTimestamp(),
        }
        setDoc(ref, profile).catch(() => {})
      }

      // Hent hold-IDs + leder-relationer fra members-samlingen (synkroniseret fra Conventus).
      // Inkluder primær email + verificerede extra-emails så trænere registreret med anden email får rettigheder.
      if (effectiveEmail) {
        const verifiedExtras = (profile.extraEmails || [])
          .filter(e => (typeof e === 'object' ? e.verified : false))
          .map(e => (typeof e === 'object' ? e.email : e).toLowerCase())
        const allEmails = [...new Set([effectiveEmail.toLowerCase(), ...verifiedExtras])]
        const mSnap = await getDocs(query(
          collection(db, 'members'),
          where('allEmails', 'array-contains-any', allEmails.slice(0, 10))
        ))
        mSnap.docs.forEach(d => {
          const data = d.data()
          if (!memberConventusId && data.conventus_id) memberConventusId = data.conventus_id
          ;(data.holds || []).forEach(h => {
            if (h.conventus_id) memberHoldIds.push(String(h.conventus_id))
          })
          ;(data.lederHolds || []).forEach(id => {
            lederHoldIds.push(String(id))
          })
        })
      }

      // Skriv lastSeen + sammenslåede holdIds + evt. rolle til Firestore
      if (snap.exists()) {
        const updates = { lastSeen: serverTimestamp() }
        if (profile.emailVerified !== emailVerified) updates.emailVerified = emailVerified
        if (memberHoldIds.length > 0) {
          updates.holdIds = [...new Set([...(profile.holdIds || []).map(String), ...memberHoldIds])]
        }
        // Synk trainer-rolle med Firestore så PHP-backend kan autorisere korrekt
        if (lederHoldIds.length > 0 && profile.role !== 'admin') {
          updates.role = 'trainer'
        } else if (lederHoldIds.length === 0 && profile.role === 'trainer') {
          updates.role = 'Medlem'
        }
        updateDoc(ref, updates).catch(() => {})

        // Synk lastMsgSeen fra Firestore → localStorage så ulæst-status bevares på tværs af sessioner
        if (profile.lastMsgSeen) {
          const local    = parseInt(localStorage.getItem('ssif_msgs_seen') || '0', 10)
          const fromDb   = Number(profile.lastMsgSeen)
          const latest   = Math.max(local, fromDb)
          localStorage.setItem('ssif_msgs_seen', String(latest))
        }
      }
    } catch {}

    const displayName = profile.displayName || _cvInit?.displayName || fbUser.displayName || effectiveEmail.split('@')[0] || 'Bruger'
    const parts = displayName.trim().split(' ').filter(Boolean)
    setUser({
      name:          displayName,
      firstName:     parts[0] || 'Bruger',
      email:         effectiveEmail,
      uid:           fbUser.uid,
      emailVerified,
      initials:      ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase()
                     || (effectiveEmail?.slice(0,2).toUpperCase() ?? 'SS'),
      role:           profile.role === 'admin'   ? 'admin'
                    : lederHoldIds.length > 0   ? 'trainer'
                    : profile.role === 'trainer' ? 'trainer'
                    : 'Medlem',
      holds:          profile.holds         || [],
      holdIds:        [...new Set([...(profile.holdIds || []).map(String), ...memberHoldIds])],
      // Hvis lederHolds er tomme men Firestore siger trainer (evt. sync ikke kørt), brug holdIds som fallback
      lederHoldIds:   lederHoldIds.length > 0
                        ? lederHoldIds
                        : profile.role === 'trainer'
                          ? [...new Set([...(profile.holdIds || []).map(String), ...memberHoldIds])]
                          : [],
      familyMembers:  profile.familyMembers  || [],
      primaryEmail:   profile.primaryEmail   || fbUser.email || '',
      extraEmails:    profile.extraEmails    || [],
      conventus_id:         memberConventusId || _cvInit?.conventusId || null,
      onboardingDone:         profile.onboardingDone === true,
      trainerOnboardingDone:  profile.trainerOnboardingDone === true,
      emailNotifications:     profile.emailNotifications !== false,
      consentGiven:           profile.consentGiven === true && profile.consentVersion === CONSENT_VERSION,
    })
  }

  // ── Auth state listener + redirect-håndtering ───────────────────────────
  // getRedirectResult SKAL afventes inden vi viser loginskærmen.
  // Ellers: onAuthStateChanged(null) vises momentant inden redirectet
  // er færdigbehandlet, og brugeren ender på loginskærmen.
  useEffect(() => {
    let mounted = true

    const unsubAuth = onAuthStateChanged(auth, async fbUser => {
      if (!mounted) return
      if (fbUser) {
        // Bruger logget ind (uanset om via redirect, kodeord eller eksisterende session)
        await loadAndSetUser(fbUser)
        if (mounted) { authCheckedRef.current = true; setAuthChecked(true) }
      } else if (authCheckedRef.current) {
        // Bruger logget ud efter initial load (fx signOut) — vis loginskærm
        setUser(null)
      }
      // Ved initial load med null: ventes på getRedirectResult nedenfor
    })

    // Behandl redirect-resultat fra Google/Facebook signInWithRedirect.
    // Returnerer null hurtigt hvis der ikke er et afventende redirect.
    getRedirectResult(auth)
      .then(() => {
        if (!mounted) return
        // Hvis ingen bruger kom ud af redirectet (og ingen eksisterende session),
        // viser vi loginskærmen nu.
        if (!auth.currentUser) {
          setUser(null)
          authCheckedRef.current = true; setAuthChecked(true)
        }
      })
      .catch(err => {
        if (!mounted) return
        const msg = AUTH_ERRORS[err.code]
        if (msg) setLoginError(msg)
        else if (err.code && err.code !== 'auth/null-user') setLoginError(err.message)
        if (!auth.currentUser) {
          setUser(null)
          authCheckedRef.current = true; setAuthChecked(true)
        }
      })

    return () => { mounted = false; unsubAuth() }
  }, [])

  // ── Firestore: news (getDocs — nyheder ændres sjældent) ─────────────────
  useEffect(() => {
    if (!user) return
    getDocs(query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(50)))
      .then(snap => { if (!snap.empty) { setNews(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setNewsLive(true) } })
      .catch(() => setNewsLive(false))
  }, [user?.uid])

  // ── Ulæste beskeder (getDocs — badge behøver ikke realtid) ───────────────
  useEffect(() => {
    if (!user) return
    const seenTs = parseInt(localStorage.getItem('ssif_msgs_seen') || '0', 10)
    const userHoldIds = new Set([
      ...(user.holdIds       || []).map(String),
      ...(user.holds         || []).map(String),
      ...(user.familyMembers || []).filter(m => m.holdId).map(m => String(m.holdId)),
    ])
    getDocs(query(collection(db, 'messages'), orderBy('oprettet', 'desc'), limit(60)))
      .then(snap => {
        const count = snap.docs.filter(d => {
          const data = d.data()
          const ts   = (data.oprettet || data.createdAt)?.toDate?.().getTime() ?? 0
          const inHold = data.holdId
            ? userHoldIds.has(String(data.holdId))
            : (data.targetHolds || []).some(h => userHoldIds.has(typeof h === 'object' ? String(h.conventus_id) : String(h)))
          return ts > seenTs && inHold
        }).length
        setMsgUnread(count)
      }).catch(() => {})
  }, [user?.uid])

  // ── FCM: knappen vises/skjules via synkron check (ingen useEffect-timing) ─
  async function handleEnableNotifications() {
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        setPushGranted(true) // skjuler banneret ved at tvinge re-render

        const messaging = getAppMessaging()
        if (!messaging) return
        const swReg = await navigator.serviceWorker.ready
        const token = await getToken(messaging, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: swReg,
        })
        if (token && user?.uid) {
          await updateDoc(doc(db, 'users', user.uid), { fcmToken: token })
        }
      }
    } catch (err) {
      console.warn('[FCM]', err.message)
    }
  }

  // Synkron check – evalueres på hvert render, ingen asynkron forsinkelse
  function canRequestPush() {
    if (!user?.uid || pushGranted) return false
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return false
    try { return Notification.permission !== 'granted' && Notification.permission !== 'denied' }
    catch { return false }
  }

  // ── FCM forgrunds-beskeder (app åben) ────────────────────────────────────
  useEffect(() => {
    if (!user) return
    const messaging = getAppMessaging()
    if (!messaging) return
    return onMessage(messaging, payload => {
      const n = payload.notification ?? {}
      if (Notification.permission === 'granted' && n.title) {
        new Notification(n.title, {
          body: n.body || '',
          icon: `${import.meta.env.BASE_URL}ssif-logo.png`,
        })
      }
    })
  }, [!!user])

  // ── Navigation ────────────────────────────────────────────────────────────
  function switchTab(tab) {
    setActiveTab(tab); setSelectedTeam(null); setSelectedArticle(null); setSelectedMsg(null); setSelectedEvent(null)
  }

  function navigateFromDashboard(dest, data) {
    if (dest === 'news-detail')   { setActiveTab('news');     setSelectedArticle(data) }
    else if (dest === 'team-detail')  { setActiveTab('teams');    setSelectedTeam(data) }
    else if (dest === 'event-detail') { setActiveTab('kalender'); setSelectedEvent(data) }
    else switchTab(dest)
  }

  async function handleLogout() {
    setUser(null); setActiveTab('dashboard')
    setSelectedTeam(null); setSelectedArticle(null); setSelectedMsg(null)
    setNewsLive(false); setNews([])
    setInstallDone(true) // Gå direkte til login-siden, ikke installationsprompt
    try { await signOut(auth) } catch {}
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (!authChecked) return <SplashScreen />

  // Vis installationsprompt i browser (ikke i installeret PWA)
  if (!installDone) {
    return (
      <InstallPromptScreen onContinue={() => {
        localStorage.setItem('ssif_install_done', '1')
        setInstallDone(true)
      }} />
    )
  }

  if (!user) {
    return (
      <LoginScreen initialError={loginError} />
    )
  }

  // Samtykkeskærm — vises til alle brugere der ikke har accepteret gældende version
  if (!user.consentGiven) {
    return (
      <ConsentScreen
        user={user}
        onConsent={({ emailNotifications }) =>
          setUser(u => ({ ...u, consentGiven: true, emailNotifications }))
        }
      />
    )
  }

  // Velkomstskærm ved første login (vises én gang, gemmes i Firestore)
  if (!user.onboardingDone) {
    return (
      <WelcomeScreen
        user={user}
        onDone={() => setUser(u => ({ ...u, onboardingDone: true }))}
      />
    )
  }

  // Træner-introduktion — vises første gang en træner/admin logger ind
  const isTrainerRole = user.role === 'trainer' || user.role === 'admin'
  if (isTrainerRole && !user.trainerOnboardingDone) {
    return (
      <TrainerWelcomeScreen
        user={user}
        onDone={() => setUser(u => ({ ...u, trainerOnboardingDone: true }))}
      />
    )
  }

  // ── Header state ─────────────────────────────────────────────────────────
  const TAB_TITLES = { dashboard: 'Hjem', profil: 'Min profil', teams: 'Hold', news: 'Nyheder', messages: 'Beskeder', kalender: 'Kalender' }
  let headerTitle = TAB_TITLES[activeTab] ?? 'SSIF'
  let onBack = null
  let backLabel = null

  if (activeTab === 'teams' && selectedTeam) {
    headerTitle = selectedTeam.titel || selectedTeam.name; onBack = () => setSelectedTeam(null); backLabel = 'Hold'
  } else if (activeTab === 'news' && selectedArticle) {
    headerTitle = 'Nyhed'; onBack = () => setSelectedArticle(null); backLabel = 'Nyheder'
  } else if (activeTab === 'messages' && selectedMsg) {
    headerTitle = 'Besked'; onBack = () => setSelectedMsg(null); backLabel = 'Beskeder'
  } else if (activeTab === 'kalender' && selectedEvent) {
    headerTitle = selectedEvent.titel || 'Event'; onBack = () => setSelectedEvent(null); backLabel = 'Kalender'
  }

  const totalUnread = msgUnread

  return (
    <div className="app">
      <AppHeader title={headerTitle} onBack={onBack} backLabel={backLabel} />

      <main className="app-content">
        {activeTab === 'dashboard' && (
          <DashboardScreen user={user} unreadMsgs={msgUnread} news={news} onNavigate={navigateFromDashboard}
            showPushBanner={canRequestPush()} onEnableNotifications={handleEnableNotifications} />
        )}
        {activeTab === 'profil' && (
          <ProfileScreen user={user} onLogout={handleLogout}
                         onUserUpdate={setUser} verifyMsg={verifyMsg}
                         onEnableNotifications={handleEnableNotifications} />
        )}
        {activeTab === 'teams' && !user.emailVerified ? (
          <UnverifiedScreen user={user} onLogout={handleLogout} />
        ) : activeTab === 'teams' && !selectedTeam ? (
          <TeamsScreen onSelectTeam={setSelectedTeam} user={user} onGoToProfile={() => switchTab('profil')} />
        ) : activeTab === 'teams' && selectedTeam ? (
          <TeamDetailScreen team={selectedTeam} user={user} />
        ) : null}
        {activeTab === 'news' && !selectedArticle && (
          <NewsScreen articles={news} isLive={newsLive} onSelectArticle={setSelectedArticle} />
        )}
        {activeTab === 'news' && selectedArticle && (
          <NewsDetailScreen article={selectedArticle} />
        )}
        {activeTab === 'messages' && !user.emailVerified ? (
          <UnverifiedScreen user={user} onLogout={handleLogout} />
        ) : activeTab === 'messages' && !selectedMsg ? (
          <FeedScreen
            user={user}
            onSelectMsg={setSelectedMsg}
            onMarkSeen={() => {
                setMsgUnread(0)
                if (user?.uid) {
                  const now = Date.now()
                  updateDoc(doc(db, 'users', user.uid), { lastMsgSeen: now }).catch(() => {})
                }
              }}
            onEnableNotifications={handleEnableNotifications}
          />
        ) : activeTab === 'messages' && selectedMsg ? (
          <MessageDetailScreen msg={selectedMsg} user={user} onBack={() => setSelectedMsg(null)} />
        ) : null}
        {activeTab === 'kalender' && !user.emailVerified ? (
          <UnverifiedScreen user={user} onLogout={handleLogout} />
        ) : activeTab === 'kalender' && !selectedEvent ? (
          <KalenderScreen user={user} onSelectEvent={setSelectedEvent} />
        ) : activeTab === 'kalender' && selectedEvent ? (
          <EventDetailScreen event={selectedEvent} user={user} onEventDeleted={() => setSelectedEvent(null)} onEventUpdated={updated => setSelectedEvent(prev => ({ ...prev, ...updated }))} />
        ) : null}
      </main>

      <BottomNav activeTab={activeTab} onChange={switchTab} unreadCount={totalUnread} />
    </div>
  )
}
