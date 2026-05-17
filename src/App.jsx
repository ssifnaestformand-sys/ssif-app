import { useState, useRef, useEffect } from 'react'
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
  onAuthStateChanged,
} from 'firebase/auth'
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteField, arrayUnion, arrayRemove, serverTimestamp, limit, increment,
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
    'check-circle':<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></>,
    'alert-circle':<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    'person-circle':<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
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
  name:           'Lars Thomsen',
  firstName:      'Lars',
  email:          'lars@demo.dk',
  initials:       'LT',
  isDemo:         true,
  emailVerified:  true,
  primaryEmail:   'lars@demo.dk',
  extraEmails:    [],
  holdIds:        [],
  holds:          [],
  familyMembers:  [],
  role:           'Medlem',
  onboardingDone: false,
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

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onDemoLogin, initialError }) {
  const [mode, setMode]         = useState('main') // 'main' | 'forgot' | 'create'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(null)  // null | 'google' | 'facebook' | 'email' | 'create' | 'reset'
  const [error, setError]       = useState(initialError || '')
  const [info, setInfo]         = useState('')

  function reset(m = 'main') { setMode(m); setError(''); setInfo('') }

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

  return (
    <div className="login-screen">
      <div className="login-top">
        <div className="login-logo"><span>SSIF</span></div>
        <h1 className="login-club">Sejs-Svejbæk IF</h1>
        <p className="login-subtitle">
          {mode === 'forgot' ? 'Nulstil adgangskode' : mode === 'create' ? 'Opret konto' : 'Log ind på din konto'}
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

          <div className="login-divider"><span>test</span></div>
          <button className="btn btn-secondary btn-full" type="button" onClick={onDemoLogin}>
            Demo adgang
          </button>
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
    { id: 'dashboard', label: 'Hjem',     icon: 'home'          },
    { id: 'profil',    label: 'Profil',   icon: 'person-circle' },
    { id: 'news',      label: 'Nyheder',  icon: 'news'          },
    { id: 'messages',  label: 'Beskeder', icon: 'message'       },
    { id: 'teams',     label: 'Hold',     icon: 'users'         },
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

function WelcomeScreen({ user, onDone }) {
  const [saving, setSaving] = useState(false)

  async function done() {
    setSaving(true)
    if (!user.isDemo) {
      updateDoc(doc(db, 'users', user.uid), { onboardingDone: true }).catch(() => {})
    }
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
    const today = new Date().toISOString().slice(0, 10)
    getDocs(query(collection(db, 'events'), where('date', '>=', today), orderBy('date'), limit(10)))
      .then(snap => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
    getDocs(query(collection(db, 'banners'), orderBy('order')))
      .then(snap => setBanners(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.aktiv !== false)))
      .catch(() => {})
    getDoc(doc(db, 'settings', 'app'))
      .then(s => { if (s.exists() && s.data().eventsOnDashboard !== undefined) setEventsCount(s.data().eventsOnDashboard) })
      .catch(() => {})
  }, [])

  // Byg person-label map: conventus_id → navn (fra familyMembers)
  const personLabel = {}
  ;(user.familyMembers || []).forEach(m => {
    if (m.holdId) personLabel[String(m.holdId)] = m.name
  })

  // Bygger ugeoversigt: sessions per dag
  const today    = new Date()
  const todayIdx = (today.getDay() + 6) % 7  // 0=Man … 6=Søn
  const monday   = new Date(today)
  monday.setDate(today.getDate() - todayIdx)
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return d
  })

  const byDay = [[], [], [], [], [], [], []]
  calHolds.forEach(hold => {
    parseSessions(hold.traeningstider).forEach(({ dayIdx, time }) => {
      byDay[dayIdx].push({ hold, time })
    })
  })
  byDay.forEach(day => day.sort((a, b) => a.time.localeCompare(b.time)))

  const hasSessions = byDay.some(d => d.length > 0)

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
        <button
          onClick={() => onNavigate('profil')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          aria-label="Gå til profil"
        >
          <Avatar initials={user.initials || user.name.slice(0, 2).toUpperCase()} size={44} />
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

      {/* ── Ugeoversigt ────────────────────────────── */}
      <SectionHeader title="Ugeoversigt – træning" />
      <div style={{ padding: '0 16px 4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {weekDates.map((date, i) => {
            const isToday    = i === todayIdx
            const isPast     = i < todayIdx
            const sessions   = byDay[i]
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                {/* Dag-label */}
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px',
                  color: isToday ? 'var(--green)' : 'var(--text3)',
                }}>
                  {DAY_SHORT[i]}
                </span>
                {/* Dato-cirkel */}
                <div style={{
                  width: 26, height: 26, borderRadius: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isToday ? 'var(--green)' : 'transparent',
                  color: isToday ? 'white' : isPast ? 'var(--text3)' : 'var(--text)',
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                }}>
                  {date.getDate()}
                </div>
                {/* Træningssessioner */}
                {sessions.map((s, j) => {
                  const label = personLabel[String(s.hold.conventus_id)]
                    || s.hold.titel?.split(/\s+/)[0]
                    || '?'
                  return (
                    <button key={j}
                      onClick={() => onNavigate('team-detail', s.hold)}
                      style={{
                        width: '100%', border: 'none', borderRadius: 5, padding: '3px 1px',
                        background: isPast ? '#d1d5db' : 'var(--green)',
                        color: 'white', fontSize: 9, fontWeight: 600,
                        cursor: 'pointer', textAlign: 'center', lineHeight: 1.35,
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>
                        {label}
                      </div>
                      {s.time && (
                        <div style={{ opacity: .85, fontSize: 8 }}>{s.time}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        {!hasSessions && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)', padding: '10px 0 4px' }}>
            Ingen træningstider — tilføjes af trænerne i backoffice
          </p>
        )}
      </div>

      {/* ── Kommende begivenheder ─────────────────── */}
      {eventsCount > 0 && events.length > 0 && (
        <>
          <SectionHeader title="Kommende begivenheder" />
          <div className="card-list">
            {events.slice(0, eventsCount).map(ev => {
              const d = ev.date ? new Date(ev.date + 'T12:00:00') : null
              const dateStr = d ? d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
              const typeColor = { kamp: '#1a5c2a', træning: '#5856d6', stævne: '#ff9500', arrangement: '#ff3b30' }
              const color = typeColor[ev.type] || '#5856d6'
              return (
                <div key={ev.id} style={{
                  background: 'var(--surface)', borderRadius: 'var(--radius)',
                  padding: '12px 14px', display: 'flex', alignItems: 'center',
                  gap: 12, boxShadow: 'var(--shadow)',
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, background: color + '18',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color, lineHeight: 1 }}>
                      {d ? d.getDate() : '?'}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 600, color, textTransform: 'uppercase' }}>
                      {d ? d.toLocaleDateString('da-DK', { month: 'short' }) : ''}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{ev.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 1 }}>
                      {dateStr}{ev.time ? ` · ${ev.time}` : ''}{ev.location ? ` · ${ev.location}` : ''}
                    </div>
                  </div>
                  {ev.type && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color,
                      background: color + '18', padding: '2px 7px', borderRadius: 20,
                      flexShrink: 0, textTransform: 'capitalize',
                    }}>
                      {ev.type}
                    </span>
                  )}
                </div>
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

function TeamsScreen({ onSelectTeam, user }) {
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
    <div className="screen" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text2)', fontSize: 14 }}>
      Ingen holdtilmeldinger fundet. Tilføj din email under Profil for at se dine hold.
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
      {/* Tilmeldingslink */}
      <div style={{ margin: '8px 16px 0' }}>
        <a href="https://www.sejssvejbaek-if.dk/tilmelding"
           target="_blank" rel="noopener noreferrer"
           style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'var(--surface)', borderRadius: 'var(--radius)',
            padding: '14px 16px', boxShadow: 'var(--shadow)',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'var(--green-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="user-plus" size={20} color="var(--green)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>
                Tilmeld dig selv eller dit barn
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 1 }}>
                Åbner tilmeldingsside på sejssvejbaek-if.dk
              </div>
            </div>
            <Icon name="chevron" size={18} color="var(--text3)" sw={2.5} />
          </div>
        </a>
      </div>
      <div style={{ height: 16 }} />
    </div>
  )
}

function TeamDetailScreen({ team: hold }) {
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
                 dangerouslySetInnerHTML={{ __html: hold.beskrivelse }} />
          </div>
        </>
      ) : null}

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
    if (saving || user.isDemo) return
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
  const [holds,  setHolds]  = useState([])
  const [holdId, setHoldId] = useState('')
  const [tekst,  setTekst]  = useState('')
  const [saving, setSaving] = useState(false)
  const [done,   setDone]   = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'holds'), where('aktiv', '==', true)))
      .then(snap => {
        let all = snap.docs.map(d => d.data())
        if (user.role !== 'admin') {
          const mine = new Set((user.holds || []).map(String))
          all = all.filter(h => mine.has(String(h.conventus_id)))
        }
        all.sort((a, b) =>
          (a.aktivitet_titel || '').localeCompare(b.aktivitet_titel || '', 'da') ||
          (a.titel || '').localeCompare(b.titel || '', 'da')
        )
        setHolds(all)
        if (all.length === 1) setHoldId(String(all[0].conventus_id))
      })
      .catch(() => {})
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
      setDone(true)
      setTimeout(onClose, 1400)
    } catch (err) {
      alert('Fejl: ' + err.message)
      setSaving(false)
    }
  }

  if (done) return (
    <div style={{ padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
      <p style={{ fontSize: 17, fontWeight: 700 }}>Besked sendt!</p>
    </div>
  )

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Ny besked</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <Icon name="x" size={22} color="var(--text3)" />
        </button>
      </div>
      <form onSubmit={send}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Send til hold</label>
          <select className="form-control" value={holdId} onChange={e => setHoldId(e.target.value)} required style={{ fontSize: 15 }}>
            <option value="">Vælg hold…</option>
            {holds.map(h => <option key={h.conventus_id} value={String(h.conventus_id)}>{h.titel}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Besked</label>
          <textarea className="form-control" rows={6} value={tekst} onChange={e => setTekst(e.target.value)}
            placeholder="Skriv din besked til holdet…" required style={{ resize: 'none', fontSize: 15 }} autoFocus />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', height: 48, fontSize: 15 }}
                disabled={saving || !holdId || !tekst.trim()}>
          {saving ? 'Sender…' : 'Send besked'}
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
      {/* Compose knap for trænere */}
      {isTrainer && (
        <div style={{ padding: '12px 16px 4px' }}>
          <button className="btn btn-primary" style={{ width: '100%', height: 46, fontSize: 15, gap: 8 }}
                  onClick={() => setCompose(true)}>
            <Icon name="send" size={17} color="white" />
            Send besked til hold
          </button>
        </div>
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

// ─── Familie ──────────────────────────────────────────────────────────────────

const FAM_COLORS = ['#5856d6','#ff9500','#ff3b30','#34c759','#007aff','#af52de','#ff6b35']

function fmtEventDate(dateStr) {
  if (!dateStr) return '–'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })
}

function FamilieTab({ user }) {
  const [holds,   setHolds]   = useState([])
  const [members, setMembers] = useState(null)
  const [events,  setEvents]  = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [form,    setForm]    = useState({ name: '', holdId: '' })
  const [saving,  setSaving]  = useState(false)

  // Hent hold fra Conventus
  useEffect(() => {
    fetch('holds.php').then(r => r.json())
      .then(d => setHolds(d.groups || []))
      .catch(() => {})
  }, [])

  // Hent familiemedlemmer fra Firestore
  useEffect(() => {
    if (!user?.uid) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      setMembers(snap.exists() ? (snap.data().familyMembers || []) : [])
    })
  }, [user?.uid])

  // Hent kommende begivenheder fra Firestore
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'events'), orderBy('date'), limit(40)),
      snap => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [])

  async function persistMembers(updated) {
    setMembers(updated)
    await updateDoc(doc(db, 'users', user.uid), { familyMembers: updated })
  }

  async function addMember() {
    if (!form.name.trim() || !form.holdId) return
    setSaving(true)
    const hold = holds.find(h => String(h.id) === form.holdId) ?? {}
    const m = {
      id:               Date.now().toString(),
      name:             form.name.trim(),
      holdId:           form.holdId,
      holdName:         hold.name ?? '',
      activityTypeName: hold.activityTypeName ?? '',
      periode:          hold.periode ?? '',
      color:            FAM_COLORS[(members?.length ?? 0) % FAM_COLORS.length],
    }
    await persistMembers([...(members || []), m])
    setForm({ name: '', holdId: '' })
    setShowAdd(false)
    setSaving(false)
  }

  const holdIds   = new Set((members || []).map(m => String(m.holdId)))
  const today     = new Date().toISOString().slice(0, 10)
  const upcoming  = events
    .filter(e => e.date >= today && holdIds.has(String(e.holdId)))
    .slice(0, 15)

  const typeColor = { kamp: '#1a5c2a', træning: '#5856d6', stævne: '#ff9500', arrangement: '#ff3b30' }

  return (
    <div className="screen">

      {/* ── Egen profil ─────────────────────────────────── */}
      <SectionHeader title="Min profil" />
      <div className="list-group">
        <div className="list-item" style={{ cursor: 'default' }}>
          <Avatar initials={user.initials} size={40} />
          <div className="list-item-body" style={{ marginLeft: 12 }}>
            <span className="list-item-title">{user.name}</span>
            <span className="list-item-detail">{user.email}</span>
          </div>
        </div>
      </div>

      {/* ── Familiemedlemmer ────────────────────────────── */}
      <SectionHeader title="Familiemedlemmer" />

      {members === null
        ? <div style={{ padding: '12px 20px', color: 'var(--text2)', fontSize: 14 }}>Henter…</div>
        : (
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {members.length === 0 && !showAdd && (
              <p style={{ fontSize: 14, color: 'var(--text2)', paddingTop: 4 }}>
                Tilføj børn eller andre familiemedlemmer for at se fælles kalender.
              </p>
            )}

            {members.map(m => {
              const liveHold = holds.find(h => String(h.id) === m.holdId)
              const periode  = liveHold?.periode || m.periode
              return (
                <div key={m.id} className="fam-card">
                  <div className="fam-dot" style={{ background: m.color }} />
                  <div className="fam-info">
                    <span className="fam-name">{m.name}</span>
                    <span className="fam-hold">{liveHold?.name || m.holdName || '–'}</span>
                    {liveHold?.activityTypeName && (
                      <span className="fam-sport">{liveHold.activityTypeName}</span>
                    )}
                    {periode && <span className="fam-tid">{periode}</span>}
                  </div>
                  <button className="fam-remove" onClick={() => persistMembers(members.filter(x => x.id !== m.id))}>
                    <Icon name="x" size={16} color="var(--text3)" />
                  </button>
                </div>
              )
            })}

            {showAdd ? (
              <div className="fam-add-form">
                <div className="form-group-inline">
                  <label className="fam-label">Navn</label>
                  <input
                    className="fam-input"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Barnets navn"
                    autoFocus
                  />
                </div>
                <div className="form-group-inline">
                  <label className="fam-label">Hold</label>
                  <select
                    className="fam-input"
                    value={form.holdId}
                    onChange={e => setForm(f => ({ ...f, holdId: e.target.value }))}
                  >
                    <option value="">Vælg hold fra Conventus…</option>
                    {Object.entries(
                      holds.reduce((acc, h) => {
                        ;(acc[h.activityTypeName] = acc[h.activityTypeName] || []).push(h)
                        return acc
                      }, {})
                    ).map(([type, hs]) => (
                      <optgroup key={type} label={type}>
                        {hs.map(h => (
                          <option key={h.id} value={h.id}>{h.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }}
                    disabled={!form.name.trim() || !form.holdId || saving}
                    onClick={addMember}>
                    {saving ? 'Gemmer…' : 'Tilføj'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setShowAdd(false); setForm({ name: '', holdId: '' }) }}>
                    Annuller
                  </button>
                </div>
              </div>
            ) : (
              <button className="fam-add-btn" onClick={() => setShowAdd(true)}>
                <Icon name="user-plus" size={17} color="var(--green)" />
                Tilføj familiemedlem
              </button>
            )}
          </div>
        )
      }

      {/* ── Samlet kalender ─────────────────────────────── */}
      <SectionHeader title="Kommende begivenheder" />
      {upcoming.length === 0 ? (
        <div style={{ padding: '12px 20px', color: 'var(--text2)', fontSize: 14 }}>
          {members?.length === 0
            ? 'Tilføj familiemedlemmer ovenfor for at se kalender.'
            : 'Ingen kommende begivenheder registreret endnu.'}
        </div>
      ) : (
        <div className="card-list">
          {upcoming.map(ev => {
            const mem  = members?.find(m => String(m.holdId) === String(ev.holdId))
            const tc   = typeColor[ev.type] || 'var(--text2)'
            return (
              <div key={ev.id} className="event-card">
                <div className="event-date-col">
                  <span className="event-day">{fmtEventDate(ev.date)}</span>
                  {ev.time && <span className="event-time">{ev.time}</span>}
                </div>
                <div className="event-body">
                  <div className="event-meta-row">
                    {ev.type && (
                      <span className="category-pill" style={{ background: tc + '20', color: tc }}>
                        {ev.type}
                      </span>
                    )}
                    {mem && (
                      <span style={{ fontSize: 11, color: mem.color, fontWeight: 600 }}>
                        {mem.name}
                      </span>
                    )}
                  </div>
                  <span className="event-title">{ev.title}</span>
                  {ev.location && <span className="event-loc">{ev.location}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── Profil ───────────────────────────────────────────────────────────────────

function ProfileScreen({ user, onLogout, onUserUpdate, verifyMsg }) {
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving]     = useState(false)
  const [info, setInfo]         = useState('')
  const [resent, setResent]     = useState(false)

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

      const res = await fetch('api/send-verification.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailLower, uid: user.uid, token }),
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
      await fetch('api/send-verification.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailStr, uid: user.uid, token }),
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
          {!user.emailVerified && !user.isDemo && (
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

      <div style={{ height: 16 }} />
      <div style={{ padding: '0 16px' }}>
        <button className="btn btn-secondary btn-full" onClick={onLogout}>
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
      {!user.isDemo && (
        <button className="btn btn-primary btn-full" onClick={resend} disabled={resent}>
          {resent ? '✓ Bekræftelsesmail sendt' : 'Send bekræftelsesmail igen'}
        </button>
      )}
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
  const [activeTab, setActiveTab]                 = useState('dashboard')
  const [selectedTeam, setSelectedTeam]           = useState(null)
  const [selectedArticle, setSelectedArticle]     = useState(null)
  const [selectedMsg,  setSelectedMsg]            = useState(null)
  const [msgUnread,    setMsgUnread]              = useState(0)
  const [news, setNews]                           = useState([])
  const [newsLive, setNewsLive]                   = useState(false)
  const [loginError, setLoginError]               = useState('')
  const [pushGranted, setPushGranted]             = useState(false)
  const [verifyMsg, setVerifyMsg]                 = useState('')

  const isDemoRef = useRef(false)

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
    let memberHoldIds = []
    try {
      const ref  = doc(db, 'users', fbUser.uid)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        profile = snap.data()
      } else {
        profile = {
          primaryEmail:  fbUser.email  || '',
          displayName:   fbUser.displayName || fbUser.email?.split('@')[0] || 'Bruger',
          emailVerified: fbUser.emailVerified,
          extraEmails:   [],
          holdIds:       [],
          role:          'Medlem',
          createdAt:     serverTimestamp(),
        }
        setDoc(ref, profile).catch(() => {})
      }

      // Hent hold-IDs fra members-samlingen (synkroniseret fra Conventus).
      if (fbUser.email) {
        const mSnap = await getDocs(query(
          collection(db, 'members'),
          where('allEmails', 'array-contains', fbUser.email.toLowerCase())
        ))
        mSnap.docs.forEach(d =>
          (d.data().holds || []).forEach(h => {
            if (h.conventus_id) memberHoldIds.push(String(h.conventus_id))
          })
        )
      }

      // Skriv lastSeen + sammenslåede holdIds til Firestore (bruges af push-notifikationer)
      if (snap.exists()) {
        const updates = { lastSeen: serverTimestamp() }
        if (profile.emailVerified !== fbUser.emailVerified) updates.emailVerified = fbUser.emailVerified
        if (memberHoldIds.length > 0) {
          updates.holdIds = [...new Set([...(profile.holdIds || []).map(String), ...memberHoldIds])]
        }
        updateDoc(ref, updates).catch(() => {})
      }
    } catch {}

    const displayName = profile.displayName || fbUser.displayName || fbUser.email?.split('@')[0] || 'Bruger'
    const parts = displayName.trim().split(' ').filter(Boolean)
    setUser({
      name:          displayName,
      firstName:     parts[0] || 'Bruger',
      email:         fbUser.email,
      uid:           fbUser.uid,
      emailVerified: fbUser.emailVerified,
      initials:      ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase()
                     || (fbUser.email?.slice(0,2).toUpperCase() ?? 'SS'),
      role:           profile.role          || 'Medlem',
      holds:          profile.holds         || [],
      holdIds:        [...new Set([...(profile.holdIds || []).map(String), ...memberHoldIds])],
      familyMembers:  profile.familyMembers  || [],
      primaryEmail:   profile.primaryEmail   || fbUser.email || '',
      extraEmails:    profile.extraEmails    || [],
      onboardingDone: profile.onboardingDone === true,
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
        if (mounted) setAuthChecked(true)
      }
      // Vis IKKE loginskærm her ved null — det klares af getRedirectResult nedenfor
    })

    // Behandl redirect-resultat fra Google/Facebook signInWithRedirect.
    // Returnerer null hurtigt hvis der ikke er et afventende redirect.
    getRedirectResult(auth)
      .then(() => {
        if (!mounted) return
        // Hvis ingen bruger kom ud af redirectet (og ingen eksisterende session),
        // viser vi loginskærmen nu.
        if (!auth.currentUser && !isDemoRef.current) {
          setUser(null)
          setAuthChecked(true)
        }
      })
      .catch(err => {
        if (!mounted) return
        const msg = AUTH_ERRORS[err.code]
        if (msg) setLoginError(msg)
        else if (err.code && err.code !== 'auth/null-user') setLoginError(err.message)
        if (!auth.currentUser && !isDemoRef.current) {
          setUser(null)
          setAuthChecked(true)
        }
      })

    return () => { mounted = false; unsubAuth() }
  }, [])

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

  // ── Ulæste beskeder (til tab-badge) ─────────────────────────────────────
  useEffect(() => {
    if (!user) return
    const seenTs = parseInt(localStorage.getItem('ssif_msgs_seen') || '0', 10)
    const userHoldIds = new Set([
      ...(user.holdIds       || []).map(String),
      ...(user.holds         || []).map(String),
      ...(user.familyMembers || []).filter(m => m.holdId).map(m => String(m.holdId)),
    ])
    const q = query(collection(db, 'messages'), orderBy('oprettet', 'desc'), limit(60))
    return onSnapshot(q, snap => {
      const count = snap.docs.filter(d => {
        const data = d.data()
        const ts   = (data.oprettet || data.createdAt)?.toDate?.().getTime() ?? 0
        const inHold = data.holdId
          ? userHoldIds.has(String(data.holdId))
          : (data.targetHolds || []).some(h => userHoldIds.has(typeof h === 'object' ? String(h.conventus_id) : String(h)))
        return ts > seenTs && inHold
      }).length
      setMsgUnread(count)
    }, () => {})
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
    if (!user?.uid || user.isDemo || pushGranted) return false
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
          icon: `${import.meta.env.BASE_URL}icon-192.png`,
        })
      }
    })
  }, [!!user])

  // ── Navigation ────────────────────────────────────────────────────────────
  function switchTab(tab) {
    setActiveTab(tab); setSelectedTeam(null); setSelectedArticle(null); setSelectedMsg(null)
  }

  function navigateFromDashboard(dest, data) {
    if (dest === 'news-detail')  { setActiveTab('news');  setSelectedArticle(data) }
    else if (dest === 'team-detail') { setActiveTab('teams'); setSelectedTeam(data) }
    else switchTab(dest)
  }

  async function handleLogout() {
    isDemoRef.current = false
    setUser(null); setActiveTab('dashboard')
    setSelectedTeam(null); setSelectedArticle(null); setSelectedMsg(null)
    setNewsLive(false)
    setNews([])
    try { await signOut(auth) } catch {}
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (!authChecked) return <SplashScreen />

  if (!user) {
    return (
      <LoginScreen
        initialError={loginError}
        onDemoLogin={() => { isDemoRef.current = true; setUser(DEMO_USER) }}
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

  // Ikke-verificerede brugere ser kun nyheder
  if (!user.emailVerified && activeTab !== 'news' && activeTab !== 'profil') {
    // Stil dem på news-tab første gang
  }

  // ── Header state ─────────────────────────────────────────────────────────
  const TAB_TITLES = { dashboard: 'Hjem', profil: 'Min profil', teams: 'Hold', news: 'Nyheder', messages: 'Beskeder' }
  let headerTitle = TAB_TITLES[activeTab] ?? 'SSIF'
  let onBack = null
  let backLabel = null

  if (activeTab === 'teams' && selectedTeam) {
    headerTitle = selectedTeam.name; onBack = () => setSelectedTeam(null); backLabel = 'Hold'
  } else if (activeTab === 'news' && selectedArticle) {
    headerTitle = 'Nyhed'; onBack = () => setSelectedArticle(null); backLabel = 'Nyheder'
  } else if (activeTab === 'messages' && selectedMsg) {
    headerTitle = 'Besked'; onBack = () => setSelectedMsg(null); backLabel = 'Beskeder'
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
                         onUserUpdate={setUser} verifyMsg={verifyMsg} />
        )}
        {activeTab === 'teams' && !user.emailVerified ? (
          <UnverifiedScreen user={user} onLogout={handleLogout} />
        ) : activeTab === 'teams' && !selectedTeam ? (
          <TeamsScreen onSelectTeam={setSelectedTeam} user={user} />
        ) : activeTab === 'teams' && selectedTeam ? (
          <TeamDetailScreen team={selectedTeam} />
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
            onMarkSeen={() => setMsgUnread(0)}
            onEnableNotifications={handleEnableNotifications}
          />
        ) : activeTab === 'messages' && selectedMsg ? (
          <MessageDetailScreen msg={selectedMsg} user={user} onBack={() => setSelectedMsg(null)} />
        ) : null}
      </main>

      <BottomNav activeTab={activeTab} onChange={switchTab} unreadCount={totalUnread} />
    </div>
  )
}
