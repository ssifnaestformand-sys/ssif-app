# Samtykkeerklæring og implementeringsplan

**Version 1.0 — Gælder fra 27. maj 2026**

---

## Del 1: Samtykkeerklæring (hvad brugeren ser ved første login)

Nedenstående tekst vises på samtykkeskærmen i appen, inden brugeren får adgang.

---

### Velkommen til SSIF-appen

Inden du fortsætter, beder vi dig om at bekræfte, at du har læst og accepterer følgende:

---

**Nødvendig accept** *(kræves for at bruge appen)*

☐ Jeg har læst og accepterer **Privatlivspolitikken** og **Vilkårene for brug** af SSIF-appen.

Jeg er indforstået med:
- At SSIF behandler mit navn, min email og min holdtilknytning for at appen kan fungere
- At mine oplysninger opbevares i Firebase (Google) og behandles i overensstemmelse med GDPR
- At min konto automatisk slettes efter 2 års inaktivitet

*Uden denne accept kan du ikke bruge appen.*

---

**Email-notifikationer** *(valgfrit)*

☐ Ja, jeg vil gerne modtage email-notifikationer, når min træner sender en ny besked eller opretter et event.

Du kan til enhver tid ændre dette under **Profil → Indstillinger**.

---

**Push-notifikationer**

Push-notifikationer til din telefon kræver en separat tilladelse fra dit styresystem (iOS/Android). Vi beder dig om denne tilladelse, første gang du tilgår Notifikationer i appen. Du kan til enhver tid ændre din tilladelse i telefonens indstillinger.

---

*Har du spørgsmål? Skriv til kontakt@sejssvejbaek-if.dk*

---

## Del 2: Det gemmes i Firestore

Når brugeren accepterer, gemmes følgende på brugerdokumentet i Firestore (`users/{uid}`):

```
consentGiven:      true
consentVersion:    "1.0"
consentTimestamp:  <serverTimestamp>
emailNotifications: true / false
```

Samtykket gemmes med tidsstempel og versionsnummer, så SSIF til enhver tid kan dokumentere:
- At brugeren accepterede
- Hvornår de accepterede
- Hvilken version af privatlivspolitikken og vilkårene de accepterede

---

## Del 3: Implementeringsplan

### A. Nye brugere

1. Bruger opretter konto (email/password eller Google) eller logger ind første gang
2. `loadAndSetUser` indlæser brugerprofil fra Firestore
3. Systemet tjekker: er `consentGiven === true` og `consentVersion === CURRENT_VERSION`?
4. Nej → **ConsentScreen** vises. Brugeren kan ikke komme videre uden at acceptere
5. Bruger sætter hak i "Jeg accepterer privatlivspolitikken og vilkårene" (krævet)
6. Bruger vælger eventuelt til email-notifikationer (valgfrit)
7. Bruger trykker "Acceptér og fortsæt"
8. Appen skriver samtykke til Firestore med tidsstempel og version
9. Bruger sendes videre til velkomstskærm (WelcomeScreen → onboarding)

Hvis brugeren vælger "Afvis og log ud", logges de ud og sendes til login-skærmen.

### B. Eksisterende brugere

Eksisterende brugere, der ikke har `consentGiven === true` i deres Firestore-profil, præsenteres for samtykkeskærmen ved næste login — præcis som nye brugere.

Versionsstyring: Hvis samtykkeerklæringen opdateres (fx ved nye funktioner eller ændringer i privatlivspolitikken), øges `CONSENT_VERSION`-konstanten i appen (fx fra `"1.0"` til `"1.1"`). Brugere med en lavere `consentVersion` i Firestore præsenteres automatisk for den opdaterede samtykkeskærm ved næste login.

### C. Samtykke til SMS-udsendelser (ikke-app-brugere)

Medlemmer, der ikke bruger appen, er ikke dækket af app-samtykkeskærmen. For SMS-udsendelser til disse gælder:

- **Foreningsmedlemskab:** SMS om foreningsaktiviteter til egne aktive medlemmer kan som udgangspunkt ske på baggrund af berettiget interesse (foreningens legitime kommunikationsbehov), forudsat at indholdet er relevant og forventet af modtageren.
- **Bredere udsendelser / markedsføring:** Kræver forudgående, eksplicit samtykke fra modtageren, dokumenteret med dato og metode.
- **Framelding:** Alle SMS-udsendelser bør indeholde en mulighed for framelding (fx "Svar STOP").
- **Log:** Administratorer skal opretholde en log over SMS-udsendelser med dato, indhold og modtagergruppe.

Det anbefales, at SSIF ved sæsonstart 2026/27 indhenter skriftligt samtykke fra alle nuværende medlemmer til SMS-kommunikation via Conventus eller et separat tilmeldingsskema.

### D. Hvad logges og dokumenteres

Følgende gemmes som dokumentation:

| Data | Sted | Formål |
|------|------|--------|
| `consentGiven`, `consentVersion`, `consentTimestamp` | Firestore `users/{uid}` | Bevis for samtykke |
| `emailNotifications` | Firestore `users/{uid}` | Dokumentation for email-præference |
| Push-tilladelse | Brugerens enhed + Firestore `fcmToken` | Bevis for push-samtykke via OS |
| SMS-log (admin) | Separat log (anbefales: Google Sheets eller Firestore) | Overholdelse af markedsføringsloven |

SSIF bør opbevare samtykkedokumentation i mindst 5 år.

---

## Del 4: Versionshistorik

| Version | Dato | Ændring |
|---------|------|---------|
| 1.0 | 27. maj 2026 | Første version |

---

*Sejs-Svejbæk Idrætsforening — CVR 96948859 — kontakt@sejssvejbaek-if.dk*
