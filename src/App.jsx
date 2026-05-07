import { useState, useRef, useEffect } from 'react'
import './App.css'
import { auth, db } from './firebase.js'
import {
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut, onAuthStateChanged,
} from 'firebase/auth'
import {
  collection, query, orderBy, onSnapshot,
  addDoc, serverTimestamp, limit,
  doc, getDoc, setDoc,
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
    logout:   <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    star:     <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
         style={{ display: 'block', flexShrink: 0 }}>
      {paths[name]}
    </svg>
  )
}

// ─── Dummy Data (fallback) ────────────────────────────────────────────────────

const DEMO_USER = {
  name: 'Lars Thomsen',
  firstName: 'Lars',
  email: 'lars@demo.dk',
  team: 'Herrer A',
  role: 'Spiller',
  memberId: 'DM-1234',
  initials: 'LT',
  isDemo: true,
}

const TEAMS = [
  { id: 1, name: 'U6',      category: 'Ungdom', members: 14, coach: 'Lars Jensen',          coachPhone: '50 12 34 56', nextMatch: 'Lør 10. maj · 09:00 · Hjemmebane',           record: [5,1,0], players: ['Sofie M.','Oliver B.','Emma K.','Noah P.','Ida L.','Magnus T.','Freja H.','Victor S.','Mathilde N.','Albert C.','Astrid R.','Mikkel J.','Nanna W.','Emil D.'] },
  { id: 2, name: 'U8',      category: 'Ungdom', members: 16, coach: 'Maria Christensen',    coachPhone: '40 23 45 67', nextMatch: 'Søn 11. maj · 10:00 · Balle IF (ude)',         record: [5,0,1], players: ['Lukas A.','Clara B.','Benjamin F.','Amalie G.','Sebastian H.','Isabella I.','Tobias J.','Caroline K.','Elias L.','Maja M.','Oskar N.','Silje O.','Adam P.','Lærke Q.','Frederik R.','Alma S.'] },
  { id: 3, name: 'U10',     category: 'Ungdom', members: 18, coach: 'Søren Andersen',       coachPhone: '30 34 56 78', nextMatch: 'Lør 10. maj · 11:00 · Silkeborg BK (hjemme)', record: [4,2,1], players: ['Emil H.','Mia C.','Johan K.','Nora P.','Marcus L.','Sofia B.','Anton G.','Frida T.','Nikolaj S.','Vera N.','Rasmus V.','Lotte W.','Kasper Y.','Stella Z.','Patrick A.','Luna B.','Felix C.','Rosa D.'] },
  { id: 4, name: 'U12',     category: 'Ungdom', members: 20, coach: 'Peter Nielsen',        coachPhone: '20 45 67 89', nextMatch: 'Ons 14. maj · 17:00 · Kjellerup IF (ude)',    record: [6,1,2], players: ['Lucas M.','Sara P.','Mikkel R.','Anna S.','Daniel T.','Maria U.','Christian V.','Line W.','Simon X.','Julie Y.','Jakob Z.','Pernille A.','Andreas B.','Camilla C.','Mathias D.','Trine E.','Oliver F.','Katrine G.','Noah H.','Sofie I.'] },
  { id: 5, name: 'U14',     category: 'Ungdom', members: 17, coach: 'Thomas Hansen',        coachPhone: '61 56 78 90', nextMatch: 'Tir 13. maj · 17:30 · FKSS (ude)',            record: [4,3,2], players: ['Victor L.','Josefine M.','Alexander N.','Cecilie O.','William P.','Emilie Q.','Mads R.','Maja S.','Filip T.','Klara U.','Jeppe V.','Nanna W.','Nicolai X.','Helena Y.','Lasse Z.','Ida A.','Benjamin B.'] },
  { id: 6, name: 'U16',     category: 'Ungdom', members: 15, coach: 'Mette Larsen',         coachPhone: '71 67 89 01', nextMatch: 'Søn 12. maj · 11:00 · Ikast fBK (hjemme)',   record: [7,1,0], players: ['Marcus L.','Freja M.','Tobias N.','Alberte O.','Jonas P.','Katrine Q.','Rasmus R.','Sofie S.','Christian T.','Maja U.','Oliver V.','Cecilie W.','Andreas X.','Trine Y.','Mikkel Z.'] },
  { id: 7, name: 'Herrer A',category: 'Senior', members: 22, coach: 'Ole Svendsen',         coachPhone: '81 78 90 12', nextMatch: 'Søn 11. maj · 14:00 · Ans IF (ude)',          record: [8,2,2], players: ['Mads Nielsen','Jonas Pedersen','Henrik Christiansen','Lars Thomsen','Kasper Madsen','Jesper Rasmussen','Søren Lund','Thomas Bjerregaard','Anders Koch','Michael Vestergaard','Poul Holm','Brian Kjær','Niels Steffensen','Henrik Dahl','Claus Møller','Jens Olsen','Martin Falk','Rune Berg','Erik Nygaard','Bo Kristensen','Per Andersen','Kim Paulsen'] },
  { id: 8, name: 'Herrer B',category: 'Senior', members: 18, coach: 'Mikkel Pedersen',      coachPhone: '91 89 01 23', nextMatch: 'Søn 12. maj · 13:00 · Balle IF (ude)',        record: [5,4,3], players: ['Peter Skov','Lasse Hansen','Carsten Berg','Ole Poulsen','René Christoffersen','Frank Jensen','Johnny Madsen','Allan Larsen','Bent Nielsen','Kurt Thomsen','Finn Andersen','Stig Pedersen','Preben Koch','Vagn Mortensen','Henrik Sørensen','Bjarne Olsen','Jørgen Mikkelsen','Peder Christensen'] },
  { id: 9, name: 'Damer',   category: 'Senior', members: 16, coach: 'Anne-Mette Sørensen', coachPhone: '42 90 12 34', nextMatch: 'Ons 14. maj · 18:00 · Them IF (ude)',         record: [6,2,1], players: ['Rikke H.','Louise B.','Stine K.','Mette P.','Helle L.','Sanne T.','Pia J.','Dorte S.','Gitte N.','Tina W.','Kirsten V.','Susanne M.','Birgit R.','Anni C.','Lone D.','Anette F.'] },
]

