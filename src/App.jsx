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

export default function App() {
  const [screen,      setScreen]      = useState('splash')
  const [fbUser,      setFbUser]      = useState(null)
  const [trainerName, setTrainerName] = useState('')
  const [holds,       setHolds]       = useState([])
  const [testMode,    setTestMode]    = useState(false)

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
        setTestMode(data.testMode || false)
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
    setTestMode(false)
  }

  if (screen === 'splash' || screen === 'checking') return <SplashScreen />
  if (screen === 'login')      return <LoginScreen />
  if (screen === 'unverified') return <UnverifiedScreen user={fbUser} onLogout={handleLogout} />
  if (screen === 'denied')     return <AccessDeniedScreen user={fbUser} onLogout={handleLogout} />
  return (
    <>
      {testMode && <TestModeBanner />}
      <DashboardScreen
        user={fbUser}
        displayName={trainerName || fbUser?.displayName || fbUser?.email?.split('@')[0] || 'Træner'}
        holds={holds}
        onLogout={handleLogout}
        onRefresh={() => checkAccess(fbUser)}
      />
    </>
  )
}

// ── TestModeBanner ────────────────────────────────────────────────────────────

function TestModeBanner() {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#ea8c00', color: '#fff',
      padding: '8px 16px',
      fontSize: 13, fontWeight: 700, textAlign: 'center',
      boxShadow: '0 2px 6px rgba(0,0,0,.2)',
    }}>
      TESTTILSTAND AKTIV — alle mails og SMS'er går til testmodtager
    </div>
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

function DashboardScreen({ user, displayName, holds, onLogout, onRefresh }) {
  const [refreshing,   setRefreshing]   = useState(false)
  const [selectedHold, setSelectedHold] = useState(null)

  async function handleRefresh() {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  if (selectedHold) {
    return <HoldScreen hold={selectedHold} user={user} onBack={() => setSelectedHold(null)} />
  }

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
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
              <div key={hold.id} className="hold-card" onClick={() => setSelectedHold(hold)}>
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
                <ChevronIcon />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ── HoldScreen ────────────────────────────────────────────────────────────────

function HoldScreen({ hold, user, onBack }) {
  const [view,         setView]         = useState('liste')
  const [begivenheder, setBegivenheder] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [selectedBev,  setSelectedBev]  = useState(null)
  const [editBev,      setEditBev]      = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/hold-data.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: hold.id }),
      })
      const data = await res.json()
      if (data.begivenheder !== undefined) {
        setBegivenheder(data.begivenheder)
      } else {
        setError(data.error || 'Fejl ved hentning af begivenheder')
      }
    } catch {
      setError('Netværksfejl')
    } finally {
      setLoading(false)
    }
  }

  if (view === 'form') {
    return (
      <BegivenhedFormScreen
        hold={hold}
        begivenhed={editBev}
        user={user}
        onBack={() => {
          // Retur til detalje-view hvis vi kom derfra, ellers til liste
          if (editBev) { setView('detalje') } else { setView('liste') }
          setEditBev(null)
        }}
        onSaved={() => { setView('liste'); setEditBev(null); loadData() }}
        onDeleted={() => { setView('liste'); setEditBev(null); setSelectedBev(null); loadData() }}
      />
    )
  }

  if (view === 'detalje' && selectedBev) {
    return (
      <BegivenhedDetailScreen
        begivenhedId={selectedBev.id}
        user={user}
        onBack={() => { setView('liste'); setSelectedBev(null) }}
        onEdit={bevMedDeltagere => { setEditBev(bevMedDeltagere); setView('form') }}
        onDeleted={() => { setView('liste'); setSelectedBev(null); loadData() }}
      />
    )
  }

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: '#fff',
          cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0',
        }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>
          {hold.titel || `Hold ${hold.id}`}
        </span>
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {hold.afdeling && (
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>{hold.afdeling}</p>
        )}
        <button className="btn btn-primary" onClick={() => { setEditBev(null); setView('form') }}>
          + Opret begivenhed
        </button>

        {loading && <div className="spinner" style={{ margin: '32px auto' }} />}
        {error && <div className="error-box">{error}</div>}

        {!loading && !error && begivenheder.length === 0 && (
          <div className="empty-state">
            <h3>Ingen begivenheder endnu</h3>
            <p>Opret en kamp, et stævne, et event eller et møde.</p>
          </div>
        )}

        {begivenheder.map(bev => (
          <div key={bev.id} className="bev-card"
            onClick={() => { setSelectedBev(bev); setView('detalje') }}>
            <span className={`bev-type-badge bev-type-${bev.type}`}>{bev.type}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{bev.titel}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                {formatDato(bev.dato)}{bev.tidspunkt ? ` · ${bev.tidspunkt}` : ''}
              </div>
            </div>
            <ChevronIcon />
          </div>
        ))}
      </main>
    </div>
  )
}

