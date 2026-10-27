import { useState, useEffect } from 'react'
import {
  onAuthStateChanged, signOut,
  signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithCustomToken,
} from 'firebase/auth'
import { auth } from './firebase.js'
import './trainer.css'

// ── App ───────────────────────────────────────────────────────────────────────
// Screens: splash → login → (checking) → app | denied | unverified
// Adgang afgøres af /api/trainer-data.php (lederHolds i Conventus), ikke users.role.

export default function App() {
  const [screen,  setScreen]  = useState('splash')
  const [fbUser,  setFbUser]  = useState(null)
  const [trainerName, setTrainerName] = useState('')
  const [holds,   setHolds]   = useState([])

  useEffect(() => {
    return onAuthStateChanged(auth, async fbUser => {
      if (!fbUser) {
        setFbUser(null)
        setScreen('login')
        return
      }
      setFbUser(fbUser)
      setScreen('checking')
      await checkAccess(fbUser)
    })
  }, [])

  async function checkAccess(fbUser) {
    try {
      const idToken = await fbUser.getIdToken()
      const res  = await fetch('/api/trainer-data.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const data = await res.json()
      if (data.holds) {
        setTrainerName(data.name || fbUser.displayName || '')
        setHolds(data.holds)
        setScreen('app')
      } else if (data.error === 'email_not_verified') {
        setScreen('unverified')
      } else {
        setScreen('denied')
      }
    } catch {
      setScreen('denied')
    }
  }

  function handleLogout() {
    signOut(auth).catch(() => {})
    setFbUser(null)
    setHolds([])
    setTrainerName('')
  }

  if (screen === 'splash' || screen === 'checking') return <SplashScreen />
  if (screen === 'login')      return <LoginScreen />
  if (screen === 'unverified') return <UnverifiedScreen user={fbUser} onLogout={handleLogout} />
  if (screen === 'denied')     return <AccessDeniedScreen user={fbUser} onLogout={handleLogout} />
  return (
    <DashboardScreen
      user={fbUser}
      displayName={trainerName || fbUser?.displayName || fbUser?.email?.split('@')[0] || 'Træner'}
      holds={holds}
      onLogout={handleLogout}
      onRefresh={() => checkAccess(fbUser)}
    />
  )
}

// ── SplashScreen ──────────────────────────────────────────────────────────────

function SplashScreen() {
  return (
    <div className="screen-center" style={{ flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 48, lineHeight: 1 }}>⚽</div>
      <div className="spinner" />
    </div>
  )
}

// ── LoginScreen ───────────────────────────────────────────────────────────────

function LoginScreen() {
  const [view,         setView]         = useState('main')
  const [pendingToken, setPendingToken] = useState(null)
  const [profiles,     setProfiles]     = useState([])
  const [cEmail, setCEmail] = useState('')
  const [cPass,  setCPass]  = useState('')
  const [eEmail, setEEmail] = useState('')
  const [ePass,  setEPass]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  function go(v) { setError(''); setView(v) }

  async function loginConventus() {
    if (!cEmail || !cPass) return
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/conventus-login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cEmail, password: cPass }),
      })
      const data = await res.json()
      if (data.customToken) {
        await signInWithCustomToken(auth, data.customToken)
      } else if (data.status === 'multiple_profiles') {
        setPendingToken(data.pendingToken)
        setProfiles(data.profiles || [])
        setView('conventus-profiles')
      } else {
        setError(data.error || 'Forkert email eller adgangskode.')
      }
    } catch {
      setError('Netværksfejl. Prøv igen.')
    } finally {
      setLoading(false)
    }
  }

  async function selectProfile(profileId) {
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/conventus-select-profile.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken, profileId }),
      })
      const data = await res.json()
      if (data.customToken) {
        await signInWithCustomToken(auth, data.customToken)
      } else {
        setError(data.error || 'Kunne ikke vælge profil.')
      }
    } catch {
      setError('Netværksfejl. Prøv igen.')
    } finally {
      setLoading(false)
    }
  }

  async function loginGoogle() {
    setLoading(true); setError('')
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') setError('Google-login fejlede. Prøv igen.')
    } finally {
      setLoading(false)
    }
  }

  async function loginEmail() {
    if (!eEmail || !ePass) return
    setLoading(true); setError('')
    try {
      await signInWithEmailAndPassword(auth, eEmail, ePass)
    } catch {
      setError('Forkert email eller adgangskode.')
    } finally {
      setLoading(false)
    }
  }

  // ── Main ──
  if (view === 'main') return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 44, marginBottom: 10, lineHeight: 1 }}>⚽</div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: 'var(--green)', marginBottom: 3 }}>SSIF Træner</h1>
          <p style={{ fontSize: 14, color: 'var(--text3)' }}>Sejs-Svejbæk IF</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => go('conventus')} disabled={loading}>
            Log ind med Conventus
          </button>
          <div className="divider">eller</div>
          <button className="btn btn-outline" onClick={loginGoogle} disabled={loading}>
            <GoogleIcon />
            Log ind med Google
          </button>
          <button className="btn btn-outline" onClick={() => go('email')} disabled={loading}
            style={{ fontSize: 14 }}>
            Log ind med email og adgangskode
          </button>
        </div>
        {error && <p style={{ marginTop: 14, textAlign: 'center', fontSize: 13, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )

  // ── Conventus-formular ──
  if (view === 'conventus') return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <button className="btn btn-ghost" onClick={() => go('main')}>← Tilbage</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: '16px 0 4px' }}>Conventus-login</h2>
        <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>Brug din Conventus-email og adgangskode.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={cEmail}
              onChange={e => setCEmail(e.target.value)}
              placeholder="din@email.dk" autoComplete="username" />
          </div>
          <div className="form-field">
            <label className="form-label">Adgangskode</label>
            <input className="form-input" type="password" value={cPass}
              onChange={e => setCPass(e.target.value)}
              placeholder="••••••••" autoComplete="current-password"
              onKeyDown={e => e.key === 'Enter' && loginConventus()} />
          </div>
          <button className="btn btn-primary" onClick={loginConventus}
            disabled={loading || !cEmail || !cPass}>
            {loading ? 'Logger ind…' : 'Log ind'}
          </button>
        </div>
        {error && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )

  // ── Multi-profil ──
  if (view === 'conventus-profiles') return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Vælg profil</h2>
        <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>
          Din email er knyttet til flere Conventus-profiler.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {profiles.map(p => (
            <button key={p.id} className="btn btn-outline" disabled={loading}
              onClick={() => selectProfile(p.id)}
              style={{ justifyContent: 'flex-start', gap: 12, padding: '12px 14px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'var(--green-soft)', color: 'var(--green)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 15,
              }}>
                {(p.name || '?')[0].toUpperCase()}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{p.email}</div>
              </div>
            </button>
          ))}
        </div>
        {error && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )

  // ── Email-formular ──
  if (view === 'email') return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <button className="btn btn-ghost" onClick={() => go('main')}>← Tilbage</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: '16px 0 4px' }}>Log ind med email</h2>
        <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>Brug din SSIF App-email og adgangskode.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={eEmail}
              onChange={e => setEEmail(e.target.value)}
              placeholder="din@email.dk" autoComplete="username" />
          </div>
          <div className="form-field">
            <label className="form-label">Adgangskode</label>
            <input className="form-input" type="password" value={ePass}
              onChange={e => setEPass(e.target.value)}
              placeholder="••••••••" autoComplete="current-password"
              onKeyDown={e => e.key === 'Enter' && loginEmail()} />
          </div>
          <button className="btn btn-primary" onClick={loginEmail}
            disabled={loading || !eEmail || !ePass}>
            {loading ? 'Logger ind…' : 'Log ind'}
          </button>
        </div>
        {error && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  )

  return null
}

