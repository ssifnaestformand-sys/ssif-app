# SSIF Trænerværktøj – Scope v1

Oct 27, 2026 · @Peter

## Formål og målgruppe

Et webværktøj til trænere og ledere i SSIF, der erstatter Facebook-grupper som primær kanal for kampe, stævner, events og møder. Kommunikationen er envejs: træneren sender, forældre svarer med ét tryk.

- Målgruppe: alle med en træner- eller lederrolle i Conventus.
- Forældre er modtagere og har hverken app eller login.

## Brugere og adgang

Trænere logger ind med det nuværende setup: mail, Google-login og Conventus-kobling. Roller og hold udledes alene fra Conventus.

| Rolle | Login | Kan |
| --- | --- | --- |
| Træner/leder | Ja (app) | Oprette begivenheder, udtage, sende, se svar og SMS-forbrug for egne hold |
| Medtræner på samme hold | Ja (app) | Det samme – alle trænere på et hold ser og redigerer hinandens begivenheder |
| Forælder | Nej | Svare via personligt link i mail/SMS |
| Kasserer / forretningsudvalg | Ja (backoffice) | Se SMS-forbrug på tværs af afdelinger og hold |

## Begivenheder og udtagelse

En begivenhed kan være en kamp, et stævne, et event eller et møde. Træneren udtager som udgangspunkt hele holdet, og forældre bekræfter.

1. Træneren opretter en begivenhed: type, titel, dato/tid, sted, mødetid og beskrivelse.
2. Træneren udtager. Som standard er det hele holdet, men enkelte spillere kan fravælges.
3. Træneren kan tilføje ekstra spørgsmål, fx "Kan du køre? Ja/Nej".
4. Træneren vælger svarfrist og kan tilvælge automatisk påmindelse til dem, der ikke har svaret. Træneren bestemmer selv tidspunkt og kanal (mail, SMS eller begge).
5. Træneren sender via mail og/eller SMS.
6. Træneren følger svarene live i appen: kommer, kommer ikke, ikke svaret, samt svar på ekstra spørgsmål.
7. Ændrer en forælder sit svar, vises det tydeligt for træneren (fx markering og tidspunkt for ændringen).

## Forældresvar uden login

Forældre svarer via to knapper i mailen eller SMS'en, "Kommer" og "Kommer ikke". Hver udtaget spiller får ét personligt link pr. begivenhed. Det sendes til den primære mail og/eller det primære telefonnummer, der er tilknyttet spilleren i Conventus. Der er altså ét svar pr. spiller.

- Et tryk åbner en lille bekræftelsesside. Den kræver intet login og har intet at udfylde ud over eventuelle ekstra spørgsmål.
- Bekræftelsessiden viser trænerens ekstra spørgsmål (fx kørsel) og status på de andre udtagne, vist som fornavn + første bogstav i efternavn.
- Svaret kan ændres via samme link indtil svarfristen.
- Linket udløber, når begivenheden er afholdt.
- **Beskyttelse mod falske svar:** Mailsystemer som Outlook kan automatisk åbne links for at scanne dem. Svaret registreres derfor først ved et aktivt tryk på siden og aldrig blot ved at linket åbnes.
- Det er teknisk ikke muligt at svare helt inde i mailen på tværs af mailprogrammer. Bekræftelsessiden skal derfor føles som en kvittering, ikke som en hjemmeside.

## Kommunikation og kanaler

Fase 1 er mail og SMS, og her genbruges det eksisterende setup. Website og infoskærme kommer i fase 2, men datamodellen skal bygges, så en begivenhed kan vises der uden ombygning.

| Kanal | Fase | Bemærkning |
| --- | --- | --- |
| Mail | 1 | Svarknapper i mailen |
| SMS | 1 | Kort tekst + link til svar |
| Website | 2 | Fx holdets kommende begivenheder |
| Infoskærme | 2 | Fx dagens kampe i hallen |

Ud over begivenheder med svar kan træneren sende almindelige beskeder til holdet uden tilmelding, fx aflyst træning.

## SMS-forbrug og backoffice