const NEWS_FALLBACK = [
  {
    id: '1', category: 'Kamp', categoryColor: '#1a5c2a',
    title: 'Storsejer til Herrer A – 4-1 over Balle IF',
    date: '5. maj 2026',
    excerpt: 'Herrer A leverede en fremragende præstation og vandt overbevisende 4-1. Mål af Nielsen (2), Pedersen og Christiansen.',
    body: `Herrer A leverede søndag en fremragende præstation i hjemmekampen mod Balle IF og vandt overbevisende 4-1.\n\nKampen var afgjort allerede til pause, hvor SSIF førte 3-0 takket være to flotte mål fra Mads Nielsen samt et hårdt skud fra Jonas Pedersen.\n\nI anden halvleg satte Henrik Christiansen det endelige punktum til 4-0 inden Balle IF fik ærestreffen med ti minutter igen.\n\n– Det var en rigtig god holdpræstation. Alle trak i samme retning fra første til sidste fløjt, siger træner Ole Svendsen.\n\nNæste kamp er på udebane mod Ans IF søndag den 11. maj kl. 14:00.`,
  },
  {
    id: '2', category: 'Klubnyt', categoryColor: '#5856d6',
    title: 'Generalforsamling afholdt – ny bestyrelse valgt',
    date: '28. apr 2026',
    excerpt: 'SSIF afholdt sin årlige generalforsamling med rekorddeltagelse. Kasper Mikkelsen blev valgt som ny næstformand.',
    body: `Sejs-Svejbæk IF afholdt mandag aften sin ordinære generalforsamling i klubhuset med rekorddeltagelse på 87 medlemmer.\n\nKasper Mikkelsen blev valgt som ny næstformand efter Peter Kjærsgaard, som valgte at træde tilbage efter seks år. Den øvrige bestyrelse fortsætter uændret.\n\nRegnskabet for 2025 blev godkendt med et lille overskud på 12.400 kr., og der er fortsat god økonomi i klubben.\n\nDer blev desuden besluttet at investere i nye drakter til U12-holdet samt renovere omklædningsrummene til næste sæson.\n\nFormand Henrik Dahl takkede alle frivillige for den store indsats i 2025.`,
  },
  {
    id: '3', category: 'Ungdom', categoryColor: '#ff9500',
    title: 'U10 vinder årets venskabsturnering i Silkeborg',
    date: '25. apr 2026',
    excerpt: 'Vores U10-hold havde en fantastisk dag i Silkeborg og vandt venskabsturneringen med 4 sejre og én uafgjort.',
    body: `SSIF U10 rejste lørdag til Silkeborg og kom hjem med guldmedaljer fra årets venskabsturnering!\n\nHoldet spillede fem kampe, vandt fire og spillede én uafgjort med to af de bedste hold i rækken. Top-scorer var Emil Hansen med seks mål på dagen.\n\n– Drengene var fantastiske. De spillede teknisk flot fodbold og var mentalt stærke i alle fem kampe. Jeg er så stolt af dem, siger træner Søren Andersen.\n\nHoldet fejrer sejren med pizza og præmieuddeling i klubhuset fredag aften kl. 18:00. Forældre er meget velkomne!`,
  },
  {
    id: '4', category: 'Arrangement', categoryColor: '#ff3b30',
    title: 'Sommerfest den 21. juni – alle er velkomne!',
    date: '20. apr 2026',
    excerpt: 'Sæt allerede nu kryds i kalenderen! Den 21. juni holder vi stor sommerfest med BBQ, musik og sjove aktiviteter.',
    body: `Kære SSIF-familie!\n\nDen 21. juni 2026 fra kl. 15:00 holder vi årets sommerfest på anlægget. Alle medlemmer, forældre og venner af klubben er velkomne.\n\nPå programmet:\n• BBQ og kolde drikkevarer (tilskud fra klubkassen)\n• Live-musik fra kl. 17\n• Fodboldgolf og aktiviteter for børn\n• Præmieuddeling for sæsonen\n• Hyggelig samvær\n\nTilmelding er ikke nødvendig – mød bare op! Vi glæder os til at se jer alle!`,
  },
  {
    id: '5', category: 'Frivillige', categoryColor: '#34c759',
    title: 'Tak til alle frivillige på sæsonens første banedag',
    date: '12. apr 2026',
    excerpt: 'Over 30 frivillige mødte op og fik anlægget klar til sæsonen. En kæmpe tak til alle der hjalp!',
    body: `Lørdag den 12. april var der stormøde på SSIF's anlæg, og over 30 frivillige mødte op for at gøre klar til sæsonstart.\n\nOpgaverne var mange: slå græs, male linjer, sætte mål op, rydde op i redskabsskur og male omklædningsrum.\n\nAlle opgaver blev løst på rekordtid, og allerede kl. 14 var anlægget klar til brug.\n\n– Det er fantastisk at se, hvordan vores frivillige møder op og lægger et kæmpe arbejde. Det er dem, der gør SSIF til det, det er, siger formand Henrik Dahl.`,
  },
]

