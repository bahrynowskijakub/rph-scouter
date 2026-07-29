# Wdrożenie — Vercel + Turso

Jeden projekt na Vercelu podaje i frontend, i API. Baza to Turso. Nie ma maszyny, nie ma
systemd, nie ma certyfikatów, nie ma odwrotnego proxy — deploy to `git push`.

```
telefon ──https──▶ Vercel ──┬── /api/*  ──▶ serwis `backend`  (Express, src/app.js) ──▶ Turso
                            └── resztę   ──▶ serwis `frontend` (Vite, statyki z CDN-u)
```

Jeden projekt, dwa **[serwisy](https://vercel.com/docs/services)**. Każdy buduje się osobno
(`frontend` Vitem, `backend` presetem Express), oba jadą w jednym deployu, pod jedną domeną
i z jednym zestawem zmiennych środowiskowych. Ruch rozdzielają rewrite'y z górnego poziomu
`vercel.json` — to one, i tylko one, wystawiają serwis na świat.

**Jedno origin, i to nie kosmetyka.** Frontend woła `/api` relatywnie
(`frontend/src/lib/api.ts:22`), a ciastko admina ma `sameSite: 'lax'`
(`backend/src/routes/auth.js:14`). Dlatego front i API muszą siedzieć pod jedną domeną —
i dlatego ten wariant nie wymaga *żadnej* zmiany w kodzie auth. Rozbicie na dwie domeny
(front na CF Worker, API na Vercelu) wymagałoby `VITE_API_URL`, CORS z credentials
i `sameSite: 'none'` w trzech miejscach.

Pliki: `vercel.json`, `backend/src/app.js`, `backend/scripts/migrate.js`.

Poprzedni runbook — Oracle Cloud, Caddy, systemd — leży w `deploy/DEPLOY-oracle-vm.md`
razem z `deploy/Caddyfile` i `deploy/rph-scouter.service`. Nic z tego nie jest już używane;
zostało, gdybyś kiedyś chciał wrócić na własną maszynę.

---

## 0. Repozytorium

Vercel ciągnie kod z gita, a projekt jeszcze repo nie ma.

```bash
cd ~/apps/personal/rph-scouter
git init -b main
```

**Zanim zrobisz pierwszy commit** zdecyduj o `backend/data/cards.db`. 1,6 MB, nic go już nie
otwiera, i nie jest w `.gitignore`, więc `git add -A` wciągnie go do historii — a z historii
gita 1,6 MB binarki potem nie wyjmiesz bez przepisywania:

```bash
echo "backend/data/cards.db" >> .gitignore
echo "backend/data/*.db*"    >> .gitignore   # lokalna baza dev też nie jedzie do repo
```

```bash
git add -A && git commit -m "RPH Scouter"
gh repo create rph-scouter --private --source=. --push
```

**Uwaga o Hobby:** Vercel nie pozwala połączyć projektu na koncie Hobby z repozytorium
należącym do *organizacji* GitHuba. Repo musi być na Twoim koncie osobistym.

---

## 1. Turso

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login

# Region ma znaczenie: każde tyknięcie pollingu to jeden round trip do bazy, a funkcja
# stoi we Frankfurcie (patrz `regions` w vercel.json). Baza w USA dokłada Atlantyk
# w obie strony do ścieżki, którą cała sala powtarza co pięć sekund.
# Listę kodów pokaże `turso db locations`.
turso db create rph-scouter --location fra

turso db show rph-scouter --url        # → libsql://rph-scouter-<org>.turso.io
turso db tokens create rph-scouter     # → długi token, pokazany raz
```

Zapisz obie wartości — będą potrzebne w dwóch miejscach: lokalnie do migracji i w Vercelu.

Darmowy plan Turso to 5 GB, 500 mln przeczytanych i 10 mln zapisanych wierszy miesięcznie.
Ta aplikacja przy trzydziestu telefonach zużywa około **260 tys. przeczytanych wierszy na
dzień turniejowy** — zapas jest tysiąckrotny. Zajętość: ~1 MB.

---

## 2. Migracja schematu

Schemat nie powstaje już przy starcie aplikacji. Na serverless start zdarza się przy każdym
zimnym isolacie, a kilkanaście `CREATE TABLE IF NOT EXISTS` to kilkanaście round-tripów
stojących między telefonem a pierwszą odpowiedzią. Robi się to raz, z laptopa:

```bash
DB_URL="libsql://rph-scouter-<org>.turso.io" \
DB_AUTH_TOKEN="<token>" \
yarn db:migrate
```

Powinno wypisać `schema up to date` i `seeded 17 archetype presets`. Skrypt jest
idempotentny — puszczenie go drugi raz nic nie psuje, a seed wchodzi tylko do pustej tabeli,
więc nie nadpisze archetypów dodanych później przez admina.

Powtarzaj to po każdej zmianie schematu, **przed** deployem.

---

## 3. Projekt na Vercelu

Import repo w panelu Vercela. Potem, w **Settings → Build and Deployment**, dwie rzeczy,
których `vercel.json` za Ciebie nie ustawi:

| ustawienie | wartość | dlaczego |
| --- | --- | --- |
| Framework Preset | **Services** | tryb serwisów włącza się w panelu, nie w pliku |
| Root Directory | puste (korzeń repo) | tam leży `vercel.json`; z podkatalogu Vercel go nie zobaczy |

Preset **nie** może zostać na Vite. Vite obok Services to dokładnie ten deploy, który pada na:

> Project framework is set to `services`, but no services are declared.

i to samo dostaniesz przy poprawnym `vercel.json`, jeśli Root Directory wskazuje `frontend`
— plik po prostu nie zostaje wczytany. Serwisy są też funkcją za uprawnieniem (*Permissions
Required: Services*); jeśli konto go nie ma, przełącznik nie pomoże.

Reszta budowania zostaje w pliku: klucze `buildCommand`, `installCommand`, `outputDirectory`,
`framework` i `functions` **w trybie serwisów nie są dozwolone na górnym poziomie** — każdy
siedzi w swoim serwisie, żeby miał jednego właściciela.

Environment Variables (Production **i** Preview):

| | |
| --- | --- |
| `DB_URL` | `libsql://rph-scouter-<org>.turso.io` |
| `DB_AUTH_TOKEN` | token z kroku 1 |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | prawdziwe hasło |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `NODE_ENV` | `production` |
| `DEFAULT_EVENT_ID` | `767473` (albo Twoje) |

`CORS_ORIGIN` **nie jest potrzebne** — front i API dzielą origin, więc żądanie nigdy nie
jest cross-origin. Zostaw niewypełnione.

`NODE_ENV=production` włącza `secure: true` na ciastku admina. Vercel daje HTTPS z pudełka,
więc to po prostu zadziała — ale gdybyś kiedykolwiek wystawił to po czystym HTTP,
przeglądarka nie zapisze ciastka i logowanie na `/admin` będzie się odbijać **bez żadnego
komunikatu o błędzie**.

---

## 4. Deploy i smoke test

```bash
git push          # każdy push na main to deploy
```

Ta aplikacja ma ścieżki, które widać tylko na żywym ruchu z dwóch telefonów. Zrób to
**tydzień przed turniejem, nie w dniu**:

- [ ] `/` rysuje listę, chip turnieju ma nazwę wydarzenia
- [ ] `/admin` — logowanie przechodzi
- [ ] admin ustawia ID wydarzenia, lista się przełącza — wszystkie otwarte telefony w ciągu
      jednego tyknięcia pollingu (delta niesie `eventId`, więc same się orientują)
- [ ] **dwa telefony**: zapis decka na jednym pojawia się na drugim w ≤5 s bez odświeżania
- [ ] wyczyszczenie decka propaguje się tak samo
- [ ] telefon, który właśnie zapisał, widzi swój wpis **natychmiast** (odpowiedź mutacji),
      a wiersz nie „mruga" ponownie przy kolejnym tyknięciu pollingu
- [ ] admin klika „Odśwież" → pozostałe telefony przeładowują listę w ciągu ~5 s
      (to `rosterSyncedAt`, nie kursor)
- [ ] tryb samolotowy → wejście na listę pokazuje snapshot z paskiem „zapisana kopia";
      powrót do sieci → lista dogania się sama, bez przeładowania
- [ ] `curl -s "https://twoja-domena/api/participants/delta?since=0"` → JSON z `cursor`,
      a nie `stale` przy każdym wywołaniu
- [ ] `curl -sI https://twoja-domena/ | grep -i robots` → `noindex, nofollow`
- [ ] `curl -sI https://twoja-domena/api/participants | grep -i cache` → `no-cache`
      (**nie** `no-store` — gdyby było `no-store`, reguła nagłówków z `vercel.json`
      nadpisuje trasy i psuje 304-ki na liście)

---

## 5. Praca lokalna

Bez zmian względem tego, co było — z jedną komendą na starcie:

```bash
yarn install
yarn db:migrate      # domyślnie file:backend/data/scouter.db, bez tokenu
yarn dev             # API na :4000, Vite na :5173
```

`yarn dev` nie przechodzi przez rewrite'y — jedno origin robi tu proxy Vite'a
(`frontend/vite.config.ts`), nie Vercel. Żeby sprawdzić sam routing serwisów bez deploya:

```bash
npx vercel dev -L   # -L = wszystko lokalnie, bez logowania do chmury
```

Wypisze `Detected services: frontend [Vite], backend [Express]` i podniesie jedno origin na
:3000 — czyli dokładnie ten routing, który potem robi produkcja. Przy okazji dopisze
`enableGlobalCache: false` do `.yarnrc.yml`; to robota CLI (potrzebuje node_modules bez
odwołań do globalnego cache'u), nie Twoja zmiana — możesz ją cofnąć.

`DB_URL` domyślnie wskazuje lokalny plik, więc dev nie potrzebuje ani Turso, ani sieci
(poza pobraniem rosteru z Ravensburger Play). Ten sam klient obsługuje jedno i drugie —
zmienia się wyłącznie URL.

Chcesz lokalnie pracować na produkcyjnych danych? Ustaw `DB_URL`/`DB_AUTH_TOKEN` w `.env`.
Uważaj: to ta sama baza, na którą patrzy turniej.

---

## 6. Backup

Turso trzyma point-in-time restore (1 dzień na darmowym planie), ale to nie jest kopia
u Ciebie. Przed turniejem i po nim:

```bash
turso db shell rph-scouter .dump > backup/rph-$(date -u +%Y%m%d).sql
```

Odtworzenie do nowej bazy:

```bash
turso db create rph-scouter-restore --location fra
turso db shell rph-scouter-restore < backup/rph-20260729.sql
```

---

## 7. Ile się tego mieści

Darmowy Vercel Hobby daje 1 mln wywołań funkcji i 4 CPU-godziny miesięcznie. Statyki nie
liczą się jako wywołania — wywołania robi tylko `/api/*`, czyli serwis `backend`.

Jedna pozycja przy serwisach wygląda inaczej niż w wariancie z jedną funkcją:
[cennik serwisów](https://vercel.com/docs/services/pricing) liczy bajty zwrócone przez serwis
jako Fast Origin Transfer, *„whether the response is a static file or comes from a function"*.
W praktyce dla tej aplikacji to szum — `/assets/*` jedzie z `max-age=31536000, immutable`,
więc po pierwszym pobraniu odpowiada edge, a nie serwis. Ale to ta jedna liczba, na którą
warto zerknąć po pierwszym turnieju, bo stary wariant miał ją zerową.

| | limit / mc | dzień turniejowy (30 telefonów × 6 h) |
| --- | --- | --- |
| wywołania funkcji | 1 mln | ~130 tys. |
| Active CPU | 4 CPU-h | ~11 CPU-min |
| Turso: przeczytane wiersze | 500 mln | ~260 tys. |

Czyli około **siedmiu dni turniejowych miesięcznie** przy interwale 5 s. Interwał siedzi
w jednym miejscu — `POLL_MS` w `frontend/src/lib/hooks.ts` — i każde jego przepołowienie
podwaja pierwszą kolumnę.

Między turniejami ruch to zero. Nie ma maszyny, którą trzeba pamiętać, żeby wstała, i nie
ma nic, co dostawca uśpi za bezczynność — to jedyna rzecz, o którą stary wariant na Oracle
kazał się martwić na dzień przed turniejem.

---

## Czego nie robić

**Nie dodawaj Cache Rule ani nagłówka cache na `/api/*`.** Zacache'owana delta zamraża
listę na wszystkich telefonach i nic tego nie zgłosi. Reguła nagłówków w `vercel.json`
celowo wyklucza `api/`, żeby trasy same decydowały o swoim `Cache-Control` — lista chce
`no-cache` (rewalidacja i puste 304-ki), delta chce `no-store`.

**Nie przenoś crona na Vercela.** Hobby pozwala na crona **raz na dobę**, a roster wymaga
odświeżania co pięć minut. Dlatego `syncRoster()` jedzie tak, jak jechał: jako efekt
uboczny odczytu listy, opakowany w `waitUntil` (`backend/src/lib/background.js`), żeby
zamrożony isolate nie porzucił zapisu w połowie. Skasowanie interwału odczytu listy
w `hooks.ts` (`ROSTER_REFETCH_MS`) znaczy, że nowe rejestracje nigdy się nie pojawią —
po cichu, przez cały turniej.

**Nie licz na pamięć procesu.** `inFlight` i `lastError` w `lib/roster.js` są teraz per
ciepły isolate, nie per wdrożenie. Degradują się łagodnie (najwyżej dwa identyczne pulle,
albo zgubione ostrzeżenie o nieudanej synchronizacji), ale nic nowego tam nie dokładaj —
to jest dokładnie ten rodzaj stanu, który uniemożliwiał wcześniej wdrożenie SSE.

**Nie zjeżdżaj z `maxDuration` poniżej 30 s.** `RPH_TIMEOUT_MS` to 20 s, a pierwszy odczyt
nieznanego wydarzenia *czeka* na upstream — poniżej 30 s ta jedna ścieżka kończy się
timeoutem. W drugą stronę zapas jest duży: przy fluid compute domyślne 300 s obowiązuje już
i na Hobby, więc te 30 s to celowy **sufit** na runaway, a nie podniesienie limitu.

Siedzi w `services.backend.functions`, pod kluczem `src/app.js`. To nie przypadkowa ścieżka:
cała aplikacja Express kompiluje się do *jednej* funkcji, a `functions` adresuje się wtedy
plikiem entrypointa serwisu. Przeniesienie tego klucza na górny poziom `vercel.json` nie
zadziała — w trybie serwisów `functions` tam nie jest dozwolone.

**Nie wyrzucaj rewrite'u `/(.*)` → `/index.html` z serwisu `frontend`.** To on obsługuje
deep linki (`/admin` po wpisaniu w pasek adresu). Wejście w serwis jest ostateczne: jak nic
w środku nie dopasuje, Vercel **nie** wraca do pozostałych rewrite'ów z górnego poziomu,
tylko zwraca 404 tego serwisu. Kiedyś tę robotę wykonywał rewrite górnego poziomu; teraz
jest o jeden poziom głębiej.
