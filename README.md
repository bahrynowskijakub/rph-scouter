# RPH Scouter

Współdzielony arkusz scoutingowy na turnieje Disney Lorcana. Ciągnie listę zapisanych
zawodników z API Ravensburger Play, a każdy odwiedzający może oznaczyć, jakim deckiem gra
dany gracz — atramenty i opis. Wszystko, co ktoś wpisze, widzą od razu pozostali.

**To aplikacja na telefon.** Używa się jej stojąc na sali, jedną ręką, między rundami —
więc cały interfejs to jeden ekran: dwa pasy chromu (nazwa aplikacji z chipem turnieju,
pod nimi szukajka) i lista graczy. Wersja na desktopie działa, ale to ta sama,
wyśrodkowana kolumna.

```
rph-scouter/
├── backend/        Express + libSQL: proxy do RPH, trwałe dane scoutingowe
│                   (na produkcji serwis Vercela — entrypoint to src/app.js)
│   ├── data/
│   │   └── scouter.db    lokalna baza dev (ignorowana w gicie); produkcja to Turso
│   ├── scripts/
│   │   ├── migrate.js         schemat i seed — raz na deploy, nie przy starcie
│   │   └── hash-password.js   hash wspólnego hasła do .env / Vercela
│   └── src/
└── frontend/       Vite + React + TypeScript + Tailwind v4
```

**Baza to libSQL, czyli SQLite** — lokalnie plik, na produkcji Turso. To ten sam SQL co
zawsze (AUTOINCREMENT, `ON CONFLICT DO UPDATE`, `COLLATE NOCASE`, JSON w kolumnach TEXT);
różnica jest w tym, że sterownik idzie po sieci, więc nic nie jest już synchroniczne. To był
warunek wejścia na platformę bez dysku — patrz `DEPLOY.md`.

## Start

```bash
yarn install
yarn db:migrate   # raz: tworzy schemat i wsiewa archetypy
yarn dev          # API na :4000, frontend na :5173
```

Frontend proxuje `/api` na backend, więc przeglądarka widzi jedno origin.

Domyślnie działa bez żadnej konfiguracji. Przed prawdziwym turniejem skopiuj
`.env.example` do `.env` i ustaw przynajmniej `ACCESS_PASSWORD_HASH`, `ADMIN_PASSWORD`
oraz `JWT_SECRET` (w `NODE_ENV=production` backend odmówi startu bez nich).

Wspólne hasło generuje się tak:

```bash
yarn hash-password       # wpisz hasło, dostaniesz linijkę ACCESS_PASSWORD_HASH='$2b$10$…'
```

**Hasło w `.env` bierz w cudzysłów.** dotenv traktuje niezacytowany `#` jako początek
komentarza, więc `ADMIN_PASSWORD=tajne#1` dojeżdża do backendu jako `tajne` i każde
logowanie odbija się bez żadnej wskazówki dlaczego. `.env` nie jest też obserwowany przez
`node --watch` — po jego zmianie backend trzeba zrestartować ręcznie.

Inne skrypty: `yarn build` (produkcyjny build frontu), `yarn typecheck`, `yarn start`
(sam backend), `yarn hash-password`.

## Wspólne hasło

Cała aplikacja stoi za jednym hasłem, o które pyta się **raz na urządzenie**. Nie ma kont,
maili ani rejestracji: lista to cudze nazwiska i notatki o tym, kto czym gra, a formularz
rejestracyjny przy stole, na którym czeka rozpoczęta runda, nikt nigdy nie wypełni. Hasło
rozdaje organizator tym, którzy mają widzieć listę.

**Hashowanie jest po stronie serwera i nie da się inaczej.** Przeglądarka wysyła hasło
jawnie po TLS, a backend porównuje je z hashem ze zmiennej środowiskowej przez
`bcrypt.compare`. Kuszący wariant „zahashuj w przeglądarce i porównaj dwa hashe” nie działa
z dwóch niezależnych powodów: bcrypt soli każdy hash, więc to samo hasło hashuje się za
każdym razem na inny string i `hash(wpisane) === zapisany` jest **fałszem także dla
poprawnego hasła**; a poza tym drzwi otwiera to, co klient przysyła — hash liczony po
stronie klienta byłby więc po prostu nową nazwą hasła, do podsłuchania i odtworzenia tak
samo. W środowisku leży wyłącznie hash (`ACCESS_PASSWORD_HASH`), którego nie da się
odwrócić; plaintext nie jest zapisany nigdzie.