// ── BegivenhedFormScreen ──────────────────────────────────────────────────────

const BEV_TYPES = [
  { id: 'kamp',    label: 'Kamp',   icon: '⚽' },
  { id: 'stævne', label: 'Stævne', icon: '🏆' },
  { id: 'event',  label: 'Event',  icon: '🎉' },
  { id: 'møde',   label: 'Møde',   icon: '📋' },
]

function BegivenhedFormScreen({ hold, begivenhed, user, onBack, onSaved, onDeleted }) {
  const isEdit = begivenhed !== null

  const [step,      setStep]      = useState(1)
  const [type,      setType]      = useState(begivenhed?.type || '')
  const [titel,     setTitel]     = useState(begivenhed?.titel || '')
  const [dato,      setDato]      = useState(begivenhed?.dato || '')
  const [tidspunkt, setTidspunkt] = useState(begivenhed?.tidspunkt || '')
  const [modetid,   setModetid]   = useState(begivenhed?.modetid || '')
  const [sted,      setSted]      = useState(begivenhed?.sted || '')
  const [beskrivelse, setBeskrivelse] = useState(begivenhed?.beskrivelse || '')

  const [spillere,       setSpillere]       = useState(null)
  const [udtaget,        setUdtaget]        = useState({})
  const [spillereLoad,   setSpillereLoad]   = useState(false)
  const [spillereError,  setSpillereError]  = useState('')

  const [saving,          setSaving]          = useState(false)
  const [formError,       setFormError]       = useState('')
  const [showSletConfirm, setShowSletConfirm] = useState(false)
  const [deleting,        setDeleting]        = useState(false)
  const [sletError,       setSletError]       = useState('')

  async function loadSpillere() {
    if (spillere !== null) return
    setSpillereLoad(true)
    setSpillereError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/hold-spillere.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: hold.id }),
      })
      const data = await res.json()
      if (Array.isArray(data)) {
        setSpillere(data)
        const u = {}
        data.forEach(s => {
          const existing = isEdit && begivenhed.deltagere
            ? begivenhed.deltagere.find(d => d.id === s.id)
            : null
          u[s.id] = existing ? existing.udtaget : true
        })
        setUdtaget(u)
      } else {
        setSpillereError(data.error || 'Fejl ved hentning af spillere')
      }
    } catch {
      setSpillereError('Netværksfejl')
    } finally {
      setSpillereLoad(false)
    }
  }

  async function handleNextStep() {
    if (!type || !titel.trim() || !dato || !tidspunkt) {
      setFormError('Udfyld type, titel, dato og tidspunkt.')
      return
    }
    setFormError('')
    await loadSpillere()
    setStep(2)
  }

  async function handleGem() {
    if (!spillere) return
    setSaving(true)
    setFormError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/begivenhed-gem.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          begivenhedId: isEdit ? begivenhed.id : null,
          holdId: hold.id,
          type, titel: titel.trim(), dato, tidspunkt,
          modetid: modetid.trim(),
          sted: sted.trim(),
          beskrivelse: beskrivelse.trim(),
          deltagere: spillere.map(s => ({
            id: s.id, navn: s.navn,
            udtaget: udtaget[s.id] !== false,
          })),
        }),
      })
      const data = await res.json()
      if (data.id) {
        onSaved(data.id)
      } else {
        setFormError(data.error || 'Gem fejlede')
      }
    } catch {
      setFormError('Netværksfejl')
    } finally {
      setSaving(false)
    }
  }

  async function handleSlet() {
    setDeleting(true)
    setSletError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/begivenhed-slet.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ begivenhedId: begivenhed.id }),
      })
      const data = await res.json()
      if (data.ok) {
        onDeleted()
      } else {
        setSletError(data.error || 'Sletning fejlede — prøv igen')
        setShowSletConfirm(false)
      }
    } catch {
      setSletError('Netværksfejl ved sletning')
      setShowSletConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  const udtajetAntal = spillere
    ? Object.values(udtaget).filter(Boolean).length
    : 0

  // Slet-sektion vises kun ved redigering
  const SletSektion = () => !isEdit ? null : (
    <div style={{ marginTop: 8 }}>
      {sletError && <div className="error-box" style={{ marginBottom: 10 }}>{sletError}</div>}
      {showSletConfirm ? (
        <div style={{
          background: 'var(--red-soft)', border: '1px solid var(--red-border)',
          borderRadius: 12, padding: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>
            Slet begivenheden permanent?
          </p>
          <p style={{ fontSize: 13, color: 'var(--text2)' }}>
            Alle deltagere og svartokens fjernes. Kan ikke fortrydes.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" style={{ flex: 1 }}
              onClick={() => { setShowSletConfirm(false); setSletError('') }}>
              Annuller
            </button>
            <button className="btn btn-primary"
              style={{ flex: 1, background: 'var(--red)' }}
              onClick={handleSlet} disabled={deleting}>
              {deleting ? 'Sletter…' : 'Slet'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost"
          style={{ color: 'var(--red)', width: '100%', justifyContent: 'center' }}
          onClick={() => setShowSletConfirm(true)}>
          Slet begivenhed
        </button>
      )}
    </div>
  )

  const header = (title, onBk) => (
    <header style={{
      background: 'var(--green)', color: '#fff',
      paddingTop: 'max(13px, env(safe-area-inset-top))',
      paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button onClick={onBk} style={{
        background: 'none', border: 'none', color: '#fff',
        cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0',
      }}>‹</button>
      <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>{title}</span>
    </header>
  )

  if (step === 1) return (
    <div className="screen">
      {header(isEdit ? 'Ret begivenhed' : 'Opret begivenhed', onBack)}
      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="steps">
          <span className="step active">1 Oplysninger</span>
          <span className="step-sep">›</span>
          <span className="step">2 Udtagelse</span>
        </div>

        <div>
          <div className="form-label" style={{ marginBottom: 10 }}>Type</div>
          <div className="type-grid">
            {BEV_TYPES.map(t => (
              <button key={t.id}
                className={`type-btn${type === t.id ? ' active' : ''}`}
                onClick={() => setType(t.id)}>
                <span className="type-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Titel</label>
          <input className="form-input" type="text" value={titel}
            onChange={e => setTitel(e.target.value)}
            placeholder="fx Kamp mod FC Silkeborg" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-field">
            <label className="form-label">Dato</label>
            <input className="form-input" type="date" value={dato}
              onChange={e => setDato(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Tidspunkt</label>
            <input className="form-input" type="time" value={tidspunkt}
              onChange={e => setTidspunkt(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-field">
            <label className="form-label">
              Mødetid <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(valgfri)</span>
            </label>
            <input className="form-input" type="time" value={modetid}
              onChange={e => setModetid(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">
              Sted <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(valgfri)</span>
            </label>
            <input className="form-input" type="text" value={sted}
              onChange={e => setSted(e.target.value)}
              placeholder="fx Sejs Hallen" />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">
            Beskrivelse <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(valgfri)</span>
          </label>
          <textarea className="form-input" value={beskrivelse}
            onChange={e => setBeskrivelse(e.target.value)}
            rows={3} style={{ resize: 'vertical' }}
            placeholder="Yderligere info til forældrene" />
        </div>

        {formError && <div className="error-box">{formError}</div>}

        <button className="btn btn-primary" onClick={handleNextStep}>
          Næste: Udtagelse →
        </button>

        <SletSektion />
      </main>
    </div>
  )

  // Trin 2 – udtagelse
  return (
    <div className="screen">
      {header('Udtagelse', () => setStep(1))}
      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="steps">
          <span className="step">1 Oplysninger</span>
          <span className="step-sep">›</span>
          <span className="step active">2 Udtagelse</span>
        </div>

        {spillereLoad && <div className="spinner" style={{ margin: '32px auto' }} />}
        {spillereError && <div className="error-box">{spillereError}</div>}

        {spillere && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text3)' }}>
              {udtajetAntal} af {spillere.length} udtaget · Tryk for at fravælge
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {spillere.map(s => {
                const er = udtaget[s.id] !== false
                return (
                  <div key={s.id}
                    className={`spiller-row${er ? '' : ' fravalgt'}`}
                    onClick={() => setUdtaget(prev => ({ ...prev, [s.id]: !prev[s.id] }))}>
                    <div className="spiller-check">{er && <CheckIcon />}</div>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{s.navn}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {formError && <div className="error-box">{formError}</div>}

        <button className="btn btn-primary"
          onClick={handleGem}
          disabled={saving || !spillere || !!spillereError}>
          {saving ? 'Gemmer…' : isEdit ? 'Gem ændringer' : 'Opret begivenhed'}
        </button>

        <SletSektion />
      </main>
    </div>
  )
}

// ── BegivenhedDetailScreen ────────────────────────────────────────────────────

function BegivenhedDetailScreen({ begivenhedId, user, onBack, onEdit, onDeleted }) {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [deleting,    setDeleting]    = useState(false)
  const [confirmSlet, setConfirmSlet] = useState(false)
  const [showSend,    setShowSend]    = useState(false)
  const [sending,     setSending]     = useState(false)
  const [sendFejl,    setSendFejl]    = useState('')
  const [sendOk,      setSendOk]      = useState(null)

  useEffect(() => { loadDetalje() }, [begivenhedId])

  // Poll hvert 10. sekund når begivenheden er udsendt
  useEffect(() => {
    if (!data?.begivenhed || data.begivenhed.status !== 'udsendt') return
    const id = setInterval(loadDetalje, 10000)
    return () => clearInterval(id)
  }, [data?.begivenhed?.status])

  async function loadDetalje() {
    setLoading(true)
    setError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/begivenhed-detalje.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ begivenhedId }),
      })
      const d = await res.json()
      if (d.begivenhed) {
        setData(d)
      } else {
        setError(d.error || 'Fejl ved hentning')
      }
    } catch {
      setError('Netværksfejl')
    } finally {
      setLoading(false)
    }
  }

  async function handleSlet() {
    setDeleting(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/begivenhed-slet.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ begivenhedId }),
      })
      const d = await res.json()
      if (d.ok) {
        onDeleted()
      } else {
        setError(d.error || 'Slet fejlede')
        setConfirmSlet(false)
      }
    } catch {
      setError('Netværksfejl')
      setConfirmSlet(false)
    } finally {
      setDeleting(false)
    }
  }

  async function handleSend(kanal) {
    setSending(true)
    setSendFejl('')
    setSendOk(null)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/begivenhed-send.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ begivenhedId, kanal }),
      })
      const d = await res.json()
      if (d.ok) {
        setSendOk(d)
        await loadDetalje()
      } else {
        setSendFejl(d.error || 'Udsendelse fejlede')
      }
    } catch {
      setSendFejl('Netværksfejl')
    } finally {
      setSending(false)
    }
  }

  const bev      = data?.begivenhed
  const deltagere = data?.deltagere ?? []
  const udtaget  = deltagere.filter(d => d.udtaget)
  const fravalgt = deltagere.filter(d => !d.udtaget)

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: '#fff',
          cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0',
        }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>
          {bev ? bev.titel : 'Begivenhed'}
        </span>
        {bev && !confirmSlet && (
          <button onClick={() => setConfirmSlet(true)} style={{
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,.75)', cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
          }}>Slet</button>
        )}
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && <div className="spinner" style={{ margin: '40px auto' }} />}
        {error && <div className="error-box">{error}</div>}

        {confirmSlet && (
          <div style={{
            background: 'var(--red-soft)', border: '1px solid var(--red-border)',
            borderRadius: 12, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>
              Slet begivenheden permanent?
            </p>
            <p style={{ fontSize: 13, color: 'var(--text2)' }}>
              Alle deltagere og svartokens fjernes. Kan ikke fortrydes.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }}
                onClick={() => setConfirmSlet(false)}>Annuller</button>
              <button className="btn btn-primary"
                style={{ flex: 1, background: 'var(--red)' }}
                onClick={handleSlet} disabled={deleting}>
                {deleting ? 'Sletter…' : 'Slet'}
              </button>
            </div>
          </div>
        )}

        {bev && !confirmSlet && (
          <>
            {/* Send-dialog */}
            {showSend ? (
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 16,
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  Send begivenhed til {udtaget.length} udtagne
                </p>
                {sendFejl && <div className="error-box">{sendFejl}</div>}
                {sendOk ? (
                  <div style={{
                    background: 'var(--green-soft)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: 12, fontSize: 13, color: 'var(--green)', fontWeight: 600,
                  }}>
                    Sendt til {sendOk.sendt}{sendOk.fejlet > 0 ? `, ${sendOk.fejlet} fejlede` : ''} ✓
                  </div>
                ) : (
                  <button className="btn btn-primary"
                    onClick={() => handleSend('mail')} disabled={sending || udtaget.length === 0}>
                    {sending ? 'Sender…' : 'Send mail med svarknapper'}
                  </button>
                )}
                <button className="btn btn-ghost"
                  style={{ textAlign: 'center', justifyContent: 'center' }}
                  onClick={() => { setShowSend(false); setSendFejl(''); setSendOk(null) }}>
                  {sendOk ? 'Luk' : 'Annuller'}
                </button>
              </div>
            ) : (
              <button className="btn btn-primary"
                onClick={() => { setShowSend(true); setSendFejl(''); setSendOk(null) }}
                disabled={udtaget.length === 0}>
                Send begivenhed til {udtaget.length} udtagne
              </button>
            )}

            <div style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 16,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`bev-type-badge bev-type-${bev.type}`}>
                  {bev.type}
                </span>
                {bev.status === 'udsendt' && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#1a5c2a',
                    background: '#e8f5ec', borderRadius: 6, padding: '3px 8px',
                  }}>Udsendt</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 3 }}>DATO</div>
                  <div style={{ fontWeight: 600 }}>{formatDato(bev.dato)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 3 }}>TIDSPUNKT</div>
                  <div style={{ fontWeight: 600 }}>{bev.tidspunkt}</div>
                </div>
                {bev.modetid && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 3 }}>MØDETID</div>
                    <div style={{ fontWeight: 600 }}>{bev.modetid}</div>
                  </div>
                )}
                {bev.sted && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 3 }}>STED</div>
                    <div style={{ fontWeight: 600 }}>{bev.sted}</div>
                  </div>
                )}
              </div>
              {bev.beskrivelse && (
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                  {bev.beskrivelse}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Svar-overblik (synligt når udsendt) */}
              {bev.status === 'udsendt' && (() => {
                const kom     = udtaget.filter(d => d.svar === 'kommer').length
                const ikkeKom = udtaget.filter(d => d.svar === 'kommer_ikke').length
                const ingen   = udtaget.filter(d => !d.svar).length
                return (
                  <div style={{
                    display: 'flex', gap: 8,
                    background: 'var(--surface)', borderRadius: 10,
                    padding: '10px 12px', fontSize: 13,
                  }}>
                    <span style={{ color: '#1a5c2a', fontWeight: 700 }}>✓ {kom}</span>
                    <span style={{ color: 'var(--text3)' }}>·</span>
                    <span style={{ color: 'var(--red)', fontWeight: 700 }}>✗ {ikkeKom}</span>
                    <span style={{ color: 'var(--text3)' }}>·</span>
                    <span style={{ color: 'var(--text3)', fontWeight: 600 }}>? {ingen}</span>
                    <span style={{ color: 'var(--text3)', marginLeft: 'auto', fontSize: 12 }}>opdateres løbende</span>
                  </div>
                )
              })()}

              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>
                Udtaget ({udtaget.length})
              </h3>
              {udtaget.map(d => (
                <div key={d.id} className="spiller-row" style={{ cursor: 'default' }}>
                  <div className="spiller-check"><CheckIcon /></div>
                  <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{d.navn}</span>
                  {d.svar === 'kommer' && (
                    <span style={{ fontSize: 12, color: '#1a5c2a', fontWeight: 700 }}>Kommer ✓</span>
                  )}
                  {d.svar === 'kommer_ikke' && (
                    <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>Kommer ikke</span>
                  )}
                </div>
              ))}

              {fravalgt.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)', marginTop: 6 }}>
                    Fravalgt ({fravalgt.length})
                  </h3>
                  {fravalgt.map(d => (
                    <div key={d.id} className="spiller-row fravalgt" style={{ cursor: 'default' }}>
                      <div className="spiller-check" />
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{d.navn}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <button className="btn btn-outline"
              onClick={() => onEdit({ ...bev, deltagere })}>
              Ret begivenhed
            </button>
          </>
        )}
      </main>
    </div>
  )
}

// ── Hjælpere og ikoner ────────────────────────────────────────────────────────

function formatDato(dato) {
  if (!dato) return ''
  try {
    return new Date(dato + 'T00:00:00').toLocaleDateString('da-DK', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
  } catch {
    return dato
  }
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 6.5l3 3 6-6" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg style={{ color: 'var(--text3)', flexShrink: 0 }}
      width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M6.5 4.5l4.5 4.5-4.5 4.5" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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