const CONVERSATIONS_FALLBACK = [
  {
    id: 'conv-1', name: 'Herrer A – Holdsnak', avatar: 'HA', avatarColor: '#1a5c2a', isGroup: true,
    lastMessage: 'Ole: Husk træning i morgen kl. 18:30! Vi ses på banen 💪', time: '14:22', unread: 3,
    messages: [
      { id: 'm1', sender: 'Ole Svendsen',   text: 'God kamp i søndags drenge! Stolt af jer alle 🙌',           time: '10:15', isMe: false },
      { id: 'm2', sender: 'Mads Nielsen',   text: 'Tak for det! Det var en fed dag',                            time: '10:32', isMe: false },
      { id: 'm3', sender: 'Mig',            text: 'Ja super kamp. Glæder mig til næste 🔥',                     time: '10:45', isMe: true  },
      { id: 'm4', sender: 'Jonas Pedersen', text: 'Hvornår spiller vi Ans IF?',                                 time: '11:20', isMe: false },
      { id: 'm5', sender: 'Ole Svendsen',   text: 'Søndag kl. 14:00. Vi kører samlet fra klubhuset kl. 12:30', time: '11:25', isMe: false },
      { id: 'm6', sender: 'Mads Nielsen',   text: 'Perfekt, jeg er med 👍',                                     time: '11:40', isMe: false },
      { id: 'm7', sender: 'Ole Svendsen',   text: 'Husk træning i morgen kl. 18:30! Vi ses på banen 💪',       time: '14:22', isMe: false },
    ],
  },
  {
    id: 'conv-2', name: 'Peter Hansen', avatar: 'PH', avatarColor: '#5856d6', isGroup: false,
    lastMessage: 'Dig: Tak! Vi ses fredag 👍', time: 'I går', unread: 0,
    messages: [
      { id: 'm1', sender: 'Peter Hansen', text: 'Hej Lars! Kan du hjælpe med at sætte porte op fredag?', time: '09:00', isMe: false },
      { id: 'm2', sender: 'Mig',          text: 'Ja det kan jeg godt! Hvad tid?',                        time: '09:15', isMe: true  },
      { id: 'm3', sender: 'Peter Hansen', text: 'Fra kl. 15. Vi er 3-4 stykker i gang',                  time: '09:18', isMe: false },
      { id: 'm4', sender: 'Mig',          text: 'Tak! Vi ses fredag 👍',                                 time: '09:20', isMe: true  },
    ],
  },
  {
    id: 'conv-3', name: 'Bestyrelsen', avatar: 'B', avatarColor: '#ff9500', isGroup: true,
    lastMessage: 'Kasper: Dagsordenen til næste møde er sendt ud på mail', time: 'Man', unread: 1,
    messages: [
      { id: 'm1', sender: 'Kasper Mikkelsen', text: 'Hej alle. Næste bestyrelsesmøde er 15. maj kl. 19 i klubhuset', time: 'Man 18:30', isMe: false },
      { id: 'm2', sender: 'Mig',              text: 'Fin. Jeg er med 👍',                                             time: 'Man 18:45', isMe: true  },
      { id: 'm3', sender: 'Henrik Dahl',      text: 'Godt. Jeg sætter sommerfest på dagsordenen',                    time: 'Man 18:50', isMe: false },
      { id: 'm4', sender: 'Kasper Mikkelsen', text: 'Dagsordenen til næste møde er sendt ud på mail',                time: 'Man 19:00', isMe: false },
    ],
  },
  {
    id: 'conv-4', name: 'Frivillige – Banehold', avatar: 'BH', avatarColor: '#34c759', isGroup: true,
    lastMessage: 'Lars: Banen er klar til weekenden ✅', time: 'Søn', unread: 0,
    messages: [
      { id: 'm1', sender: 'Lars Jensen', text: 'Hvem kan hjælpe med at slå græs lørdag formiddag?', time: 'Søn 09:00', isMe: false },
      { id: 'm2', sender: 'Mig',         text: 'Jeg kan fra kl. 10',                                 time: 'Søn 09:30', isMe: true  },
      { id: 'm3', sender: 'Lars Jensen', text: 'Perfekt, tak! Mødes ved skuret',                     time: 'Søn 09:35', isMe: false },
      { id: 'm4', sender: 'Lars Jensen', text: 'Banen er klar til weekenden ✅',                      time: 'Søn 14:00', isMe: false },
    ],
  },
]