Pass to podpisane ciasteczko `rph_access` — `httpOnly`, `SameSite=Lax`, `Secure` na
produkcji, 180 dni. Niesie odcisk hasła (HMAC na `JWT_SECRET`), więc **zmiana hasła
unieważnia wszystkie stare wejścia**; bez tego rotacja hasła (bo ktoś odszedł z ekipy, bo
wpadło na grupę) nie wyrzuciłaby nikogo przez następne pół roku. HMAC, a nie zwykły skrót
hasha, z dwóch powodów: skrót solonego hasha zmieniał się przy każdym starcie procesu na
ścieżce `ACCESS_PASSWORD` (czyli pod `node --watch` przy każdym zapisie pliku), a odcisk
jedzie do przeglądarki w tokenie, więc nie ma być skrótem hasła do łamania offline.

Zepsuta konfiguracja **zamyka API**, nie otwiera go: 503 `access_unconfigured` na wszystkim
poza `/api/health` i `/api/access/*` (te dwa muszą odpowiadać, bo właśnie z nich front
dowiaduje się, co jest zepsute), plus odmowa startu w wariancie z VM-ki. Nazwane przypadki:
brak hasha, hash o złym kształcie, plaintext `ACCESS_PASSWORD` na produkcji — i **domyślny
`JWT_SECRET`**, bo pass jest niepodrabialny tylko dzięki temu sekretowi, a w repo leży
wartość zastępcza. Wszystkie cztery sprawdzane są na ścieżce żądania, nie przy starcie:
`index.js` na Vercelu się nie uruchamia (entrypointem jest `app.js`), więc kontrola przy
boocie tam po prostu nie istnieje. Lokalnie odwrotnie — brak hasła to brak bramki,
`yarn dev` działa jak działał.

Ekran bramki nie mruga u tych, którzy już weszli: w `localStorage` zostaje notka
(`rph-scouter:access`), na której front rysuje aplikację od pierwszej klatki i dopiero za
nią potwierdza pass u serwera — dokładnie tak, jak snapshot listy. Podrobienie notki nic nie
daje, bo każde żądanie i tak leci z ciasteczkiem albo dostaje 401 `access_required`, po
którym ekran wraca sam.

**Nieudane** próby są liczone (20 na 10 minut), a poprawne hasło czyści licznik. To nie
kosmetyka: cała ekipa na sali siedzi za jednym NAT-em, więc gdyby liczyły się wszystkie próby,
dwudziesty telefon wpisujący *poprawne* hasło na starcie turnieju dostałby „Za dużo prób.”
i dziesięć minut ciszy.

Adres bierzemy z **prawego** końca `X-Forwarded-For`, nie z lewego. Lewy pisze klient, a Caddy
dokleja prawdziwy peer na końcu tego, co przyszło — więc skrypt podsyłający świeży nagłówek
przy każdym żądaniu miałby świeży limit i limiter nie limitowałby nikogo. `req.ip` też nie
zadziała: bez `trust proxy` to adres proxy (jeden licznik na całą salę), a z nim — ten sam
lewy koniec pisany przez klienta.

Licznik siedzi w pamięci procesu, więc na serverless jest per instancja i najlepiej rozumieć
go jako podniesienie kosztu, nie mur; prawdziwym hamulcem jest samo bcrypt, czyli ~100 ms CPU
na każdą próbę.

## Role

**Odwiedzający** — po wpisaniu wspólnego hasła, bez żadnego konta: widzi listę zawodników,
szuka i **może oznaczać decki**. To celowe: scouting robi cała ekipa, nie jedna osoba.

**Admin** — jeden użytkownik, wchodzi przez `/admin` (za bramką, jak wszystko). Samo wejście
na ten route jest logowaniem; nigdzie w UI nie ma przycisku „Zaloguj”, więc zwykły gość nawet
nie wie, że jest tu konto. Admin ustawia ID wydarzenia, wymusza odświeżenie listy i widzi
historię zmian.

Oba ciasteczka podpisuje ten sam `JWT_SECRET`, więc każde z nich sprawdza swoje `role`/`typ`
— inna nazwa ciasteczka nie jest granicą, twierdzenie w tokenie jest. Pass admina zalicza
się jako pass bramki (admin dowiódł więcej), ale nie odwrotnie.

