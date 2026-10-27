# SSIF – trænerværktøj, backoffice og infoskærme

Ét repo, ét build, tre entry points på app.sejssvejbaek-if.dk:
- `/` – trænerværktøjet (erstatter den gamle medlems-app)
- `/admin` – backoffice (bliver som det er)
- `/infoscreen` – infoskærme (bliver som det er)

Scope for trænerværktøjet står i `docs/scope.md`. Læs det før du bygger noget nyt.
Den gamle app er bevaret i git-tagget `v1-gammel-app` som reference.

## Hvad trænerværktøjet er
- Kun for trænere og ledere (rolle fra Conventus). Forældre har intet login.
- Træneren opretter begivenheder (kamp, stævne, event, møde), udtager holdet og sender via mail/SMS.
- Forældre svarer via et personligt link (Kommer / Kommer ikke). Envejskommunikation – ingen chat.

## Faste principper
- Alle Conventus-kald går server-side via PHP i `public/api/`. Ingen nøgler i klienten.
- Telefonnumre gemmes aldrig – de hentes live fra Conventus ved udsendelse.
- Hemmeligheder kommer kun fra GitHub Secrets → `.htaccess` SetEnv. Aldrig hardcodet.
- Alle PHP-endpoints kræver Firebase ID-token med fuld signaturverifikation – undtagen svarsiden for forældre, som kun må registrere svar for sit eget link.
- Svarlinks er lange, tilfældige og udløber efter begivenheden. Et svar registreres kun ved et aktivt tryk, aldrig ved at linket blot åbnes (mailscannere).
- Hver SMS og mail logges i `kommunikation_logs` med hold, afdeling, træner og antal SMS-dele.
- Firestore: brug `getDocs` frem for `onSnapshot`, undtagen hvor træneren skal se svar live (Spark-plan).
- Backoffice og infoskærme må ikke gå i stykker. Rør kun delt kode (PHP, collections, regler), hvis det er nødvendigt, og sig det højt.

## Arbejdsgang
- Vi bygger i små skiver (se `docs/scope.md`). Én skive ad gangen, færdig og testet før den næste.
- PHP kan ikke køre i Vite dev – test sker på live-serveren efter deploy.
- Spørg hvis noget er uklart, frem for at gætte. Foreslå hellere end at bygge stort.
- Skriv brugerflader og beskeder på dansk.