Der er intet loft på SMS, men forbruget skal være synligt på to niveauer. SMS-udbyderen leverer kun en samlet opgørelse, så systemet logger selv hver afsendt SMS: tidspunkt, hold, afdeling, træner, begivenhed/besked og antal SMS-dele.

- **I appen:** Alle trænere på et hold ser holdets SMS-forbrug, fordelt pr. måned og pr. udsendelse.
- **I backoffice:** Kasserer og forretningsudvalg ser forbruget på tværs af afdelinger og hold med totaler og periodefilter.
- Backoffice lever videre i en slank form. Den rummer kun adgangsstyring og forbrugsoversigt, ikke trænerfunktioner.

## Uden for scope

- Tovejskommunikation: chat, kommentarer og svar fra forældre i fritekst. Udsendelse til andre end den primære kontakt på spilleren.
- Login eller app for forældre.
- Banebooking.
- Medlemmer som generel målgruppe (det var den gamle app).

## Tekniske principper og genbrug

Trænerværktøjet bygges i det eksisterende repo (ssif-app) og erstatter den gamle app som entry point. Backoffice og infoskærme deler build, Firebase-projekt, PHP-endpoints og hemmeligheder med det, så et nyt repo ville kun give dobbeltarbejde.

**Genbruges fra den gamle app:** Conventus-login og profilvalg, hold- og medlems-sync, send-sms.php (GatewayAPI, henter numre live), mail via SMTP, events-collection og udtagelseslogik, kommunikation\_logs (udvides med hold og træner til forbrugsoversigten), backoffice-adgangsstyring.

**Principper (går i CLAUDE.md):**

- Alle Conventus-kald går server-side via PHP. Der ligger ingen nøgler i klienten.
- Telefonnumre og kontaktdata gemmes ikke, men hentes live fra Conventus ved udsendelse.
- Svarlinks er personlige, svære at gætte og udløber.
- Ingen uautentificerede endpoints ud over svarsiden, som kun kan registrere svar for sit eget link.
- Firestore: `getDocs` frem for live-lyttere, undtagen hvor træneren skal se svar live.

## Domæne og udfasning af den gamle app

Trænerværktøjet ligger i roden af **app.sejssvejbaek-if.dk**. Backoffice (/admin) og infoskærme (/infoscreen) bliver, hvor de er. Domænet bruges allerede af CORS, login, den daglige sync og billed-uploads. Svarlinks bruger en kort sti, fx `app.sejssvejbaek-if.dk/s/k8Fq2x`.

Den gamle app har kun været brugt af få personer, som alle er trænere. Den skal derfor ikke lukkes officielt, men blot erstattes:

- [ ] Tag repoet (`v1-gammel-app`) som reference, før noget ændres.
- [ ] Tjek straks, at firebase-service-account.json ikke kan hentes udefra.
- [ ] Fjern de ubrugte filer login.php og holds.php.
- [ ] Erstat sw.js og manifest med trænerværktøjets egne.
- [ ] Fjern endpoints, som kun den gamle app brugte (fx send-verification.php, send-push.php), når trænerværktøjet ikke bruger dem.
- [ ] Stram Firestore-reglerne for reaktioner, support og egne profiler.
- [ ] Ryd fcmToken-felter og eventuelle ikke-træner-konti i users. Backoffice-brugere bliver.

## Byggerækkefølge i skiver

Hver skive virker fra ende til anden og testes på serveren, før den næste startes.

1. Fundament: nyt repo, CLAUDE.md, genbrugt login og Conventus-proxy. Træneren logger ind og ser sine hold.
2. Træneren opretter en begivenhed og udtager holdet.
3. Udsendelse via mail med svarknapper og bekræftelsesside.
4. Træneren ser svar live, inkl. ændrede svar.
5. SMS-udsendelse og forbrugsoversigt pr. hold.
6. Ekstra spørgsmål (fx kørsel) og status på andre udtagne.
7. Svarfrist og automatisk påmindelse.
8. Backoffice: forbrug på tværs af afdelinger og hold.
9. Fase 2: website og infoskærme.