Domyślne `ADMIN_PASSWORD` na produkcji nie wpuszcza do `/admin` (503 `admin_unconfigured`) —
z tego samego powodu, dla którego domyślny `JWT_SECRET` zamyka bramkę: `index.js`, który miał
tego pilnować przy starcie, na Vercelu nie jest uruchamiany.

Zapisy nie mają już pola „twój nick” — sheet ma tylko atramenty i opis — więc w
`scouting_history` autorstwo sprowadza się do kolumny `actor` (`visitor` albo `admin`).

## Co widać na liście

Lista to **dwie różne rzeczy i tak też jest zbudowana**. Wcześniej było osiemdziesiąt
identycznych kafli, w których te cztery niosące wiedzę niczym nie różniły się od
siedemdziesięciu sześciu pustych.

**Zescoutowany gracz to kafel**: dwie linie — nick i płytki kolorów w jednej, opis pod
spodem na całą szerokość (dwie linie i wielokropek) — uniesiony nad tło i **zmyty kolorami
decka**. Gradient idzie od pierwszego atramentu do drugiego, w tej samej kolejności co
płytki po prawej. Przy nicku nie ma żadnego znacznika: kolor wiersza *jest* deckiem, a nie
raportem o decku obok niego.

**Pusty gracz to wiersz w skorowidzu**: bez wypełnienia, bez zaokrągleń, oddzielony
włoskiem, o połowę niższy (46 px, wciąż ponad minimum dla kciuka), z przerywanym gniazdem
zamiast płytek. Zjechanie z kafli w skorowidz to zmiana faktury, którą czuje się przed
przeczytaniem czegokolwiek.

Efekt uboczny, ale przyjemny: rano ekran jest prawie cały granatowy, a **nabiera koloru
w miarę jak ekipa pracuje**.

Sortowanie jest jedno i nie da się go zmienić: **najpierw zescoutowani**, alfabetycznie po
nicku w każdej grupie, wycofani na końcu swojej grupy (przygaszeni). Nie ma filtrów.

**Nad listą nie ma nagłówka.** Nazwa turnieju jedzie jako chip po prawej stronie paska
z nazwą aplikacji — to kontekst, nie treść: czyta się ją raz przy wejściu i nigdy więcej,
więc nie musi zjadać pionu na telefonie, a przy osiemdziesiątym graczu wciąż tam jest.
Chip bierze elipsę, bo oficjalna nazwa turnieju bywa szersza niż telefon. Licznik
zescoutowanych i pasek postępu poszły wcześniej — podpis pod nagłówkiem, który się już
przeczytało.

Nagłówek czyta tę nazwę z tego samego zapytania co lista, przez `useRosterQuery(false)`
w `lib/hooks.ts`. To `false` jest tam istotne w dwie strony: **nie pobiera** listy samo
z siebie (na `/admin` nie ma ekranu, który by za to zapłacił) i **dzieli komplet opcji**
z listą, w tym `initialData`. React Query honoruje `initialData` tylko przy *tworzeniu*
zapytania, a nagłówek montuje się przed listą — drugi hook, który by to pominął, wygrałby
wyścig i skasował snapshotowi pierwszą klatkę.

**Szukajka to chrome, nie treść.** Idzie od krawędzi do krawędzi bezpośrednio pod
nazwą aplikacji, na własnym jaśniejszym tle, i tam się przykleja. Dwa pasy chromu w dwóch
tonach, potem treść: zawsze wiadomo, gdzie jest narzędzie, i nie konkuruje ono z kaflami
o ten sam słownik zaokrąglonych prostokątów. Sam pasek *jest* polem — cały wysoki na 54 px
obszar łapie tapnięcie. Przy pisaniu zapala się złotą szyną wzdłuż całej dolnej krawędzi
(jedyny moment złota na ekranie listy) i pokazuje po prawej liczbę trafień, bo to jedyne
pytanie, jakie stawia szukanie po 81 nazwiskach.

## Sheet się zwija palcem

Kafel otwiera bottom sheet, który zamyka się rzutem w dół, nie tylko krzyżykiem
(`frontend/src/shared/Sheet.tsx`). Gest jest napisany na surowych zdarzeniach dotyku,
bo sheet musi dać się złapać **z własnej przewijanej treści**, a to działa tylko wtedy,
gdy `touchmove` zdąży zawołać `preventDefault()`, zanim przeglądarka zdecyduje, że to
scroll — czyli przy nasłuchu z `{ passive: false }`. Reszta wynika z tego samego:

- pasek nagłówka ciągnie zawsze; treść oddaje gest dopiero, gdy jest przewinięta na samą
  górę i palec idzie w dół, więc w połowie czytanej notatki nadal się scrolluje;
- pola tekstowe zachowują swoje gesty — inaczej zaznaczanie słowa wyrzucałoby sheet;
- w górę sheet stawia opór pierwiastkowy zamiast ściany (50 px ruchu = 23 px przesunięcia);
- puszczenie zamyka po **dystansie albo po prędkości**, więc szybki flick działa i z 30 px;
- scrim rozjaśnia się proporcjonalnie do przeciągnięcia, więc w połowie gestu już widać
  listę, do której się wraca;
- pozycja leci prosto do węzła DOM — 60 klatek na sekundę przez stan Reacta
  przerenderowywałoby cały formularz pod kciukiem;
- powyżej 600 px sheet jest wyśrodkowanym dialogiem i gest się wyłącza. Myszką nie ma
  czym rzucić.

W środku są dokładnie dwa pola: **kolory** i **opis**. Sześć płytek stoi trzy na trzy,
w dwóch rzędach — płytki to jedyna grafika w aplikacji i w jednym rzędzie schodzą do
rozmiaru miniatur. Sheet i tak nie scrolluje się na telefonie, bo skróciło się pole
opisu, a nie płytki; `overflow` na treści został już tylko jako zawór bezpieczeństwa.
W nagłówku ta sama para składa się na żywo przy każdym tapnięciu.

## Wpisy pojawiają się same

Zapis jednego scouta pojawia się na telefonach pozostałych w ciągu kilku sekund, bez
przeładowania. Mechanizmem jest **polling delty**, nie strumień: co pięć sekund karta podaje
serwerowi kursor, który ostatnio zastosowała, i dostaje jedną z trzech odpowiedzi — nic się
nie ruszyło, oto gracze, których raport się zmienił, albo „przeczytaj listę od nowa".

Serwer: `GET /api/participants/delta` w `backend/src/routes/participants.js` plus kursor
w `backend/src/lib/roster.js`. Klient: `useRosterDelta` w `frontend/src/lib/hooks.ts`.

**Kursorem jest `scouting_history.id`.** Nie licznik w pamięci i nie bufor pierścieniowy —
ta kolumna to AUTOINCREMENT dopisywany w *tej samej transakcji* co każdy zapis i każde
czyszczenie, więc z definicji nie może się rozjechać ze stanem tabeli `scouting`, i
przeżywa restart procesu.

Odpowiedź niesie jeszcze `rosterSyncedAt`. Kursor opisuje wyłącznie scouting, a gracz
zapisujący się przy drzwiach przepisuje wiersze, których żadne id historii nie dotyczy —
zmiana tego znacznika to jedyny sygnał „skład się ruszył, przeczytaj listę".

Delty są zwinięte po graczu (`GROUP BY registration_id`), więc dwadzieścia poprawek jednego
decka to jedna pozycja ze stanem końcowym, nie dwadzieścia. Luka szersza niż 50 graczy,
kursor z innego turnieju albo kursor przed serwerem → `stale` i pełny odczyt. **Czyszczenie
nie ma osobnego kształtu** — to ten sam wiersz z `scouting: null`, dokładnie to, co zwraca
`getRosterEntry` po usunięciu raportu. Jedna ścieżka kodu dla „ten gracz wygląda inaczej".

### Dlaczego nie SSE

Było. Strumień dawał sto milisekund zamiast pięciu sekund i kosztował ~520 linii, z których
samo SSE stanowiło może dwadzieścia. Reszta pilnowała rzeczy istniejących *wyłącznie*
dlatego, że połączenie jest trzymane otwarte: epoka i odtwarzanie przez `Last-Event-ID`,
watchdog liczony na zegarze ściennym (telefon w kieszeni usypia timery, więc licznik tyknięć
raportowałby zdrowy strumień po dziesięciu minutach ciszy), obsługa `visibilitychange`
i bfcache, rozpoznawanie echa własnego zapisu po identyfikatorze karty, `X-Accel-Buffering`
i `flush_interval -1` w proxy, zamykanie strumieni przy wyłączaniu procesu.

