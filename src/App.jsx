import { useState, useEffect } from 'react'
import {
  onAuthStateChanged, signOut,
  signInWithPopup, GoogleAuthProvider,
  signInWithCustomToken,
} from 'firebase/auth'
import {
  collection, query, where, orderBy, getDocs, addDoc, serverTimestamp,
  doc, setDoc,
} from 'firebase/firestore'
import { auth, db } from './firebase.js'
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
        setDoc(doc(db, 'users', fbUser.uid), {
          lastSeen:    serverTimestamp(),
          email:       fbUser.email || '',
          displayName: fbUser.displayName || data.name || '',
        }, { merge: true }).catch(() => {})
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

  if (view === 'main') return (
    <div className="screen-center">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/ssif-logo.png" alt="SSIF" style={{ height: 80, objectFit: 'contain', marginBottom: 14 }} />
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>SSIF Træner</h1>
          <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.55, maxWidth: 300, margin: '0 auto' }}>
            Opret begivenheder, udtag holdet og hold kontakten med forældrene — alt samlet ét sted.
          </p>
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
          <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5, margin: '2px 0 4px' }}>
            Kun hvis din Google-konto bruger den samme mail som i Conventus.
            Ellers brug Conventus-login.
          </p>
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
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 28 }}>
            Logget ind som {user.email}
          </p>
        )}
        <button className="btn btn-primary" onClick={onLogout}
          style={{ maxWidth: 220, margin: '0 auto' }}>
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

const FEATURE_CARDS = [
  { emoji: '📅', title: 'Begivenheder', desc: 'Opret kampe, stævner, møder og events for holdet.' },
  { emoji: '👥', title: 'Udtag holdet', desc: 'Vælg de spillere der skal med og send invitation.' },
  { emoji: '✅', title: 'Tilmeldinger', desc: 'Se live hvem der kommer — og hvem der melder fra.' },
  { emoji: '💬', title: 'Send besked', desc: 'Send hurtig besked til alle holdets forældre.' },
  { emoji: '📋', title: 'Spillerliste', desc: 'Se hvilke spillere der er tilmeldt holdet i Conventus.' },
]