// ── AccessDeniedScreen ────────────────────────────────────────────────────────

function AccessDeniedScreen({ user, onLogout }) {
  return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Ingen adgang</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 6 }}>
          Dette værktøj er kun for trænere og ledere i Sejs-Svejbæk IF.
        </p>
        {user?.email && (
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 6 }}>
            Logget ind som {user.email}
          </p>
        )}
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 28 }}>
          Kontakt en administrator, hvis du mener det er en fejl.
        </p>
        <button className="btn btn-primary" onClick={onLogout} style={{ maxWidth: 220, margin: '0 auto' }}>
          Log ud
        </button>
      </div>
    </div>
  )
}

// ── UnverifiedScreen ──────────────────────────────────────────────────────────

function UnverifiedScreen({ user, onLogout }) {
  return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>📧</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Bekræft din mail</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 6 }}>
          Din mailadresse er ikke bekræftet endnu.
        </p>
        {user?.email && (
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 24 }}>
            Tjek din indbakke for en bekræftelsesmail til <strong>{user.email}</strong>.
          </p>
        )}
        <button className="btn btn-primary" onClick={onLogout} style={{ maxWidth: 220, margin: '0 auto' }}>
          Log ud
        </button>
      </div>
    </div>
  )
}

// ── DashboardScreen ───────────────────────────────────────────────────────────

function DashboardScreen({ displayName, holds, onLogout, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  return (
    <div className="screen">
      {/* App-bar */}
      <header style={{
        background: 'var(--green)', color: '#fff',
        padding: '13px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>⚽</span>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>SSIF Træner</span>
        <button onClick={handleRefresh} disabled={refreshing} style={{
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,.75)', cursor: 'pointer',
          fontSize: 13, fontWeight: 500, marginRight: 10,
          opacity: refreshing ? .5 : 1,
        }}>
          {refreshing ? '…' : '↻'}
        </button>
        <button onClick={onLogout} style={{
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,.75)', cursor: 'pointer',
          fontSize: 13, fontWeight: 500,
        }}>
          Log ud
        </button>
      </header>

      {/* Indhold */}
      <main style={{ padding: '20px 16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1 }}>
        <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 22 }}>
          Hej {displayName} 👋
        </p>

        <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Mine hold</h2>

        {holds.length === 0 ? (
          <div className="empty-state">
            <h3>Ingen aktive hold</h3>
            <p>
              Din konto er ikke registreret som leder på nogen aktive hold i Conventus.<br />
              Kontakt en administrator.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {holds.map(hold => (
              <div key={hold.id} className="hold-card">
                <div className="hold-icon">🏃</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                    {hold.titel || `Hold ${hold.id}`}
                  </div>
                  {hold.afdeling && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2 }}>
                      {hold.afdeling}
                    </div>
                  )}
                </div>
                <svg style={{ marginLeft: 'auto', color: 'var(--text3)', flexShrink: 0 }}
                  width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M6.5 4.5l4.5 4.5-4.5 4.5" stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ── Ikoner ────────────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2a10.3 10.3 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92A8.78 8.78 0 0 0 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.92-2.26a5.43 5.43 0 0 1-8.07-2.85H.96v2.34A9 9 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.95H.96a9 9 0 0 0 0 8.1l3-2.34z" fill="#FBBC05"/>
      <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35L14.56 2.9A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .96 4.95l3 2.34A5.36 5.36 0 0 1 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