const MATCHES = [
  { id: 1, team: 'Herrer A', opponent: 'Ans IF',       date: 'Søn 11. maj', time: '14:00', isHome: false },
  { id: 2, team: 'U10',      opponent: 'Silkeborg BK', date: 'Lør 10. maj', time: '11:00', isHome: true  },
  { id: 3, team: 'U16',      opponent: 'Ikast fBK',    date: 'Søn 12. maj', time: '11:00', isHome: true  },
  { id: 4, team: 'Herrer B', opponent: 'Balle IF',     date: 'Søn 12. maj', time: '13:00', isHome: false },
  { id: 5, team: 'Damer',    opponent: 'Them IF',      date: 'Ons 14. maj', time: '18:00', isHome: false },
]

// ─── Firebase config ──────────────────────────────────────────────────────────

const ACTION_CODE_SETTINGS = {
  url: 'https://app.sejssvejbaek-if.dk',
  handleCodeInApp: true,
}

const LS_EMAIL_KEY = 'ssif_email_for_signin'

// ─── Firebase error codes → Danish messages ──────────────────────────────────

const AUTH_ERRORS = {
  'auth/user-not-found':           'Ingen bruger med denne email.',
  'auth/invalid-email':            'Ugyldig email-adresse.',
  'auth/invalid-credential':       'Forkert email eller adgangskode.',
  'auth/too-many-requests':        'For mange forsøg. Prøv igen om lidt.',
  'auth/user-disabled':            'Denne konto er deaktiveret.',
  'auth/network-request-failed':   'Ingen netværksforbindelse.',
  'auth/invalid-action-code':      'Linket er ugyldigt. Anmod om et nyt.',
  'auth/expired-action-code':      'Linket er udløbet. Anmod om et nyt.',
  'auth/invalid-email-link':       'Ugyldigt login-link.',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Avatar({ initials, color = '#1a5c2a', size = 40 }) {
  return (
    <div className="avatar" style={{ width: size, height: size, borderRadius: size / 2, background: color, fontSize: size * 0.36 }}>
      {initials}
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
      <div className="splash-logo">SSIF</div>
      <div className="spinner spinner--white" />
      {label && <p className="splash-label">{label}</p>}
    </div>
  )
}

// ─── Login (Magic Link) ───────────────────────────────────────────────────────

function LoginScreen({ onDemoLogin, initialError }) {
  const [email, setEmail] = useState(localStorage.getItem(LS_EMAIL_KEY) || '')
  const [phase, setPhase] = useState(initialError ? 'error' : 'idle')
  // phase: 'idle' | 'sending' | 'sent' | 'error'
  const [error, setError] = useState(initialError || '')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email) { setError('Indtast din email'); setPhase('error'); return }
    setPhase('sending')
    setError('')
    try {
      await sendSignInLinkToEmail(auth, email, ACTION_CODE_SETTINGS)
      localStorage.setItem(LS_EMAIL_KEY, email)
      setPhase('sent')
    } catch (err) {
      setError(AUTH_ERRORS[err.code] || 'Kunne ikke sende link. Prøv igen.')
      setPhase('error')
    }
  }

  // ── Sent confirmation ────────────────────────────────────────────────────
  if (phase === 'sent') {
    return (
      <div className="login-screen">
        <div className="magic-sent">
          <div className="magic-sent-icon">
            <Icon name="mail" size={40} color="var(--green)" />
          </div>
          <h2 className="magic-sent-title">Tjek din email!</h2>
          <p className="magic-sent-body">
            Vi har sendt et login-link til
          </p>
          <p className="magic-sent-email">{email}</p>
          <p className="magic-sent-hint">
            Klik linket i emailen for at logge ind.
            Linket er gyldigt i 1 time.
          </p>
          <a className="btn btn-primary btn-full" href="mailto:">
            Åbn mail-app
          </a>
          <button
            className="magic-resend"
            onClick={() => { setPhase('idle'); setError('') }}
          >
            Ikke modtaget? Send nyt link
          </button>
        </div>
      </div>
    )
  }

  // ── Email input ──────────────────────────────────────────────────────────
  return (
    <div className="login-screen">
      <div className="login-top">
        <div className="login-logo"><span>SSIF</span></div>
        <h1 className="login-club">Sejs-Svejbæk IF</h1>
        <p className="login-subtitle">Log ind uden adgangskode</p>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <div className="input-row">
            <span className="input-icon"><Icon name="mail" size={18} color="var(--text3)" /></span>
            <input
              className="input-field"
              type="email"
              placeholder="Din email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={e => { setEmail(e.target.value); setPhase('idle'); setError('') }}
            />
          </div>
        </div>

        {error && <p className="login-error">{error}</p>}

        <button className="btn btn-primary btn-full" type="submit" disabled={phase === 'sending'}>
          {phase === 'sending'
            ? <span className="spinner" />
            : <><Icon name="mail" size={17} color="white" sw={2} />&nbsp; Send magic link</>
          }
        </button>

        <div className="login-divider"><span>eller</span></div>

        <button className="btn btn-secondary btn-full" type="button" onClick={onDemoLogin}>
          Demo adgang
        </button>
      </form>

      <p className="login-hint">
        Vi sender et link til din email – ingen adgangskode nødvendig
      </p>
    </div>
  )
}

// ─── Needs-email screen (magic link åbnet på anden enhed) ────────────────────