Polling nie potrzebuje żadnej z nich, bo **pełny odczyt listy jest zawsze poprawnym
wyjściem**: serwer może o niego poprosić jednym słowem `stale` i nie musi wznawiać sesji,
której nie ma. React Query sam zatrzymuje interwał na karcie bez fokusu i wznawia go przy
powrocie. Zapytanie, które nie doszło, nie jest awarią, tylko tyknięciem do powtórzenia za
pięć sekund.

Najważniejsze nie widać jednak w liczbie linii: lista subskrybentów żyła w pamięci
*procesu*. To ona sprawiała, że druga instancja oznaczała split brain, i ona blokowała
wdrożenie na czymkolwiek bezstanowym. Teraz każde żądanie kończy się odpowiedzią.

### Trzy rzeczy, które wyglądają na zbędne, a nie są

**Odczyt całej listy co 5 minut zostaje.** Wygląda na zduplikowany przez polling delty i nie
jest: `syncRoster()` odpala się *wyłącznie* jako efekt uboczny odczytu HTTP tej listy i nic
innego go nie woła — rozgrzewania przy starcie już nie ma, a darmowy Vercel pozwala na crona
raz na dobę, co nie jest odświeżaniem rosteru. Bez tego interwału nic nigdy nie ściągnęłoby
z Ravensburger Play nowych rejestracji i wycofań — po cichu, przez cały turniej. Sam interwał
jest równy `ROSTER_TTL_MS`, bo częstszy odczyt nie ma czego przynieść; to, że sala
*dowiaduje się* o zmianie składu w ciągu sekund, robi `rosterSyncedAt` w delcie.

**Polluje wyłącznie `useRoster()`.** `useRosterQuery` jest wołane dwa razy na każdej stronie
— przez listę i przez chip turnieju w nagłówku, który renderuje się też na `/admin`. Interwał
uruchomiony w środku tego hooka dałby dwa razy więcej żądań na telefon i odpytywałby listę na
ekranie, gdzie jej nie ma.

**Kursor jeździ w odpowiedzi na `PUT`/`DELETE`, nie tylko w delcie.** Bez tego dwóch scoutów
na jednym graczu potrafi się rozjechać: B czyści decka, delta dociera do A, a chwilę później
wraca własna, wolniejsza odpowiedź A z deckiem, który B właśnie usunął — i tylko telefon A
pokazuje go z powrotem. Odpowiedź starsza niż to, co telefon już zastosował, powoduje
ponowny odczyt zamiast łatki.

**`patchRoster` porównuje wiersz przed zapisem.** Delta zaraportuje zapis, który ta karta
zastosowała chwilę wcześniej z odpowiedzi własnej mutacji. Ponowne wstawienie nie zmieniłoby
danych, ale dałoby liście nową tożsamość obiektu i zrestartowało animację wiersza pod
zamykającym się sheetem. Trzy linijki porównania zastąpiły identyfikator karty, nagłówek
`X-Client-Id` i pole `origin` w ramce.

**`bumpCachedCursor` po tyknięciu, które nic nie załatało.** Historia gracza przeżywa jego
obecność na liście (wycofanie plus synchronizacja), więc delta potrafi przesunąć kursor
i zwrócić pustą tablicę. Bez bezwarunkowego przesunięcia telefon dopytywałby o to samo co
pięć sekund do końca turnieju.

Poza tym: zapis snapshotu do `localStorage` jest zdebouncowany (bez tego każdy cudzy zapis
kosztowałby 8,5 kB `JSON.stringify` i synchroniczny zapis na wątku głównym), a otwarty
bottom sheet trzyma swojego gracza w stanie, żeby delta nie mogła odmontować formularza
z niezapisaną notatką.

### Ile to kosztuje

Jedno „nic się nie ruszyło" to 76 bajtów i **jedno zapytanie**: `pollState()` czyta kursor
i znacznik synchronizacji jednym round-tripem, bo to jest zapytanie, które cała sala
powtarza co pięć sekund, i jego koszt liczy się w wywołaniach sieciowych. Stąd też
`idx_history_cursor (event_id, id DESC)` w migracji — bez niego `MAX(id)` przechodzi
wszystkie wiersze historii eventu: na 200 tys. wierszy 13 ms zamiast 0,006 ms. Na pliku
SQLite to bez znaczenia, na bazie rozliczanej za przeczytane wiersze to cały rachunek.