function DashboardScreen({ user, displayName, holds, onLogout, onRefresh }) {
  const [refreshing,   setRefreshing]   = useState(false)
  const [selectedHold, setSelectedHold] = useState(null)
  const [showSupport,  setShowSupport]  = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  if (selectedHold) {
    return <HoldScreen hold={selectedHold} user={user} onBack={() => setSelectedHold(null)} />
  }

  if (showSupport) {
    return <SupportScreen user={user} onBack={() => setShowSupport(false)} />
  }

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <img src="/ssif-logo-white.png" alt="SSIF" style={{ height: 28, objectFit: 'contain', flexShrink: 0 }} />
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
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>
          Hej {displayName} 👋
        </p>

        <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>Mine hold</h2>

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

        {/* Hvad kan du i appen? */}
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, color: 'var(--text2)' }}>Hvad kan du i appen?</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {FEATURE_CARDS.map(f => (
              <div key={f.title} style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '12px 13px',
              }}>
                <div style={{ fontSize: 22, marginBottom: 6, lineHeight: 1 }}>{f.emoji}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.45 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Support */}
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <button onClick={() => setShowSupport(true)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', background: 'none', border: 'none',
            padding: '10px 0', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>🙋</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Hjælp og support</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Stil et spørgsmål eller se svar på ofte stillede spørgsmål</div>
            </div>
            <ChevronIcon />
          </button>
        </div>
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
  const [sendNu,       setSendNu]       = useState(false)
  const [forbrug,      setForbrug]      = useState(null)
  const [forbrugLoad,  setForbrugLoad]  = useState(false)
  const [selectedTilk, setSelectedTilk] = useState(null)
  const [fordelData,   setFordelData]   = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadForbrug() {
    setForbrugLoad(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/hold-sms-forbrug.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: hold.id }),
      })
      const data = await res.json()
      if (!data.error) { setForbrug(data) }
    } catch {}
    setForbrugLoad(false)
  }

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

  if (view === 'forbrug') {
    return (
      <div className="screen">
        <header style={{
          background: 'var(--green)', color: '#fff',
          paddingTop: 'max(13px, env(safe-area-inset-top))',
          paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button onClick={() => setView('liste')} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0',
          }}>‹</button>
          <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>SMS-forbrug</span>
        </header>
        <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {forbrugLoad && <div className="spinner" style={{ margin: '32px auto' }} />}
          {forbrug && (
            <>
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>Totalt</h3>
                <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
                  <span>SMS: <strong>{forbrug.total.sms}</strong></span>
                  <span>Mail: <strong>{forbrug.total.mail}</strong></span>
                  <span>Ca. kr.: <strong>{forbrug.total.kroner?.toFixed(2)}</strong></span>
                </div>
              </div>
              {forbrug.udsendelser.length === 0 ? (
                <div className="empty-state"><h3>Ingen udsendelser endnu</h3></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {forbrug.udsendelser.map((u, i) => (
                    <div key={i} style={{
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '12px 14px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{u.titel || '—'}</span>
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                          {u.channel === 'sms' ? 'SMS' : 'Mail'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                        {u.sentAt ? new Date(u.sentAt).toLocaleDateString('da-DK') : ''}
                        {u.channel === 'sms' && u.kroner != null ? ` · ca. ${u.kroner?.toFixed(2)} kr.` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {!forbrugLoad && !forbrug && (
            <button className="btn btn-primary" onClick={loadForbrug}>Hent forbrug</button>
          )}
        </main>
      </div>
    )
  }

  if (view === 'send-besked') {
    return (
      <SendBeskedScreen
        hold={hold}
        user={user}
        onBack={() => setView('liste')}
      />
    )
  }

  if (view === 'kontingent') {
    return <KontingentScreen hold={hold} user={user} onBack={() => setView('liste')} />
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
        onSaved={(id) => { setSelectedBev({ id }); setView('detalje'); setSendNu(!editBev); setEditBev(null); loadData(); }}
        onDeleted={() => { setView('liste'); setEditBev(null); setSelectedBev(null); loadData() }}
      />
    )
  }

  if (view === 'detalje' && selectedBev) {
    return (
      <BegivenhedDetailScreen
        begivenhedId={selectedBev.id}
        user={user}
        sendNu={sendNu}
        onSendNuHandled={() => setSendNu(false)}
        onBack={() => { setView('liste'); setSelectedBev(null); setSendNu(false) }}
        onEdit={bevMedDeltagere => { setEditBev(bevMedDeltagere); setView('form') }}
        onDeleted={() => { setView('liste'); setSelectedBev(null); loadData() }}
      />
    )
  }

  if (view === 'tilkendegivelse-liste') {
    return (
      <TilkendegivelseListeScreen
        hold={hold}
        user={user}
        onBack={() => setView('liste')}
        onNy={() => { setSelectedTilk(null); setView('tilkendegivelse-form') }}
        onOpen={t => { setSelectedTilk(t); setView('tilkendegivelse-detalje') }}
      />
    )
  }

  if (view === 'tilkendegivelse-form') {
    return (
      <TilkendegivelseFormScreen
        hold={hold}
        tilkendegivelse={selectedTilk}
        user={user}
        onBack={() => setView(selectedTilk ? 'tilkendegivelse-detalje' : 'tilkendegivelse-liste')}
        onSaved={t => { setSelectedTilk(t); setView('tilkendegivelse-detalje') }}
      />
    )
  }

  if (view === 'tilkendegivelse-detalje' && selectedTilk) {
    return (
      <TilkendegivelseDetailScreen
        tilkendegivelse={selectedTilk}
        hold={hold}
        user={user}
        onBack={() => setView('tilkendegivelse-liste')}
        onEdit={() => setView('tilkendegivelse-form')}
        onFordel={(data) => { setFordelData(data); setView('fordel') }}
        onDeleted={() => { setSelectedTilk(null); setView('tilkendegivelse-liste') }}
      />
    )
  }

  if (view === 'fordel' && fordelData) {
    return (
      <FordelScreen
        hold={hold}
        user={user}
        fordelData={fordelData}
        onBack={() => setView('tilkendegivelse-detalje')}
        onSendt={() => { setFordelData(null); setView('tilkendegivelse-liste') }}
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
        <button onClick={() => setView('kontingent')} style={{
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,.75)', cursor: 'pointer',
          fontSize: 13, fontWeight: 500,
        }}>Spillere</button>
        <button onClick={() => { setView('forbrug'); if (!forbrug) loadForbrug() }} style={{
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,.75)', cursor: 'pointer',
          fontSize: 13, fontWeight: 500,
        }}>Forbrug</button>
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {hold.afdeling && (
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>{hold.afdeling}</p>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" style={{ flex: 1 }}
            onClick={() => { setEditBev(null); setView('form') }}>
            + Opret begivenhed
          </button>
          <button className="btn btn-outline" style={{ flex: 1 }}
            onClick={() => setView('send-besked')}>
            ✉ Send besked
          </button>
        </div>
        <button className="btn btn-outline" style={{ width: '100%' }}
          onClick={() => setView('tilkendegivelse-liste')}>
          📊 Tilkendegivelse
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
  const [extraSpørgsmaalTekst, setExtraSpørgsmaalTekst] = useState(begivenhed?.extraSpørgsmaal?.tekst || '')
  const [svarfrist,            setSvarfrist]            = useState(begivenhed?.svarfrist || '')
  const [pamTidspunkt,         setPamTidspunkt]         = useState(begivenhed?.pamindelse?.tidspunkt?.slice(0, 16) || '')
  const [pamKanal,             setPamKanal]             = useState(begivenhed?.pamindelse?.kanal || 'mail')

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
          extraSpørgsmaal: extraSpørgsmaalTekst.trim()
            ? { tekst: extraSpørgsmaalTekst.trim(), type: 'ja_nej' }
            : null,
          svarfrist: svarfrist || null,
          pamindelse: (svarfrist && pamTidspunkt)
            ? { tidspunkt: pamTidspunkt, kanal: pamKanal }
            : null,
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

        <div className="form-field">
          <label className="form-label">
            Ekstra spørgsmål til forældrene <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(valgfri, ja/nej)</span>
          </label>
          <input className="form-input" type="text" value={extraSpørgsmaalTekst}
            onChange={e => setExtraSpørgsmaalTekst(e.target.value)}
            placeholder="fx Kan du køre?" />
        </div>

        <div className="form-field">
          <label className="form-label">
            Svarfrist <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(valgfri)</span>
          </label>
          <input className="form-input" type="date" value={svarfrist}
            onChange={e => { setSvarfrist(e.target.value); if (!e.target.value) setPamTidspunkt('') }} />
        </div>

        {svarfrist && (
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>Automatisk påmindelse</div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label className="form-label">
                Send påmindelse den <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(valgfri)</span>
              </label>
              <input className="form-input" type="datetime-local" value={pamTidspunkt}
                onChange={e => setPamTidspunkt(e.target.value)} />
            </div>
            {pamTidspunkt && (
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label className="form-label">Via</label>
                <select className="form-input" value={pamKanal} onChange={e => setPamKanal(e.target.value)}>
                  <option value="mail">Mail</option>
                  <option value="sms">SMS</option>
                  <option value="begge">Mail + SMS</option>
                </select>
              </div>
            )}
          </div>
        )}

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

function BegivenhedDetailScreen({ begivenhedId, user, onBack, onEdit, onDeleted, sendNu, onSendNuHandled }) {
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

  // Auto-åbn send-dialog ved ny oprettelse
  useEffect(() => {
    if (sendNu && !loading && data) {
      setShowSend(true)
      onSendNuHandled?.()
    }
  }, [sendNu, loading, data])


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
        <button onClick={loadDetalje} disabled={loading} style={{
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,.85)', cursor: 'pointer',
          fontSize: 13, fontWeight: 500,
        }}>↻ Opdater</button>
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
              <SendDialog
                antalUdtaget={udtaget.length}
                sending={sending}
                sendFejl={sendFejl}
                sendOk={sendOk}
                onSend={handleSend}
                onLuk={() => { setShowSend(false); setSendFejl(''); setSendOk(null) }}
              />
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
              {bev.svarfrist && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--surface)', borderRadius: 6, padding: '2px 7px', color: 'var(--text3)' }}>SVARFRIST</span>
                  {formatDato(bev.svarfrist)}
                </div>
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
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    {d.svar === 'kommer' && (
                      <span style={{ fontSize: 12, color: '#1a5c2a', fontWeight: 700 }}>Kommer ✓</span>
                    )}
                    {d.svar === 'kommer_ikke' && (
                      <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>Kommer ikke</span>
                    )}
                    {bev.extraSpørgsmaal && d.extraSvar && (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {bev.extraSpørgsmaal.tekst}: <strong>{d.extraSvar === 'ja' ? 'Ja' : 'Nej'}</strong>
                      </span>
                    )}
                  </div>
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

// ── SendDialog ────────────────────────────────────────────────────────────────

const KANALER = [
  { id: 'mail',  label: 'Mail',       icon: '✉️' },
  { id: 'sms',   label: 'SMS',        icon: '💬' },
  { id: 'begge', label: 'Mail + SMS', icon: '📣' },
]

function SendDialog({ antalUdtaget, sending, sendFejl, sendOk, onSend, onLuk }) {
  const [kanal, setKanal] = useState('mail')

  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
        Send til {antalUdtaget} udtagne
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        {KANALER.map(k => (
          <button key={k.id}
            onClick={() => setKanal(k.id)}
            style={{
              flex: 1, padding: '10px 6px',
              borderRadius: 10, border: '2px solid',
              borderColor: kanal === k.id ? 'var(--green)' : 'var(--border)',
              background: kanal === k.id ? 'var(--green-soft)' : 'var(--bg)',
              color: kanal === k.id ? 'var(--green)' : 'var(--text2)',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
            <span style={{ fontSize: 18 }}>{k.icon}</span>
            {k.label}
          </button>
        ))}
      </div>

      {sendFejl && <div className="error-box">{sendFejl}</div>}

      {sendOk ? (
        <div style={{
          background: 'var(--green-soft)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 12, fontSize: 13, color: 'var(--green)', fontWeight: 600,
        }}>
          Sendt til {sendOk.sendt}{sendOk.fejlet > 0 ? ` · ${sendOk.fejlet} fejlede` : ''} ✓
        </div>
      ) : (
        <button className="btn btn-primary"
          onClick={() => onSend(kanal)} disabled={sending || antalUdtaget === 0}>
          {sending ? 'Sender…' : `Send ${kanal === 'mail' ? 'mail' : kanal === 'sms' ? 'SMS' : 'mail + SMS'}`}
        </button>
      )}

      <button className="btn btn-ghost"
        style={{ textAlign: 'center', justifyContent: 'center' }}
        onClick={onLuk}>
        {sendOk ? 'Luk' : 'Annuller'}
      </button>
    </div>
  )
}

// ── SendBeskedScreen ──────────────────────────────────────────────────────────

function SendBeskedScreen({ hold, user, onBack }) {
  const [kanal,        setKanal]        = useState('mail')
  const [emne,         setEmne]         = useState('')
  const [besked,       setBesked]       = useState('')
  const [members,      setMembers]      = useState(null)
  const [membersLoad,  setMembersLoad]  = useState(true)
  const [extraEmails,  setExtraEmails]  = useState([])
  const [extraPhones,  setExtraPhones]  = useState([])
  const [newRecipient, setNewRecipient] = useState('')
  const [recipFejl,    setRecipFejl]    = useState('')
  const [sending,      setSending]      = useState(false)
  const [fejl,         setFejl]         = useState('')
  const [resultat,     setResultat]     = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const idToken = await user.getIdToken()
        const res  = await fetch('/api/hold-spillere.php', {
          method:  'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ holdId: hold.id }),
        })
        const data = await res.json()
        setMembers(Array.isArray(data) ? data : [])
      } catch { setMembers([]) }
      finally { setMembersLoad(false) }
    })()
  }, [])

  function addRecipient() {
    const v = newRecipient.trim()
    if (!v) return
    setRecipFejl('')
    if (kanal === 'mail') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        setRecipFejl('Ugyldig email-adresse.')
        return
      }
      if (!extraEmails.includes(v)) setExtraEmails(prev => [...prev, v])
    } else {
      const cleaned = v.replace(/[\s\-()]/g, '')
      if (!/^\+?\d{8,15}$/.test(cleaned)) {
        setRecipFejl('Ugyldigt nummer. Brug fx 12345678 eller +4512345678.')
        return
      }
      if (!extraPhones.includes(cleaned)) setExtraPhones(prev => [...prev, cleaned])
    }
    setNewRecipient('')
  }

  function removeExtra(type, val) {
    if (type === 'email') setExtraEmails(prev => prev.filter(e => e !== val))
    else                  setExtraPhones(prev => prev.filter(p => p !== val))
  }

  const extras        = kanal === 'mail' ? extraEmails : extraPhones
  const totalModtagere = (members?.length ?? 0) + extras.length
  const parts          = smsParts(besked)
  const kostPerStk     = (parts * 0.29).toFixed(2)
  const kostIAlt       = (parts * 0.29 * totalModtagere).toFixed(2)

  async function handleSend() {
    const b = besked.trim()
    const e = emne.trim()
    if (!b) { setFejl('Skriv en besked.'); return }
    if (kanal === 'mail' && !e) { setFejl('Udfyld emne til mailen.'); return }
    setSending(true); setFejl('')
    try {
      const idToken = await user.getIdToken()
      const res  = await fetch('/api/send-besked.php', {
        method:  'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          holdId: hold.id, kanal,
          emne: e, besked: b,
          extraEmails: kanal === 'mail' ? extraEmails : [],
          extraPhones: kanal === 'sms'  ? extraPhones : [],
        }),
      })
      const data = await res.json()
      if (data.ok) setResultat(data)
      else setFejl(data.error || 'Udsendelse fejlede')
    } catch { setFejl('Netværksfejl') }
    finally  { setSending(false) }
  }

  const hdrStyle = {
    background: 'var(--green)', color: '#fff',
    paddingTop: 'max(13px, env(safe-area-inset-top))',
    paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
    display: 'flex', alignItems: 'center', gap: 12,
  }
  const backBtn = {
    background: 'none', border: 'none', color: '#fff',
    cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0',
  }

  return (
    <div className="screen">
      <header style={hdrStyle}>
        <button onClick={onBack} style={backBtn}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>Send besked</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,.7)' }}>
          {hold.titel || `Hold ${hold.id}`}
        </span>
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {resultat ? (
          <>
            <div style={{
              background: 'var(--green-soft)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 28,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 32 }}>✓</span>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', margin: 0 }}>
                Sendt til {resultat.sendt} {kanal === 'sms' ? 'numre' : 'adresser'}
              </p>
              {resultat.fejlet > 0 && (
                <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>
                  {resultat.fejlet} kunne ikke leveres
                </p>
              )}
            </div>
            <button className="btn btn-primary" onClick={onBack}>Tilbage til holdet</button>
          </>
        ) : (
          <>
            {/* ── Kanal: kun Mail / SMS ─── */}
            <div style={{ display: 'flex', gap: 8 }}>
              {KANALER.filter(k => k.id !== 'begge').map(k => (
                <button key={k.id}
                  onClick={() => { setKanal(k.id); setNewRecipient(''); setRecipFejl('') }}
                  style={{
                    flex: 1, padding: '12px 8px', borderRadius: 10, border: '2px solid',
                    borderColor: kanal === k.id ? 'var(--green)' : 'var(--border)',
                    background:  kanal === k.id ? 'var(--green-soft)' : 'var(--bg)',
                    color:       kanal === k.id ? 'var(--green)' : 'var(--text2)',
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  }}>
                  <span style={{ fontSize: 22 }}>{k.icon}</span>
                  {k.label}
                </button>
              ))}
            </div>

            {/* ── Mail-felter ─── */}
            {kanal === 'mail' && (
              <>
                <div>
                  <label className="form-label">Emne</label>
                  <input className="form-input" type="text" value={emne}
                    onChange={e => setEmne(e.target.value)}
                    placeholder="Fx: Aflyst træning fredag d. 3. nov." />
                </div>
                <div>
                  <label className="form-label">Besked</label>
                  <textarea className="form-input" rows={6} value={besked}
                    onChange={e => setBesked(e.target.value)}
                    placeholder="Skriv din besked her…"
                    style={{ resize: 'vertical', minHeight: 120 }} />
                </div>
              </>
            )}

            {/* ── SMS-felt + omkostningsboks ─── */}
            {kanal === 'sms' && (
              <div>
                <label className="form-label">Besked</label>
                <textarea className="form-input" rows={4} value={besked}
                  onChange={e => setBesked(e.target.value)}
                  placeholder="Skriv din SMS-tekst her…"
                  style={{ resize: 'vertical', minHeight: 90 }} />
                <div style={{
                  marginTop: 8,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 14px',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13,
                }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', marginBottom: 2 }}>TEGN</div>
                    <div style={{ fontWeight: 700 }}>{besked.length || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', marginBottom: 2 }}>SMS-DELE PR. MODTAGER</div>
                    <div style={{ fontWeight: 700 }}>{parts}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', marginBottom: 2 }}>PRIS PR. MODTAGER</div>
                    <div style={{ fontWeight: 700 }}>ca. {kostPerStk} kr.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', marginBottom: 2 }}>SAMLET ({totalModtagere} modtagere)</div>
                    <div style={{ fontWeight: 700, color: totalModtagere > 0 ? 'var(--green)' : 'var(--text3)' }}>
                      ca. {kostIAlt} kr.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Modtagerliste ─── */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                Modtagere ({totalModtagere})
              </h3>

              {membersLoad && <div className="spinner" style={{ margin: '8px auto' }} />}

              {!membersLoad && members?.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>
                  Ingen registrerede holdmedlemmer i databasen.
                </p>
              )}

              {!membersLoad && members && members.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {members.map(m => (
                    <span key={m.id} style={{
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 20, padding: '4px 10px', fontSize: 13,
                    }}>
                      {m.navn}
                    </span>
                  ))}
                </div>
              )}

              {/* Ekstra modtagere (grøn baggrund) */}
              {extras.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {extras.map(r => (
                    <div key={r} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'var(--green-soft)', borderRadius: 8,
                      padding: '6px 10px',
                    }}>
                      <span style={{ flex: 1, fontSize: 13, wordBreak: 'break-all' }}>{r}</span>
                      <button onClick={() => removeExtra(kanal === 'mail' ? 'email' : 'phone', r)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 18, color: 'var(--text3)', lineHeight: 1, padding: 0, flexShrink: 0,
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input: tilføj ekstra */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  className="form-input"
                  style={{ margin: 0 }}
                  type={kanal === 'mail' ? 'email' : 'tel'}
                  value={newRecipient}
                  onChange={e => { setNewRecipient(e.target.value); setRecipFejl('') }}
                  onKeyDown={e => e.key === 'Enter' && addRecipient()}
                  placeholder={kanal === 'mail' ? 'Tilføj ekstra email-adresse…' : 'Tilføj ekstra telefonnummer…'}
                />
                <button className="btn btn-outline" onClick={addRecipient}>
                  + Tilføj
                </button>
              </div>
              {recipFejl && (
                <p style={{ fontSize: 12, color: 'var(--red)', margin: 0 }}>{recipFejl}</p>
              )}
            </div>

            {fejl && <div className="error-box">{fejl}</div>}

            <button className="btn btn-primary"
              onClick={handleSend}
              disabled={sending || !besked.trim() || (kanal === 'mail' && !emne.trim()) || totalModtagere === 0}>
              {sending
                ? 'Sender…'
                : `Send ${kanal === 'mail' ? 'mail' : 'SMS'} til ${totalModtagere} ${kanal === 'mail' ? 'adresser' : 'numre'}`}
            </button>
          </>
        )}
      </main>
    </div>
  )
}

// ── KontingentScreen ──────────────────────────────────────────────────────────

function KontingentScreen({ hold, user, onBack }) {
  const [spillere, setSpillere] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [fejl,     setFejl]     = useState('')

  useEffect(() => { hent() }, [])

  async function hent() {
    setLoading(true)
    setFejl('')
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
      } else {
        setFejl(data.error || 'Ukendt fejl')
      }
    } catch {
      setFejl('Netværksfejl')
    } finally {
      setLoading(false)
    }
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
          Spillere — {hold.titel || `Hold ${hold.id}`}
        </span>
        {spillere && (
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', fontWeight: 500 }}>
            {spillere.length} stk.
          </span>
        )}
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>
          Spillere tilmeldt holdet i Conventus (daglig sync). Tilmeldt = betalt kontingent.
        </p>

        {loading && <div className="spinner" style={{ margin: '32px auto' }} />}
        {fejl && <div className="error-box">{fejl}</div>}

        {spillere && spillere.length === 0 && (
          <div className="empty-state">
            <h3>Ingen spillere fundet</h3>
            <p>Holdet har ingen tilmeldte i Conventus.</p>
          </div>
        )}

        {spillere && spillere.length > 0 && (
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {spillere.map((s, i) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderBottom: i < spillere.length - 1 ? '1px solid var(--border)' : 'none',
                fontSize: 14,
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--green-soft)', color: 'var(--green)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, flexShrink: 0,
                }}>
                  {s.navn.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span style={{ flex: 1, fontWeight: 500 }}>{s.navn}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ── SupportScreen ─────────────────────────────────────────────────────────────

const SUPPORT_CATEGORIES = ['Login', 'Begivenheder', 'Udsendelse', 'Hold og spillere', 'Andet']

function SupportScreen({ user, onBack }) {
  const [faqs,     setFaqs]     = useState([])
  const [view,     setView]     = useState('oversigt') // 'oversigt' | 'form' | 'tak'
  const [kategori, setKategori] = useState(SUPPORT_CATEGORIES[0])
  const [besked,   setBesked]   = useState('')
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    getDocs(query(collection(db, 'support'), where('status', '==', 'faq'), orderBy('createdAt', 'desc')))
      .then(s => setFaqs(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  async function sendSpørgsmål() {
    if (!besked.trim()) return
    setSending(true); setError('')
    try {
      await addDoc(collection(db, 'support'), {
        question:   besked.trim(),
        category:   kategori,
        authorName: user.displayName || user.email || '',
        authorEmail: user.email || '',
        authorUid:  user.uid,
        status:     'afventer',
        createdAt:  serverTimestamp(),
        source:     'trainer-app',
      })
      setView('tak')
    } catch {
      setError('Det lykkedes ikke at sende. Prøv igen.')
    } finally {
      setSending(false)
    }
  }

  const Header = ({ title }) => (
    <header style={{
      background: 'var(--green)', color: '#fff',
      paddingTop: 'max(13px, env(safe-area-inset-top))',
      paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px 0 0' }}>‹</button>
      <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>{title}</span>
    </header>
  )

  if (view === 'tak') return (
    <div className="screen">
      <Header title="Hjælp og support" />
      <main style={{ padding: '40px 16px', maxWidth: 500, margin: '0 auto', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Spørgsmål modtaget</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 28 }}>
          Din besked er sendt til SSIF-administratoren. Du vil typisk få svar inden for 1–2 dage.
        </p>
        <button className="btn btn-primary" onClick={onBack} style={{ maxWidth: 220, margin: '0 auto' }}>
          Tilbage til appen
        </button>
      </main>
    </div>
  )

  if (view === 'form') return (
    <div className="screen">
      <Header title="Stil et spørgsmål" />
      <main style={{ padding: '20px 16px', maxWidth: 500, margin: '0 auto', width: '100%', flex: 1 }}>
        <button className="btn btn-ghost" style={{ marginBottom: 16, padding: '4px 0' }} onClick={() => setView('oversigt')}>← Tilbage</button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-field">
            <label className="form-label">Kategori</label>
            <select className="form-input" value={kategori} onChange={e => setKategori(e.target.value)}>
              {SUPPORT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Dit spørgsmål</label>
            <textarea className="form-input" rows={5} style={{ resize: 'vertical' }}
              placeholder="Beskriv hvad du har brug for hjælp til…"
              value={besked} onChange={e => setBesked(e.target.value)} />
          </div>
          {error && <p style={{ fontSize: 13, color: 'var(--red)', margin: 0 }}>{error}</p>}
          <button className="btn btn-primary" disabled={sending || !besked.trim()} onClick={sendSpørgsmål}>
            {sending ? 'Sender…' : 'Send spørgsmål'}
          </button>
        </div>
      </main>
    </div>
  )

  return (
    <div className="screen">
      <Header title="Hjælp og support" />
      <main style={{ padding: '20px 16px', maxWidth: 500, margin: '0 auto', width: '100%', flex: 1 }}>

        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 28 }} onClick={() => { setBesked(''); setView('form') }}>
          🙋 Stil et spørgsmål
        </button>

        {faqs.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Ofte stillede spørgsmål</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {faqs.map(faq => (
                <div key={faq.id} style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 12, overflow: 'hidden',
                }}>
                  <button onClick={() => setExpanded(expanded === faq.id ? null : faq.id)} style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  }}>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                      {faq.question}
                    </span>
                    <span style={{ fontSize: 18, color: 'var(--text3)', transform: expanded === faq.id ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>›</span>
                  </button>
                  {expanded === faq.id && faq.answer && (
                    <div style={{ padding: '0 14px 14px', fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, borderTop: '1px solid var(--border)' }}>
                      <div style={{ paddingTop: 12 }}>{faq.answer}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {faqs.length === 0 && (
          <p style={{ fontSize: 14, color: 'var(--text3)', textAlign: 'center', marginTop: 16 }}>
            Ingen FAQ-artikler endnu. Stil et spørgsmål, så svarer vi hurtigst muligt.
          </p>
        )}
      </main>
    </div>
  )
}

// ── TilkendegivelseListeScreen ────────────────────────────────────────────────

function TilkendegivelseListeScreen({ hold, user, onBack, onNy, onOpen }) {
  const [liste,   setListe]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const idToken = await user.getIdToken()
      const res  = await fetch('/api/tilkendegivelse-liste.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: hold.id }),
      })
      const data = await res.json()
      if (Array.isArray(data)) setListe(data)
      else setError(data.error || 'Fejl ved hentning')
    } catch { setError('Netværksfejl') }
    finally { setLoading(false) }
  }

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0' }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>Tilkendegivelser</span>
      </header>
      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button className="btn btn-primary" onClick={onNy}>+ Opret ny tilkendegivelse</button>
        {loading && <div className="spinner" style={{ margin: '32px auto' }} />}
        {error && <div className="error-box">{error}</div>}
        {!loading && !error && liste?.length === 0 && (
          <div className="empty-state">
            <h3>Ingen tilkendegivelser endnu</h3>
            <p>Opret en for at spørge holdet, hvornår de kan spille.</p>
          </div>
        )}
        {liste?.map(t => {
          const datoer = t.datoer || []
          const første = datoer[0]?.dato || ''
          const sidste = datoer[datoer.length - 1]?.dato || ''
          const datoBadge = datoer.length === 1
            ? formatDato(første)
            : `${formatDato(første)} → ${formatDato(sidste)}`
          const statusFarve = { kladde: '#888', udsendt: '#1a5c2a', lukket: '#666' }[t.status] || '#888'
          const statusLabel = { kladde: 'Kladde', udsendt: 'Udsendt', lukket: 'Lukket' }[t.status] || t.status
          return (
            <div key={t.id} className="bev-card" onClick={() => onOpen(t)}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>📊</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.titel}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{datoBadge}</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusFarve }}>{statusLabel}</span>
              </div>
              <ChevronIcon />
            </div>
          )
        })}
      </main>
    </div>
  )
}

// ── TilkendegivelseFormScreen ──────────────────────────────────────────────────

function TilkendegivelseFormScreen({ hold, tilkendegivelse, user, onBack, onSaved }) {
  const isEdit = tilkendegivelse !== null

  const [step,      setStep]      = useState(1)
  const [titel,     setTitel]     = useState(tilkendegivelse?.titel || '')
  const [besked,    setBesked]    = useState(tilkendegivelse?.besked || '')
  const [svarfrist, setSvarfrist] = useState(tilkendegivelse?.svarfrist || '')
  const [datoer,    setDatoer]    = useState(
    tilkendegivelse?.datoer?.length
      ? tilkendegivelse.datoer
      : [{ dato: '', tidspunkt: '', modetid: '', sted: '' }]
  )

  const [spillere,     setSpillere]     = useState(null)
  const [udtaget,      setUdtaget]      = useState({})
  const [spillereLoad, setSpillereLoad] = useState(false)
  const [spillereErr,  setSpillereErr]  = useState('')

  const [saving,    setSaving]    = useState(false)
  const [formError, setFormError] = useState('')

  async function loadSpillere() {
    if (spillere !== null) return
    setSpillereLoad(true); setSpillereErr('')
    try {
      const idToken = await user.getIdToken()
      const res  = await fetch('/api/hold-spillere.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: hold.id }),
      })
      const data = await res.json()
      if (Array.isArray(data)) {
        setSpillere(data)
        const u = {}
        data.forEach(s => {
          const existing = isEdit && tilkendegivelse?.deltagere
            ? tilkendegivelse.deltagere.find(d => d.id === s.id)
            : null
          u[s.id] = existing !== null && existing !== undefined ? true : true
        })
        setUdtaget(u)
      } else {
        setSpillereErr(data.error || 'Fejl')
      }
    } catch { setSpillereErr('Netværksfejl') }
    finally { setSpillereLoad(false) }
  }

  function addDato() {
    setDatoer(d => [...d, { dato: '', tidspunkt: '', modetid: '', sted: '' }])
  }

  function updateDato(i, field, value) {
    setDatoer(d => d.map((x, j) => j === i ? { ...x, [field]: value } : x))
  }

  function removeDato(i) {
    if (datoer.length === 1) return
    setDatoer(d => d.filter((_, j) => j !== i))
  }

  function goStep2() {
    if (!titel.trim()) { setFormError('Titel er påkrævet'); return }
    if (datoer.every(d => !d.dato)) { setFormError('Mindst én dato er påkrævet'); return }
    setFormError('')
    setStep(2)
    loadSpillere()
  }

  async function save() {
    const gyldige = datoer.filter(d => d.dato)
    if (!titel.trim() || gyldige.length === 0) { setFormError('Titel og mindst én dato er påkrævet'); return }
    const valgte = spillere ? spillere.filter(s => udtaget[s.id]) : []
    if (valgte.length === 0) { setFormError('Vælg mindst én spiller'); return }

    setSaving(true); setFormError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/tilkendegivelse-gem.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tilkendegivelseId: isEdit ? tilkendegivelse.id : null,
          holdId: hold.id,
          titel: titel.trim(),
          datoer: gyldige,
          besked: besked.trim(),
          svarfrist: svarfrist,
          deltagere: valgte.map(s => ({ id: s.id, navn: s.name || s.navn || '' })),
        }),
      })
      const data = await res.json()
      if (data.id) {
        onSaved({ id: data.id, titel: titel.trim(), datoer: gyldige, besked: besked.trim(), svarfrist, status: isEdit ? tilkendegivelse.status : 'kladde' })
      } else {
        setFormError(data.error || 'Gem fejlede')
      }
    } catch { setFormError('Netværksfejl') }
    finally { setSaving(false) }
  }

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={step === 1 ? onBack : () => setStep(1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0' }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>
          {isEdit ? 'Ret tilkendegivelse' : 'Ny tilkendegivelse'} ({step}/2)
        </span>
      </header>
      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {step === 1 && <>
          <div className="form-field">
            <label className="form-label">Titel *</label>
            <input className="form-input" value={titel} onChange={e => setTitel(e.target.value)}
              placeholder="fx Kan du spille november-weekender?" />
          </div>
          <div className="form-field">
            <label className="form-label">Besked til forældrene (valgfri)</label>
            <textarea className="form-input" rows={3} value={besked}
              onChange={e => setBesked(e.target.value)}
              placeholder="Yderligere information om disse datoer…"
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 15 }} />
          </div>
          <div className="form-field">
            <label className="form-label">Svarfrist (valgfri)</label>
            <input className="form-input" type="date" value={svarfrist}
              onChange={e => setSvarfrist(e.target.value)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <label className="form-label" style={{ margin: 0 }}>Datoer *</label>
            <button onClick={addDato} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 13, fontWeight: 700 }}>+ Tilføj dato</button>
          </div>
          {datoer.map((d, i) => (
            <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="form-input" type="date" value={d.dato}
                  onChange={e => updateDato(i, 'dato', e.target.value)}
                  style={{ flex: 1 }} />
                {datoer.length > 1 && (
                  <button onClick={() => removeDato(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="form-field" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Tidspunkt</label>
                  <input className="form-input" type="time" value={d.tidspunkt}
                    onChange={e => updateDato(i, 'tidspunkt', e.target.value)} style={{ padding: '8px 10px', fontSize: 14 }} />
                </div>
                <div className="form-field" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Mødetid</label>
                  <input className="form-input" type="time" value={d.modetid}
                    onChange={e => updateDato(i, 'modetid', e.target.value)} style={{ padding: '8px 10px', fontSize: 14 }} />
                </div>
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 11 }}>Sted</label>
                <input className="form-input" value={d.sted}
                  onChange={e => updateDato(i, 'sted', e.target.value)}
                  placeholder="fx Hjemmebane" style={{ fontSize: 14 }} />
              </div>
            </div>
          ))}

          {formError && <div className="error-box">{formError}</div>}
          <button className="btn btn-primary" onClick={goStep2}>Vælg spillere →</button>
        </>}

        {step === 2 && <>
          <p style={{ fontSize: 14, color: 'var(--text2)' }}>Vælg de spillere der skal modtage tilkendegivelsen:</p>
          {spillereLoad && <div className="spinner" style={{ margin: '32px auto' }} />}
          {spillereErr && <div className="error-box">{spillereErr}</div>}
          {spillere && <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <button className="btn btn-outline" style={{ flex: 1, fontSize: 13 }}
                onClick={() => { const u = {}; spillere.forEach(s => u[s.id] = true); setUdtaget(u) }}>
                Vælg alle
              </button>
              <button className="btn btn-outline" style={{ flex: 1, fontSize: 13 }}
                onClick={() => { const u = {}; spillere.forEach(s => u[s.id] = false); setUdtaget(u) }}>
                Fravælg alle
              </button>
            </div>
            {spillere.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--bg)', border: `1.5px solid ${udtaget[s.id] ? 'var(--green)' : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                transition: 'border-color .15s',
              }}>
                <input type="checkbox" checked={!!udtaget[s.id]}
                  onChange={e => setUdtaget(u => ({ ...u, [s.id]: e.target.checked }))}
                  style={{ accentColor: 'var(--green)', width: 18, height: 18 }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>{s.name || s.navn || s.id}</span>
              </label>
            ))}
          </>}

          {formError && <div className="error-box">{formError}</div>}
          <button className="btn btn-primary" onClick={save} disabled={saving || spillereLoad}>
            {saving ? 'Gemmer…' : isEdit ? 'Gem ændringer' : 'Opret tilkendegivelse'}
          </button>
        </>}

      </main>
    </div>
  )
}