function NeedsEmailScreen({ onSubmit, onCancel }) {
  const [email, setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email) { setError('Indtast din email'); return }
    setLoading(true)
    setError('')
    try {
      await onSubmit(email)
    } catch (err) {
      setError(AUTH_ERRORS[err.code] || 'Ugyldigt link. Anmod om et nyt.')
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-top">
        <div className="login-logo"><span>SSIF</span></div>
        <h1 className="login-club" style={{ fontSize: 20 }}>Bekræft din email</h1>
        <p className="login-subtitle">
          Du åbnede linket på en ny enhed.{'\n'}
          Bekræft din email for at logge ind.
        </p>
      </div>
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <div className="input-row">
            <span className="input-icon"><Icon name="mail" size={18} color="var(--text3)" /></span>
            <input className="input-field" type="email" placeholder="Din email" autoComplete="email" autoFocus
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : 'Log ind'}
        </button>
        <button className="btn btn-secondary btn-full" type="button" onClick={onCancel}>
          Annuller
        </button>
      </form>
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
          : <span className="header-logo">SSIF</span>
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
    { id: 'dashboard', label: 'Hjem',     icon: 'home'    },
    { id: 'teams',     label: 'Hold',     icon: 'users'   },
    { id: 'news',      label: 'Nyheder',  icon: 'news'    },
    { id: 'messages',  label: 'Beskeder', icon: 'message' },
  ]
  return (
    <nav className="tab-bar">
      {tabs.map(tab => (
        <button key={tab.id}
          className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}>
          <span className="tab-icon-wrap">
            <Icon name={tab.icon} size={24}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardScreen({ user, conversations, news, onNavigate }) {
  const totalUnread = conversations.reduce((s, c) => s + (c.unread || 0), 0)

  return (
    <div className="screen">
      <div className="dashboard-greeting">
        <div>
          <p className="greeting-sub">God dag</p>
          <h2 className="greeting-name">{user.firstName || user.name} 👋</h2>
        </div>
        <Avatar initials={user.initials || user.name.slice(0, 2).toUpperCase()} size={44} />
      </div>

      <div className="stat-row">
        <div className="stat-card" onClick={() => onNavigate('teams')}>
          <Icon name="calendar" size={22} color="var(--green)" />
          <p className="stat-value">Søn 11.</p>
          <p className="stat-label">Næste kamp</p>
        </div>
        <div className="stat-card" onClick={() => onNavigate('messages')}>
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <Icon name="message" size={22} color="#5856d6" />
            {totalUnread > 0 && <span className="stat-badge">{totalUnread}</span>}
          </div>
          <p className="stat-value" style={{ color: '#5856d6' }}>{totalUnread}</p>
          <p className="stat-label">Beskeder</p>
        </div>
        <div className="stat-card" onClick={() => onNavigate('news')}>
          <Icon name="news" size={22} color="#ff9500" />
          <p className="stat-value" style={{ color: '#ff9500' }}>{news.length}</p>
          <p className="stat-label">Nyheder</p>
        </div>
      </div>

      <SectionHeader title="Kommende kampe" />
      <div className="card-list">
        {MATCHES.map(m => (
          <div className="match-card" key={m.id}>
            <div className="match-team-badge">
              <Icon name="shirt" size={14} color="white" />
            </div>
            <div className="match-info">
              <p className="match-teams"><strong>{m.team}</strong> vs. {m.opponent}</p>
              <p className="match-meta">
                {m.date} · {m.time} ·{' '}
                <span style={{ color: m.isHome ? 'var(--green)' : 'var(--text2)' }}>
                  {m.isHome ? 'Hjemmebane' : 'Udebane'}
                </span>
              </p>
            </div>
            <Icon name="location" size={16} color={m.isHome ? 'var(--green)' : 'var(--text3)'} />
          </div>
        ))}
      </div>

      <SectionHeader title="Seneste nyheder" />
      <div className="card-list">
        {news.slice(0, 3).map(article => (
          <div className="news-preview-card" key={article.id} onClick={() => onNavigate('news-detail', article)}>
            <CategoryPill label={article.category} color={article.categoryColor || '#1a5c2a'} />
            <p className="news-preview-title">{article.title}</p>
            <p className="news-preview-date">{article.date}</p>
          </div>
        ))}
      </div>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function TeamsScreen({ onSelectTeam }) {
  const youth  = TEAMS.filter(t => t.category === 'Ungdom')
  const senior = TEAMS.filter(t => t.category === 'Senior')
  const renderList = (teams, icon) => (
    <div className="list-group">
      {teams.map((team, i) => (
        <div key={team.id}>
          {i > 0 && <div className="list-separator" />}
          <button className="list-item" onClick={() => onSelectTeam(team)}>
            <div className="list-item-icon" style={{ background: 'var(--green-soft)' }}>
              <Icon name={icon} size={17} color="var(--green)" />
            </div>
            <div className="list-item-body">
              <span className="list-item-title">{team.name}</span>
              <span className="list-item-detail">{team.members} spillere · {team.coach}</span>
            </div>
            <Chevron />
          </button>
        </div>
      ))}
    </div>
  )
  return (
    <div className="screen">
      <SectionHeader title="Ungdom" />
      {renderList(youth, 'users')}
      <SectionHeader title="Senior" />
      {renderList(senior, 'trophy')}
      <div style={{ height: 8 }} />
    </div>
  )
}

function TeamDetailScreen({ team }) {
  const [W, D, L] = team.record
  return (
    <div className="screen">
      <div className="team-hero">
        <div className="team-hero-icon"><Icon name="trophy" size={36} color="white" /></div>
        <h2 className="team-hero-name">{team.name}</h2>
        <p className="team-hero-category">{team.category}</p>
      </div>
      <div className="stat-row" style={{ padding: '0 16px' }}>
        <div className="stat-card"><p className="stat-value" style={{ color: '#34c759' }}>{W}</p><p className="stat-label">Sejre</p></div>
        <div className="stat-card"><p className="stat-value" style={{ color: '#ff9500' }}>{D}</p><p className="stat-label">Uafgjort</p></div>
        <div className="stat-card"><p className="stat-value" style={{ color: '#ff3b30' }}>{L}</p><p className="stat-label">Nederlag</p></div>
      </div>
      <SectionHeader title="Næste kamp" />
      <div className="list-group">
        <div className="list-item" style={{ cursor: 'default' }}>
          <div className="list-item-icon" style={{ background: '#fff3e0' }}>
            <Icon name="calendar" size={17} color="#ff9500" />
          </div>
          <div className="list-item-body"><span className="list-item-title">{team.nextMatch}</span></div>
        </div>
      </div>
      <SectionHeader title="Træner" />
      <div className="list-group">
        <div className="list-item" style={{ cursor: 'default' }}>
          <div className="list-item-icon" style={{ background: 'var(--green-soft)' }}>
            <Icon name="person" size={17} color="var(--green)" />
          </div>
          <div className="list-item-body">
            <span className="list-item-title">{team.coach}</span>
            <span className="list-item-detail">{team.coachPhone}</span>
          </div>
          <Icon name="phone" size={17} color="var(--green)" />
        </div>
      </div>
      <SectionHeader title={`Spillere (${team.members})`} />
      <div className="list-group">
        {team.players.map((p, i) => (
          <div key={p}>
            {i > 0 && <div className="list-separator" />}
            <div className="list-item" style={{ cursor: 'default' }}>
              <Avatar initials={p.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                size={32} color={`hsl(${(i * 47) % 360}, 45%, 40%)`} />
              <div className="list-item-body" style={{ marginLeft: 12 }}>
                <span className="list-item-title">{p}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 8 }} />
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
            <div className="news-card-top">
              <CategoryPill label={article.category} color={article.categoryColor || '#1a5c2a'} />
              <span className="news-date">{article.date}</span>
            </div>
            <h3 className="news-title">{article.title}</h3>
            <p className="news-excerpt">{article.excerpt}</p>
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

// ─── Messages (Firestore + fallback) ─────────────────────────────────────────

function MessagesScreen({ onSelectConversation, conversations, isLive }) {
  return (
    <div className="screen">
      <div className="section-header-row">
        <span className="section-header-text">Samtaler</span>
        <FirestoreDot live={isLive} />
      </div>
      <div className="list-group" style={{ marginTop: 0 }}>
        {conversations.map((conv, i) => (
          <div key={conv.id}>
            {i > 0 && <div className="list-separator list-separator--indent" />}
            <button className="conv-item" onClick={() => onSelectConversation(conv)}>
              <div style={{ position: 'relative' }}>
                <Avatar initials={conv.avatar || conv.name?.slice(0,2).toUpperCase()} color={conv.avatarColor || '#1a5c2a'} size={48} />
                {conv.isGroup && (
                  <span className="group-indicator">
                    <Icon name="users" size={9} color="white" />
                  </span>
                )}
              </div>
              <div className="conv-body">
                <div className="conv-top">
                  <span className="conv-name">{conv.name}</span>
                  <span className={`conv-time ${conv.unread ? 'conv-time--unread' : ''}`}>{conv.time}</span>
                </div>
                <div className="conv-bottom">
                  <span className="conv-last">{conv.lastMessage}</span>
                  {conv.unread > 0 && <Badge count={conv.unread} />}
                </div>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Chat (Firestore real-time messages) ─────────────────────────────────────

function ChatScreen({ conversation, user }) {
  const isDemo = !!user?.isDemo
  const [messages, setMessages] = useState(isDemo ? (conversation.messages || []) : [])
  const [text, setText]         = useState('')
  const [sending, setSending]   = useState(false)
  const bottomRef               = useRef(null)

  // Subscribe to Firestore messages (skipped in demo mode)
  useEffect(() => {
    if (isDemo) {
      setMessages(conversation.messages || [])
      return
    }
    const q = query(
      collection(db, 'conversations', String(conversation.id), 'messages'),
      orderBy('timestamp', 'asc'),
      limit(100)
    )
    const unsub = onSnapshot(q,
      snap => {
        if (!snap.empty) {
          setMessages(snap.docs.map(d => {
            const data = d.data()
            return {
              id: d.id,
              sender: data.sender || '',
              text: data.text || '',
              time: data.timestamp?.toDate().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) || '',
              isMe: data.senderId === user.uid,
            }
          }))
        } else {
          setMessages(conversation.messages || [])
        }
      },
      () => setMessages(conversation.messages || [])
    )
    return unsub
  }, [conversation.id, isDemo, user.uid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(e) {
    e.preventDefault()
    const msg = text.trim()
    if (!msg) return
    setText('')

    if (isDemo) {
      setMessages(prev => [...prev, {
        id: Date.now(),
        sender: user.name,
        text: msg,
        time: new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
      }])
      return
    }

    setSending(true)
    try {
      await addDoc(collection(db, 'conversations', String(conversation.id), 'messages'), {
        sender: user.name,
        senderId: user.uid,
        text: msg,
        timestamp: serverTimestamp(),
      })
    } catch {
      // Firestore write failed – vis besked lokalt som fallback
      setMessages(prev => [...prev, {
        id: Date.now(),
        sender: user.name,
        text: msg,
        time: new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat-screen">
      <div className="chat-messages">
        {messages.map((msg, i) => {
          const showName = !msg.isMe && conversation.isGroup &&
            (i === 0 || messages[i - 1].sender !== msg.sender)
          return (
            <div key={msg.id} className={`bubble-row ${msg.isMe ? 'bubble-row--me' : ''}`}>
              {!msg.isMe && (
                <Avatar
                  initials={msg.sender.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  color={conversation.avatarColor || '#1a5c2a'}
                  size={28}
                />
              )}
              <div className="bubble-wrap">
                {showName && <span className="bubble-sender">{msg.sender}</span>}
                <div className={`bubble ${msg.isMe ? 'bubble--me' : 'bubble--them'}`}>{msg.text}</div>
                <span className="bubble-time">{msg.time}</span>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-bar" onSubmit={send}>
        <input className="chat-input" value={text} onChange={e => setText(e.target.value)}
          placeholder={isDemo ? 'Demo – besked sendes ikke…' : 'Besked…'} />
        <button className="chat-send" type="submit" disabled={!text.trim() || sending}>
          <Icon name="send" size={18} color="white" />
        </button>
      </form>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser]                           = useState(null)
  const [authChecked, setAuthChecked]             = useState(false)
  const [activeTab, setActiveTab]                 = useState('dashboard')
  const [selectedTeam, setSelectedTeam]           = useState(null)
  const [selectedArticle, setSelectedArticle]     = useState(null)
  const [selectedConv, setSelectedConv]           = useState(null)
  const [news, setNews]                           = useState(NEWS_FALLBACK)
  const [newsLive, setNewsLive]                   = useState(false)
  const [convos, setConvos]                       = useState(CONVERSATIONS_FALLBACK)
  const [convosLive, setConvosLive]               = useState(false)
  const [needsEmailForLink, setNeedsEmailForLink] = useState(false)
  const [magicLinkError, setMagicLinkError]       = useState('')

  // magicLinkRef: true while sign-in link is being processed → prevents
  // the onAuthStateChanged null-event from showing the login screen
  const magicLinkRef     = useRef(false)
  const magicLinkHrefRef = useRef(null)   // saved for cross-device flow
  const isDemoRef        = useRef(false)

  // ── Load + merge Firestore profile ───────────────────────────────────────
  async function loadAndSetUser(fbUser) {
    let profile = {}
    try {
      const snap = await getDoc(doc(db, 'users', fbUser.uid))
      if (snap.exists()) {
        profile = snap.data()
      } else {
        // First login – create a minimal profile document
        profile = {
          email:       fbUser.email,
          displayName: fbUser.displayName || fbUser.email.split('@')[0],
          role:        'Medlem',
          createdAt:   serverTimestamp(),
        }
        setDoc(doc(db, 'users', fbUser.uid), profile).catch(() => {})
      }
    } catch { /* Firestore unavailable – use Auth data only */ }

    const displayName = profile.displayName || fbUser.displayName || fbUser.email.split('@')[0]
    const parts = displayName.trim().split(' ').filter(Boolean)
    setUser({
      name:      displayName,
      firstName: profile.firstName || parts[0] || fbUser.email.split('@')[0],
      email:     fbUser.email,
      uid:       fbUser.uid,
      initials:  ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase()
                 || fbUser.email.slice(0, 2).toUpperCase(),
      team:      profile.team     || '',
      role:      profile.role     || 'Medlem',
      memberId:  profile.memberId || '',
    })
  }

  // ── Auth state listener ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async fbUser => {
      if (fbUser) {
        magicLinkRef.current = false
        await loadAndSetUser(fbUser)
        setAuthChecked(true)
      } else if (!magicLinkRef.current && !isDemoRef.current) {
        // No magic link in flight and no demo session → show login
        setUser(null)
        setAuthChecked(true)
      }
      // If magicLinkRef is true, we stay on the splash screen until
      // signInWithEmailLink resolves and triggers this listener again
    })
    return unsub
  }, [])

  // ── Magic link handler (runs once on mount) ──────────────────────────────
  useEffect(() => {
    const href = window.location.href
    if (!isSignInWithEmailLink(auth, href)) return

    // Store href before cleaning the URL
    magicLinkHrefRef.current = href
    window.history.replaceState(null, '', window.location.pathname)
    magicLinkRef.current = true

    const savedEmail = localStorage.getItem(LS_EMAIL_KEY)
    if (!savedEmail) {
      // Opened on a different device – ask the user to confirm their email
      setNeedsEmailForLink(true)
      magicLinkRef.current = false
      setAuthChecked(true)
      return
    }

    signInWithEmailLink(auth, savedEmail, href)
      .then(() => {
        localStorage.removeItem(LS_EMAIL_KEY)
        // onAuthStateChanged fires next and completes the flow
      })
      .catch(err => {
        magicLinkRef.current = false
        setMagicLinkError(AUTH_ERRORS[err.code] || 'Linket er ugyldigt eller udløbet. Anmod om et nyt.')
        setAuthChecked(true)
      })
  }, [])

  // ── Cross-device: user confirms email to finish sign-in ──────────────────
  async function handleEmailConfirmForLink(email) {
    await signInWithEmailLink(auth, email, magicLinkHrefRef.current)
    localStorage.removeItem(LS_EMAIL_KEY)
    setNeedsEmailForLink(false)
    // onAuthStateChanged completes the rest
  }

  // ── Firestore: news ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'news'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q,
      snap => { if (!snap.empty) { setNews(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setNewsLive(true) } },
      () => setNewsLive(false)
    )
    return unsub
  }, [user?.uid])

  // ── Firestore: conversations ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'conversations'), orderBy('updatedAt', 'desc'))
    const unsub = onSnapshot(q,
      snap => { if (!snap.empty) { setConvos(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setConvosLive(true) } },
      () => setConvosLive(false)
    )
    return unsub
  }, [user?.uid])

  // ── Navigation ────────────────────────────────────────────────────────────
  function switchTab(tab) {
    setActiveTab(tab); setSelectedTeam(null); setSelectedArticle(null); setSelectedConv(null)
  }

  function navigateFromDashboard(dest, data) {
    if (dest === 'news-detail') { setActiveTab('news'); setSelectedArticle(data) }
    else switchTab(dest)
  }

  async function handleLogout() {
    isDemoRef.current = false
    setUser(null); setActiveTab('dashboard')
    setSelectedTeam(null); setSelectedArticle(null); setSelectedConv(null)
    setNewsLive(false); setConvosLive(false)
    setNews(NEWS_FALLBACK); setConvos(CONVERSATIONS_FALLBACK)
    try { await signOut(auth) } catch {}
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  // Splash while Firebase checks existing session or processes magic link
  if (!authChecked) return <SplashScreen label={magicLinkRef.current ? 'Logger ind…' : undefined} />

  // Cross-device: user must confirm email before we can finish sign-in
  if (needsEmailForLink) {
    return (
      <NeedsEmailScreen
        onSubmit={handleEmailConfirmForLink}
        onCancel={() => {
          setNeedsEmailForLink(false)
          magicLinkRef.current = false
        }}
      />
    )
  }

  if (!user) {
    return (
      <LoginScreen
        initialError={magicLinkError}
        onDemoLogin={() => { isDemoRef.current = true; setUser(DEMO_USER) }}
      />
    )
  }

  // ── Header state ─────────────────────────────────────────────────────────
  const TAB_TITLES = { dashboard: 'Hjem', teams: 'Hold', news: 'Nyheder', messages: 'Beskeder' }
  let headerTitle = TAB_TITLES[activeTab]
  let onBack = null
  let backLabel = null

  if (activeTab === 'teams' && selectedTeam) {
    headerTitle = selectedTeam.name; onBack = () => setSelectedTeam(null); backLabel = 'Hold'
  } else if (activeTab === 'news' && selectedArticle) {
    headerTitle = 'Nyhed'; onBack = () => setSelectedArticle(null); backLabel = 'Nyheder'
  } else if (activeTab === 'messages' && selectedConv) {
    headerTitle = selectedConv.name; onBack = () => setSelectedConv(null); backLabel = 'Beskeder'
  }

  const totalUnread = convos.reduce((s, c) => s + (c.unread || 0), 0)

  const logoutBtn = !onBack && (
    <button className="header-action" onClick={handleLogout} title="Log ud">
      <Icon name="logout" size={19} color="var(--text2)" />
    </button>
  )

  return (
    <div className="app">
      <AppHeader title={headerTitle} onBack={onBack} backLabel={backLabel} right={logoutBtn} />

      <main className="app-content">
        {activeTab === 'dashboard' && (
          <DashboardScreen user={user} conversations={convos} news={news} onNavigate={navigateFromDashboard} />
        )}
        {activeTab === 'teams' && !selectedTeam && (
          <TeamsScreen onSelectTeam={setSelectedTeam} />
        )}
        {activeTab === 'teams' && selectedTeam && (
          <TeamDetailScreen team={selectedTeam} />
        )}
        {activeTab === 'news' && !selectedArticle && (
          <NewsScreen articles={news} isLive={newsLive} onSelectArticle={setSelectedArticle} />
        )}
        {activeTab === 'news' && selectedArticle && (
          <NewsDetailScreen article={selectedArticle} />
        )}
        {activeTab === 'messages' && !selectedConv && (
          <MessagesScreen conversations={convos} isLive={convosLive} onSelectConversation={setSelectedConv} />
        )}
        {activeTab === 'messages' && selectedConv && (
          <ChatScreen conversation={selectedConv} user={user} />
        )}
      </main>

      <BottomNav activeTab={activeTab} onChange={switchTab} unreadCount={totalUnread} />
    </div>
  )
}