Z tego samego powodu `changedSince()` robi dwa zapytania, nigdy jednego na gracza —
`getRosterEntry` w pętli było darmowe na pliku i jest pięćdziesięcioma kolejnymi wywołaniami
sieciowymi na bazie zdalnej.

Trzydzieści telefonów przez sześć godzin przy interwale 5 s to ~130 tys. żądań, czyli mniej
więcej siedem dni turniejowych miesięcznie na darmowym Vercelu. Każde przepołowienie
interwału podwaja tę liczbę, a `POLL_MS` w `hooks.ts` jest jedynym miejscem, gdzie się to
ustawia.

Runbook wdrożenia — Turso, zmienne, migracja, smoke test i limity — leży w `DEPLOY.md`.
Poprzedni wariant (własna maszyna, Caddy, systemd) w `deploy/DEPLOY-oracle-vm.md`.

## Skąd się biorą dane

Lista zawodników pochodzi z
`https://api.cloudflare.ravensburgerplay.com/hydraproxy/api/v2/events/{id}/registrations/`.

To API **nie wysyła nagłówka `access-control-allow-origin`**, więc przeglądarka nie może go
zapytać bezpośrednio — dlatego wszystko idzie przez backend. Backend trzyma też lokalną
kopię listy (`ROSTER_TTL_MS`, domyślnie 5 min), żeby aplikacja działała, gdy wifi na sali
padnie: przy nieudanym odświeżeniu pokazuje ostatnią zapisaną wersję z ostrzeżeniem
zamiast pustego ekranu.

Kilka rzeczy, o które to potyka się w praktyce i które są tu obsłużone:

- **Awatary wygasają.** `full_profile_picture_url` to podpisany URL GCS z ważnością ~24 h.
  Nadal go odświeżamy w bazie, ale **nie wysyłamy go do przeglądarki** — lista nie pokazuje
  awatarów, a sam ten URL to było kilkaset bajtów na gracza.
- **Gracz może się wycofać.** Zniknięcie z API nie usuwa wiersza — dostaje `active = 0`,
  więc zescoutowany deck nie przepada. Na liście taki wiersz jest przygaszony i idzie na
  koniec swojej grupy.
- **Dwa różne „imiona”.** `user.best_identifier` to imię, `best_identifier` na poziomie
  rejestracji to nick. Na liście pokazujemy **tylko nick**, ale szukamy po obu — na
  parowaniach wisi imię, a w głowie masz nick.
- **Literówka w ID wydarzenia.** Zanim admin przełączy event, ID jest sprawdzane w API;
  nieistniejące zwraca błąd i nic się nie zmienia.

## Atramenty

Sześć sześciokątnych płytek leży w `frontend/public/inkColors/*.svg` i to one są źródłem
prawdy. `scripts/gen-ink-art.mjs` kompiluje je do `src/shared/inkArt.ts`:

```bash
cd frontend && node scripts/gen-ink-art.mjs   # po każdej przerysowanej płytce
```

Kompiluje, a nie linkuje, bo sześć `<img>` to sześć okazji dla wifi na sali, żeby
narysować bezbarwną listę — a tylko wklejone ścieżki da się z CSS-a odbarwić, co robi
picker: nieklikniętego inka pokazuje w skali szarości, a wybór zalewa go jego własnym
światłem. Generator pilnuje przy okazji, że wszystkie sześć płytek to ten sam
sześciokąt — na tym stoi cały motyw, łącznie z przerywanym gniazdem, które dostaje wiersz
bez decka.

Każdy ink ma trzy odcienie prosto z pliku: `core` (wypełnienie płytki), `-rim` (obrys)
i sam symbol. To **jedyne kolory w całym interfejsie** — reszta to grafit i kość, więc nic
nie konkuruje z deckiem gracza. Dlatego „Zapisz” jest kością słoniową, a nie fioletem.

Disney Lorcana i symbole atramentów są znakami towarowymi Ravensburger AG; ta aplikacja
jest niezależnym narzędziem fanowskim. Stopka na liście mówi dokładnie to.

## Motyw

Jeden, ciemny. Aplikacji używa się na telefonie w źle oświetlonej sali, przełącznika
motywu nikt nie dotykał, a jasny wariant był drugim kompletem każdego koloru do
utrzymania. Nie ma już ani `data-theme`, ani skryptu w `index.html`, który zgadywał motyw
przed pierwszym pikselem, ani Zustanda — store trzymał wyłącznie tę jedną wartość.