// ── TilkendegivelseDetailScreen ───────────────────────────────────────────────

function TilkendegivelseDetailScreen({ tilkendegivelse, hold, user, onBack, onEdit, onFordel, onDeleted }) {
  const [detaljer,   setDetaljer]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [sendError,  setSendError]  = useState('')
  const [sendDone,   setSendDone]   = useState(null)
  const [showSend,   setShowSend]   = useState(false)
  const [kanal,      setKanal]      = useState('mail')
  const [deleting,   setDeleting]   = useState(false)
  const [showDel,    setShowDel]    = useState(false)

  useEffect(() => { load() }, [tilkendegivelse.id])

  async function load() {
    setLoading(true); setError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/tilkendegivelse-detalje.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tilkendegivelseId: tilkendegivelse.id, holdId: hold.id }),
      })
      const data = await res.json()
      if (data.tilkendegivelse) setDetaljer(data)
      else setError(data.error || 'Fejl ved hentning')
    } catch { setError('Netværksfejl') }
    finally { setLoading(false) }
  }

  async function sendUd() {
    setSending(true); setSendError(''); setSendDone(null)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/tilkendegivelse-send.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tilkendegivelseId: tilkendegivelse.id, holdId: hold.id, kanal }),
      })
      const data = await res.json()
      if (data.ok) {
        setSendDone(data)
        setShowSend(false)
        load()
      } else {
        setSendError(data.error || 'Udsendelse fejlede')
      }
    } catch { setSendError('Netværksfejl') }
    finally { setSending(false) }
  }

  async function slet() {
    setDeleting(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/tilkendegivelse-slet.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tilkendegivelseId: tilkendegivelse.id, holdId: hold.id }),
      })
      const data = await res.json()
      if (data.ok) onDeleted()
      else setError(data.error || 'Sletning fejlede')
    } catch { setError('Netværksfejl') }
    finally { setDeleting(false) }
  }

  const t   = detaljer?.tilkendegivelse
  const deltagere = detaljer?.deltagere || []
  const pivot     = detaljer?.pivot || []

  const statusLabel = { kladde: 'Kladde', udsendt: 'Udsendt', lukket: 'Lukket' }[t?.status] || t?.status

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0' }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 16, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tilkendegivelse.titel}
        </span>
        <button onClick={load} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.75)', cursor: 'pointer', fontSize: 13 }}>↻</button>
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && <div className="spinner" style={{ margin: '32px auto' }} />}
        {error && <div className="error-box">{error}</div>}

        {t && <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
              background: t.status === 'udsendt' ? '#e8f5ec' : '#f0f0f0',
              color: t.status === 'udsendt' ? 'var(--green)' : '#666' }}>
              {statusLabel}
            </span>
            {t.svarfrist && (
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Svarfrist: {formatDato(t.svarfrist)}</span>
            )}
          </div>

          {/* Handlingsknapper */}
          <div style={{ display: 'flex', gap: 8 }}>
            {t.status === 'kladde' && (
              <button className="btn btn-outline" style={{ flex: 1, fontSize: 13 }} onClick={onEdit}>✏ Ret</button>
            )}
            {(t.status === 'kladde' || t.status === 'udsendt') && (
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={() => setShowSend(true)}>
                📨 {t.status === 'udsendt' ? 'Send påmindelse' : 'Send ud'}
              </button>
            )}
          </div>

          {sendDone && (
            <div style={{ background: '#e8f5ec', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
              ✓ Sendt til {sendDone.sendt} {sendDone.fejlet > 0 ? `(${sendDone.fejlet} fejlede)` : ''}
            </div>
          )}

          {/* Send-dialog */}
          {showSend && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>Send tilkendegivelse ud</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {['mail', 'sms', 'begge'].map(k => (
                  <button key={k} onClick={() => setKanal(k)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid',
                    background: kanal === k ? 'var(--green)' : 'transparent',
                    borderColor: kanal === k ? 'var(--green)' : 'var(--border)',
                    color: kanal === k ? '#fff' : 'var(--text)', cursor: 'pointer',
                    fontSize: 13, fontWeight: 700,
                  }}>
                    {k === 'begge' ? 'Begge' : k === 'mail' ? 'Mail' : 'SMS'}
                  </button>
                ))}
              </div>
              {sendError && <div className="error-box">{sendError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowSend(false)}>Annullér</button>
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={sendUd} disabled={sending}>
                  {sending ? 'Sender…' : 'Send'}
                </button>
              </div>
            </div>
          )}

          {/* Svartabel - pivot */}
          {pivot.length > 0 && deltagere.length > 0 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                Svar ({deltagere.filter(d => d.harSvaret).length}/{deltagere.length} har svaret)
              </h3>

              {/* Dato-sammenfatning */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {pivot.map(p => (
                  <div key={p.dato} style={{
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '10px 14px',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{formatDato(p.dato)}</span>
                      {t.status === 'udsendt' && (
                        <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => onFordel({ tilkendegivelse: t, dato: p.dato, pivot: p, deltagere })}>
                          Fordel →
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ Kan: {p.kan.length}</span>
                      <span style={{ color: 'var(--red)', fontWeight: 700 }}>✗ Kan ikke: {p.kan_ikke.length}</span>
                      <span style={{ color: '#aaa' }}>? Intet svar: {p.ingen_svar.length}</span>
                    </div>
                    {p.kan.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {p.kan.join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Spillerpivot - horisontalt scroll */}
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 280 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '2px solid var(--border)' }}>Spiller</th>
                      {pivot.map(p => (
                        <th key={p.dato} style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '2px solid var(--border)', fontWeight: 600, color: 'var(--text2)', fontSize: 11 }}>
                          {formatDato(p.dato)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deltagere.map(d => (
                      <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{d.navn}</td>
                        {pivot.map(p => {
                          const s = d.svar[p.dato] || ''
                          return (
                            <td key={p.dato} style={{ padding: '6px 8px', textAlign: 'center' }}>
                              {s === 'kan' ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
                               : s === 'kan_ikke' ? <span style={{ color: 'var(--red)' }}>✗</span>
                               : <span style={{ color: '#ccc' }}>—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Slet */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            {!showDel && (
              <button onClick={() => setShowDel(true)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Slet tilkendegivelse
              </button>
            )}
            {showDel && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowDel(false)}>Annullér</button>
                <button className="btn btn-primary" style={{ flex: 1, background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={slet} disabled={deleting}>
                  {deleting ? 'Sletter…' : 'Bekræft slet'}
                </button>
              </div>
            )}
          </div>
        </>}
      </main>
    </div>
  )
}

// ── FordelScreen ───────────────────────────────────────────────────────────────

function FordelScreen({ hold, user, fordelData, onBack, onSendt }) {
  const { tilkendegivelse, dato, pivot, deltagere } = fordelData

  const kanSpille = pivot.kan || []

  const [kampe,     setKampe]     = useState([{ id: 1, titel: '', tidspunkt: '', modetid: '', sted: '', kræverSvar: false }])
  const [fordeling, setFordeling] = useState({})
  const [sending,   setSending]   = useState(false)
  const [sendError, setSendError] = useState('')
  const [kanal,     setKanal]     = useState('mail')
  const [nextId,    setNextId]    = useState(2)

  function addKamp() {
    setKampe(k => [...k, { id: nextId, titel: '', tidspunkt: '', modetid: '', sted: '', kræverSvar: false }])
    setNextId(n => n + 1)
  }

  function updateKamp(id, field, value) {
    setKampe(k => k.map(x => x.id === id ? { ...x, [field]: value } : x))
  }

  function removeKamp(id) {
    if (kampe.length === 1) return
    setKampe(k => k.filter(x => x.id !== id))
    setFordeling(f => {
      const nf = { ...f }
      Object.keys(nf).forEach(spillerId => { if (nf[spillerId] === id) delete nf[spillerId] })
      return nf
    })
  }

  function assignSpiller(spillerNavn, kampId) {
    setFordeling(f => ({ ...f, [spillerNavn]: kampId }))
  }

  const ufordelte = kanSpille.filter(navn => !fordeling[navn])
  const alleFordelt = kanSpille.length > 0 && ufordelte.length === 0

  // Byg spillerIds for hvert kamp fra deltagere array
  function getSpillerIds(kampId) {
    return kanSpille
      .filter(navn => fordeling[navn] === kampId)
      .map(navn => {
        const deltager = deltagere.find(d => d.navn === navn)
        return deltager ? deltager.id : null
      })
      .filter(Boolean)
  }

  function getSpillerNavne(kampId) {
    const navneMap = {}
    kanSpille
      .filter(navn => fordeling[navn] === kampId)
      .forEach(navn => {
        const deltager = deltagere.find(d => d.navn === navn)
        if (deltager) navneMap[deltager.id] = deltager.navn
      })
    return navneMap
  }

  async function sendKampe() {
    const ugyldige = kampe.filter(k => !k.titel.trim())
    if (ugyldige.length > 0) { setSendError('Alle kampe skal have en titel'); return }
    if (!alleFordelt) { setSendError('Alle spillere skal fordeles'); return }

    const kampeData = kampe.map(k => ({
      titel:         k.titel.trim(),
      tidspunkt:     k.tidspunkt,
      modetid:       k.modetid,
      sted:          k.sted,
      kræverSvar:    k.kræverSvar,
      spillerIds:    getSpillerIds(k.id),
      spillerNavne:  getSpillerNavne(k.id),
    })).filter(k => k.spillerIds.length > 0)

    if (kampeData.length === 0) { setSendError('Mindst én kamp skal have spillere'); return }

    setSending(true); setSendError('')
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/tilkendegivelse-opret-kampe.php', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tilkendegivelseId: tilkendegivelse.id,
          holdId: hold.id,
          dato,
          kanal,
          kampe: kampeData,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        onSendt()
      } else {
        setSendError(data.error || 'Udsendelse fejlede')
      }
    } catch { setSendError('Netværksfejl') }
    finally { setSending(false) }
  }

  return (
    <div className="screen">
      <header style={{
        background: 'var(--green)', color: '#fff',
        paddingTop: 'max(13px, env(safe-area-inset-top))',
        paddingBottom: '13px', paddingLeft: '18px', paddingRight: '18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px 0 0' }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 17, flex: 1 }}>Fordel spillere</span>
      </header>

      <main style={{ padding: '16px', maxWidth: 600, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 14, color: 'var(--text2)', fontWeight: 600 }}>
          📅 {formatDato(dato)} · {kanSpille.length} spillere siger kan
        </p>

        {/* Kampe */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700 }}>Kampe ({kampe.length})</h3>
          <button onClick={addKamp} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 13, fontWeight: 700 }}>+ Tilføj kamp</button>
        </div>

        {kampe.map(k => (
          <div key={k.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="form-input" value={k.titel} placeholder="Kamp-navn, fx Pulje A"
                onChange={e => updateKamp(k.id, 'titel', e.target.value)}
                style={{ flex: 1 }} />
              {kampe.length > 1 && (
                <button onClick={() => removeKamp(k.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 18 }}>×</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input className="form-input" type="time" value={k.tidspunkt} placeholder="Tidspunkt"
                onChange={e => updateKamp(k.id, 'tidspunkt', e.target.value)} style={{ fontSize: 14, padding: '8px 10px' }} />
              <input className="form-input" type="time" value={k.modetid} placeholder="Mødetid"
                onChange={e => updateKamp(k.id, 'modetid', e.target.value)} style={{ fontSize: 14, padding: '8px 10px' }} />
            </div>
            <input className="form-input" value={k.sted} placeholder="Sted"
              onChange={e => updateKamp(k.id, 'sted', e.target.value)} style={{ fontSize: 14 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={k.kræverSvar}
                onChange={e => updateKamp(k.id, 'kræverSvar', e.target.checked)}
                style={{ accentColor: 'var(--green)', width: 16, height: 16 }} />
              Forældrene skal bekræfte igen
            </label>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              {kanSpille.filter(n => fordeling[n] === k.id).length} spillere tildelt
            </div>
          </div>
        ))}

        {/* Fordeling af spillere */}
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Fordel spillerne</h3>
        {kanSpille.length === 0 ? (
          <div className="empty-state"><h3>Ingen spillere siger kan denne dato</h3></div>
        ) : (
          kanSpille.map(navn => (
            <div key={navn} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 12px',
            }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{navn}</span>
              <select
                value={fordeling[navn] || ''}
                onChange={e => assignSpiller(navn, e.target.value ? parseInt(e.target.value) : '')}
                style={{
                  border: '1.5px solid var(--border)', borderRadius: 8,
                  padding: '6px 8px', fontSize: 13, background: 'var(--card)',
                  color: fordeling[navn] ? 'var(--text)' : 'var(--text3)',
                  cursor: 'pointer',
                }}
              >
                <option value="">— Ikke tildelt —</option>
                {kampe.map(k => (
                  <option key={k.id} value={k.id}>{k.titel || `Kamp ${k.id}`}</option>
                ))}
              </select>
            </div>
          ))
        )}

        {ufordelte.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600 }}>
            ⚠ {ufordelte.length} spiller{ufordelte.length === 1 ? '' : 'e'} er ikke fordelt endnu
          </div>
        )}

        {/* Udsendelse */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {['mail', 'sms', 'begge'].map(k => (
            <button key={k} onClick={() => setKanal(k)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid',
              background: kanal === k ? 'var(--green)' : 'transparent',
              borderColor: kanal === k ? 'var(--green)' : 'var(--border)',
              color: kanal === k ? '#fff' : 'var(--text)', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
            }}>
              {k === 'begge' ? 'Begge' : k === 'mail' ? 'Mail' : 'SMS'}
            </button>
          ))}
        </div>

        {sendError && <div className="error-box">{sendError}</div>}
        <button className="btn btn-primary" onClick={sendKampe}
          disabled={sending}>
          {sending ? 'Sender…' : `Send ${kampe.length} kamp${kampe.length === 1 ? '' : 'e'}`}
        </button>
      </main>
    </div>
  )
}

// ── Hjælpere og ikoner ────────────────────────────────────────────────────────

function smsParts(text) {
  if (!text) return 1
  const gsm7 = new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜäöñüàÅ§¿abcdefghijklmnopqrstuvwxyz\t\x0b\x0c{}\\[~]|^€'])
  const ucs2 = [...text].some(c => !gsm7.has(c))
  const len  = [...text].length
  if (ucs2) return len <= 70  ? 1 : Math.ceil(len / 67)
  return          len <= 160 ? 1 : Math.ceil(len / 153)
}

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