Paleta to granatowa czerń (`#0e1127`), a nie neutralny grafit, i drabinka powierzchni jest
celowo ciasna: kafel odróżnia się od tła szeptem jasności, **nigdy obramowaniem**. W całym
interfejsie nie ma ani jednego `border` na karcie, ani jednego cienia rzuconego, ani
jednej poświaty. Jedyny akcent to złoto z logotypu (`#d2b886`) — przycisk zapisu, focus
i ikona szukajki; wszystko inne jest granatem i szarością, dopóki deck nie ma czegoś do
powiedzenia.

Typografia to jedna rodzina, **Outfit** — geometryczny grotesk, self-hostowany w
`public/fonts` (oba subsety, bo lista jest polska). Zero wersalików, zero rozstrzelania,
zdania pisane po ludzku. Poprzednia wersja miała szeryfowy Fraunces do nagłówków
i rozstrzelone kapitaliki na etykietach; czytało się to jak magazyn, a to ma być panel.

## Nie dla wyszukiwarek

Lista to cudze nazwiska i notatki o tym, co ktoś widział przy stole — nic z tego nie
powinno wpaść do indeksu. `index.html` niesie `noindex, nofollow`, a `public/robots.txt`
mówi to samo crawlerom, które nie parsują dokumentu. Trzecia warstwa to nagłówek
`X-Robots-Tag: noindex, nofollow`, którego frontend nie jest w stanie ustawić sam — siedzi
w `vercel.json` i obejmuje wszystko poza `/api/*` i hashowanymi statykami.

## Jak to ma się ładować szybko

Wifi na sali turniejowej jest złe, a listę otwiera się kilkadziesiąt razy dziennie. Stąd:

- **Jedno zapytanie na cały ekran.** `GET /api/participants` zwraca nazwę turnieju i całą
  listę razem. Wcześniej trzeba było `/api/event` na nazwę, `/api/participants` na listę
  i `/api/auth/me` na taby w topbarze — trzy round-tripy przed pierwszym pikselem.
- **Chudy payload.** Endpoint wysyła dokładnie to, co rysuje ekran:
  `registrationId`, `displayName`, `handle`, `active`, `scouting { inks, notes }`. Dla 81
  graczy to **8,5 kB zamiast 94 kB** (−91%); przy pełnej sali 168 osób proporcja jest ta
  sama. Archetypy, tech karty, `confidence`, awatary, rekordy meczowe, kraj, pronouny
  i drużyna zostają w bazie — po prostu nikt ich już nie wyświetla.
- **Snapshot w `localStorage`.** Ostatnia dobra lista siedzi pod kluczem
  `rph-scouter:roster` i jest podawana jako `initialData`, więc drugie wejście rysuje
  graczy w pierwszej klatce i dopiero potem odświeża w tle. Gdy wifi padnie, lista nadal
  jest — z paskiem, który mówi, że to zapisana kopia.
- **Zapis nie przeciąga listy.** `PUT /api/scouting/:id` odpowiada zaktualizowanym
  graczem, a klient łata nim cache w miejscu, zamiast pobierać wszystkie wiersze od nowa.
- **Font lokalnie.** Outfit leży w `frontend/public/fonts` (46 kB na oba subsety), jest
  preloadowany w `index.html` i nic nie wychodzi na zewnątrz.
- **Zero zapytań o grafikę.** Płytki atramentów są w bundlu, favicon to jedyny plik
  obrazkowy, a tło (poświata i heksagonalna kratka) to gradienty CSS, nie tekstura. Cały
  ekran to `index.html` + jeden JS + jeden CSS + fonty.

Backend nadal serwuje listę z własnej bazy i odświeża ją z RPH **za** odpowiedzią
(`ROSTER_TTL_MS`). Odświeżanie idzie przez `background()` z `lib/background.js`, czyli
`waitUntil` — na serverless isolate potrafi zostać zamrożony w chwili odesłania odpowiedzi,
co porzuciłoby zapis rosteru w połowie batcha. Rozgrzewania przy starcie już nie ma: nie ma
„startu", który byłby czegokolwiek wart, a pierwszy odczyt nieznanego wydarzenia i tak
czeka na upstream.

## Zapis jest scalający, nie nadpisujący

`PUT /api/scouting/:id` przyjmuje tylko te pola, które chce zmienić. Klucz **nieobecny**
w payloadzie zostaje taki, jaki był w bazie; `null` czyści go jawnie. Dzięki temu zapis
z dzisiejszego sheeta (`{ inks, notes }`) nie wyciera archetypu ani tech kart, które ktoś
wpisał pod starym UI. Logika siedzi w `parseScouting` w `backend/src/lib/validate.js`.

## Endpointy bez UI

`/api/archetypes` i `/api/stats` działają, ale **nic z frontu ich już nie wywołuje** —
poszły razem z presetami archetypów i widokiem meta. Zostawione świadomie: tabela
`archetypes` jest nietknięta, więc oba ekrany da się przywrócić bez ruszania backendu.

**`/api/cards/search` już nie działa** i to jest świadome cofnięcie powyższej zasady.
Baza 3161 kart ładowała się przy każdym starcie tylko po to, żeby obsłużyć autocomplete
tech kart, którego nie ma w UI od dawna. Poszły `backend/src/lib/cards.js`,
`backend/src/routes/cards.js` i uchwyt do `cards.db` w `db.js`; endpoint zwraca teraz
zwykłe 404 z catch-alla.

Sam plik `backend/data/cards.db` (1,6 MB) **został na dysku** — repo nie ma gita ani
skryptu, który by go odtworzył, więc skasowanie byłoby nieodwracalne. Nic go już nie
otwiera; usuń ręcznie, jeśli chcesz odzyskać miejsce, ale **nie globem** — obok leży żywa
`scouter.db` z całym scoutingiem.

Gdyby autocomplete miał wracać: leciał po `cards.db`, przedruki tej samej karty zwijał
w jeden wynik, a karty legalne w Core Constructed stawiał wyżej. Kolumna `formats`
w `cards.db` opisuje **poprzednią** rotację, więc legalność liczyło się z numerów setów —
oknem po rotacji Setu 13 (lipiec 2026) było `009`–`013`. To zdanie jest teraz jedynym
zapisem tego okna; wcześniej mieszkało w stałych `CORE_SET_MIN` / `CORE_SET_MAX`
w usuniętym pliku.

## API

Bez hasła, bo inaczej nie dałoby się o nie zapytać:

| Metoda | Ścieżka | Opis |
| --- | --- | --- |
| GET | `/api/health` | `{ ok: true }` — smoke test |
| GET | `/api/access/status` | `{ granted, configured }` — pierwsze żądanie każdej wizyty |
| POST | `/api/access/login` | `{ password }` → ciastko `rph_access` |
| POST | `/api/access/logout` | zapomnij to urządzenie (bez UI) |

Za wspólnym hasłem — wszystko poniżej odpowiada `401 access_required` bez ciastka:

| Metoda | Ścieżka | Opis |
| --- | --- | --- |
| GET | `/api/participants` | **nazwa turnieju + cała lista** — jedyne zapytanie ekranu listy |
| PUT | `/api/scouting/:registrationId` | zapis/edycja decka (scalający, patrz wyżej) |
| DELETE | `/api/scouting/:registrationId` | wyczyszczenie wpisu |
| GET | `/api/event` | aktualne wydarzenie + świeżość listy (używa tylko panel admina) |
| POST | `/api/event/refresh` | odświeżenie listy (gość w granicach TTL) |
| GET | `/api/participants/delta?since=` | co się zmieniło od tego kursora — polling ekranu listy |
| GET | `/api/participants/:registrationId` | pełny rekord gracza, ze wszystkimi polami |
| GET | `/api/archetypes` | presety archetypów — bez UI |
| GET | `/api/stats` | rozkład par atramentów, archetypów, tech kart — bez UI |

Dodatkowo tylko admin: `PUT /api/event`, `GET /api/event/lookup/:id`,
`POST|DELETE /api/archetypes`, `GET /api/scouting/history/all`. Logowanie admina
(`/api/auth/*`) też jest za bramką — organizator wpisuje wspólne hasło jak każdy, a w zamian
nikt bez niego nie dobije się nawet do `POST /api/auth/login`, żeby je młócić.

Każdy zapis i każde czyszczenie trafia do `scouting_history` — przy publicznym zapisie
kolumna `actor` to jedyny ślad, kto co zmienił.
