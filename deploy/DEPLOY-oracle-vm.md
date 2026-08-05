# Wdrożenie — Oracle Cloud Always Free

Runbook dla jednej maszyny w Always Free. Za darmo, bezterminowo, region we Frankfurcie
(~30 ms z Polski), i **bez żadnej zmiany w kodzie aplikacji**.

```
telefon ──https──▶ Caddy :443 ──┬── /api/*  ──▶ Node :4000 ──▶ /var/lib/rph-scouter/scouter.db
                                └── resztę   ──▶ /srv/rph-scouter/frontend/dist
```

Caddy jest tym, co robi z dwóch procesów jedno origin. To nie kosmetyka: frontend woła
`/api` relatywnie (`request()` w `frontend/src/lib/api.ts`), a ciastka bramki i admina mają
`sameSite: 'lax'` (`accessCookieOptions` w `backend/src/middleware/access.js`, `cookieOptions`
w `backend/src/routes/auth.js`). Rozdzielenie frontu i backendu na dwie domeny wymagałoby
zmian w obu tych miejscach; jeden reverse proxy nie wymaga żadnej.

Pliki: `deploy/rph-scouter.service`, `deploy/Caddyfile`, `deploy/rph-scouter.env.example`,
`scripts/deploy.sh`.

---

## 0. Zanim wejdziesz na Oracle

Projekt nie ma jeszcze repozytorium, a deploy ciągnie kod z gita.

```bash
cd ~/apps/personal/rph-scouter
git init -b main
git add -A && git commit -m "RPH Scouter"
gh repo create rph-scouter --private --source=. --push
```

**Decyzja o `backend/data/cards.db`.** 1,6 MB, nic go już nie otwiera (README: „Endpointy
bez UI"), ale nie jest dziś w `.gitignore`, więc `git add -A` wciągnie go do historii.
Serwer go nie potrzebuje. Jeśli chcesz go zachować lokalnie i nie w repo:

```bash
echo "backend/data/cards.db" >> .gitignore
```

Zrób to **przed** pierwszym commitem — z historii gita 1,6 MB binarki potem nie wyjmiesz
bez przepisywania.

`.env` i `frontend/dist` są już ignorowane, i tak ma zostać: konfiguracja produkcyjna
mieszka w `/etc/rph-scouter.env`, a `dist` powstaje na serwerze.

---

## 1. Instancja

Przy zakładaniu konta **home region ustaw na Germany Central (Frankfurt)**. Regionu nie da
się potem zmienić, a zasoby Always Free muszą stać w regionie domowym — to jedyna
nieodwracalna decyzja w całym tym pliku.

Compute → Create instance:

| | |
| --- | --- |
| Image | Canonical Ubuntu 24.04 (aarch64) |
| Shape | `VM.Standard.A1.Flex`, **1 OCPU / 6 GB** |
| Boot volume | 50 GB (domyślne) |
| SSH | wgraj swój klucz publiczny — użytkownik to `ubuntu` |

Oracle w czerwcu 2026 obciął darmowy limit ARM z 4 OCPU/24 GB do **2 OCPU/12 GB**. 1/6
zostawia więc miejsce na drugą maszynę, a dla procesu, który je ~80 MB, i tak jest
absurdalnym zapasem. Jeśli tworzenie zwraca **„out of capacity"** — to normalne dla ARM we
popularnych regionach, ponawiaj albo wybierz inną domenę dostępności.

**Zarezerwuj publiczny IP.** Po utworzeniu: Instance → VNIC → IPv4 Addresses → edytuj
publiczny adres → **Reserved**. Jest darmowy, a dzięki temu możesz przebudować maszynę od
zera bez dotykania DNS-u.

---

## 2. Sieć — firewall jest w dwóch miejscach

Klasyczna przyczyna „postawiłem i nie odpowiada": otwarcie tylko jednej z dwóch warstw.

**Warstwa OCI.** Networking → VCN → Subnet → Security List → Add Ingress Rules. Dwie
reguły, stateless **nie**:

| Source | Protocol | Dest. port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**Warstwa maszyny.** Obrazy Ubuntu na OCI mają własne reguły iptables z `REJECT` na końcu
łańcucha `INPUT`. Nowe reguły muszą wejść **nad** nim:

```bash
sudo iptables -L INPUT --line-numbers        # znajdź numer linii z REJECT
sudo iptables -I INPUT <numer-REJECT> -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT <numer-REJECT> -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save               # bez tego reguły giną po reboocie
```

---

## 3. DNS

Rekord `A` z domeny na zarezerwowany IP. Cloudflare jako DNS jest w porządku:

- **szara chmurka (DNS only)** — najprościej, TLS bierze Caddy;
- **pomarańczowa (proxied)** — też działa, i od kiedy realtime to polling delty, nie ma już
  długo otwartego połączenia, które Cloudflare mogłoby zerwać po 100 s bezczynności. Wyłącz
  Rocket Loader i auto-minify. **Nie dodawaj Cache Rule na `/api/*`** — zacache'owany kursor
  to lista, która przestaje się aktualizować, i nic tego nie zgłosi.

Nie masz domeny? Darmowa subdomena z DuckDNS przechodzi wyzwanie HTTP-01 Caddy'ego bez
żadnej dodatkowej konfiguracji.

**HTTPS nie jest opcjonalne.** Przy `NODE_ENV=production` `secure: true` dostają **oba**
ciastka — bramki (`accessCookieOptions` w `backend/src/middleware/access.js`) i admina
(`cookieOptions` w `backend/src/routes/auth.js`). Po czystym HTTP przeglądarka ich nie zapisze,
więc odbijać się będzie nie tylko logowanie na `/admin`, ale **wspólne hasło dla wszystkich** —
i w obu przypadkach **bez żadnego komunikatu o błędzie**. Aplikacja po HTTP jest niedostępna,
nie „mniej bezpieczna”.

---

## 4. Maszyna

```bash
ssh ubuntu@twoj-ip

sudo apt update && sudo apt upgrade -y
# git+curl do deployu, sqlite3 do backupów, build-essential/python3 jako zapas —
# better-sqlite3 to modu natywny i gdyby zabrakło prebuildu na arm64, kompiluje się ze
# źródeł. Bez tych paczek `yarn install` wywali się w połowie.
sudo apt install -y git curl sqlite3 build-essential python3

# Node 24 (ta sama major co lokalnie)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable          # shim yarn 4 w /usr/local/bin, widoczny dla runuser

# Użytkownik usługi. --create-home jest istotne: yarn 4 trzyma globalny cache w $HOME
# i bez niego `yarn install` nie ma gdzie pisać.
sudo useradd --system --create-home --home-dir /home/rph --shell /usr/sbin/nologin rph
sudo install -d -o rph -g rph -m 0755 /srv/rph-scouter
```

`/srv/rph-scouter` musi zostać `0755` — Caddy czyta z niego `frontend/dist` jako
użytkownik `caddy`.

### Kod na serwer

Repo jest prywatne, więc klucz deploy (read-only):

```bash
sudo -u rph ssh-keygen -t ed25519 -N "" -f /home/rph/.ssh/id_ed25519
sudo cat /home/rph/.ssh/id_ed25519.pub
# → GitHub → repo → Settings → Deploy keys → Add, bez write access

sudo -u rph git clone git@github.com:<ty>/rph-scouter.git /srv/rph-scouter
```

---

## 5. Konfiguracja

```bash
sudo cp /srv/rph-scouter/deploy/rph-scouter.env.example /etc/rph-scouter.env
sudo nano /etc/rph-scouter.env        # ACCESS_PASSWORD_HASH, ADMIN_PASSWORD, JWT_SECRET, CORS_ORIGIN
openssl rand -hex 32                  # do JWT_SECRET

sudo chown root:rph /etc/rph-scouter.env
sudo chmod 640 /etc/rph-scouter.env
```

`ACCESS_PASSWORD_HASH` **wygeneruj u siebie na maszynie** (`yarn hash-password` w klonie repo)
i przenieś gotową wartość. Na serwerze ta komenda w tym momencie nie zadziała: repo jest tu
dopiero po `git clone` z kroku 4, a `yarn install` robi `scripts/deploy.sh` dopiero w kroku 7 —
Yarn 4 nie uruchomi skryptu bez stanu instalacji, a sam skrypt zaczyna od `require('bcryptjs')`,
którego jeszcze nie ma na dysku. Po kroku 7 zadziała i tu.

Backend **odmówi startu**, jeśli zostawisz domyślne `ADMIN_PASSWORD` albo `JWT_SECRET`, albo
jeśli `ACCESS_PASSWORD_HASH` będzie brakować bądź nie będzie hashem bcrypta
(`backend/src/index.js`) — to twój test, że plik doszedł. Bez wspólnego hasła API i tak
odpowiadałoby 503 na wszystko poza `/api/health` i `/api/access/*`, więc lepiej dowiedzieć się
o tym z `journalctl` niż z ekranu listy.

Hasło admina bierz w cudzysłów — **dla dotenv**, nie dla systemd. Sprawdzone na systemd 255
(czyli Ubuntu 24.04 z tego przewodnika): w `EnvironmentFile` komentarzem jest tylko `#` na
**początku linii**, `#` w środku wartości zostaje w niej dosłownie, a `$` nie jest rozwijany.
Cudzysłowy systemd zdejmuje, więc są nieszkodliwe i czytelne — ale pułapka z niezacytowanym
`#`, przed którą ostrzega README, dotyczy `.env` czytanego przez dotenv, nie tego pliku.

**Nie kładź na serwerze `.env`.** `backend/src/config.js:2` woła dotenv na katalogu repo;
dotenv nie nadpisze zmiennych, które systemd już ustawił, ale poda każdą, której tam nie
ma. Jeden plik konfiguracji, nie dwa nakładające się.

---

## 6. Usługa i proxy

```bash
sudo cp /srv/rph-scouter/deploy/rph-scouter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable rph-scouter

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp /srv/rph-scouter/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile         # ← podmień rph-scouter.example.com
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 7. Pierwszy deploy

```bash
sudo /srv/rph-scouter/scripts/deploy.sh
```

Skrypt: backup bazy (`VACUUM INTO`, nie `cp` — przy WAL kopia samego `.db` nie ma
ostatnich zapisów) → `git reset --hard origin/main` → `yarn install --immutable` →
`yarn build` → restart → health check na `/api/health`. Jeśli health nie odpowie w 30 s,
wypluwa 40 linii z journala i kończy się błędem.

**Build musi się dziać na serwerze**, nie na laptopie. `better-sqlite3` jest natywny —
`node_modules` zbudowane na x86 nie wystartuje na ARM-ie. Nie rsyncuj `node_modules`.

Każdy kolejny deploy to ta sama jedna komenda.

---

## 8. Smoke test — zrób to tydzień przed turniejem, nie w dniu

Ta aplikacja ma ścieżki, które widać tylko na żywym ruchu z dwóch telefonów:

- [ ] `/` w świeżej karcie pyta o wspólne hasło; złe → „Nieprawidłowe hasło.”, dobre → lista
- [ ] zamknij kartę i wejdź ponownie → **żadnego pytania o hasło** (jeśli pyta za każdym
      razem: sprawdź, czy naprawdę jesteś na HTTPS — bez niego ciastko nie zostaje zapisane)
- [ ] `/` rysuje listę, chip turnieju ma nazwę wydarzenia
- [ ] `/admin` — bramka, a za nią logowanie admina; oba przechodzą
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
- [ ] `sudo /srv/rph-scouter/scripts/deploy.sh` podczas patrzenia na listę → telefony
      dogadzają się same, bez komunikatu o błędzie (nieudane tyknięcie to tylko tyknięcie)
- [ ] `curl -s https://twoja-domena/api/participants` → `401` z `access_required`; goły `curl`
      **nie ma** przechodzić, bo bramka jest w API, nie w ekranie
- [ ] `curl -sI https://twoja-domena/ | grep -i robots` → `noindex, nofollow`

Ostatni curl potrzebuje passa — `$H` to wspólne hasło:

```bash
curl -s -c /tmp/rph.jar -X POST https://twoja-domena/api/access/login \
  -H 'Content-Type: application/json' -d "{\"password\":\"$H\"}"   # → {"granted":true,…}
```

- [ ] `curl -s -b /tmp/rph.jar "https://twoja-domena/api/participants/delta?since=0"` → JSON
      z `cursor`, a nie `stale` przy każdym wywołaniu

---

## 9. Utrzymanie

**Backup nocny.** Kopia na tym samym wolumenie co baza nie jest backupem — `deploy.sh`
robi lokalną migawkę przed każdym wdrożeniem, ale przed turniejem i po nim ściągnij plik
do siebie:

```bash
# crontab -e jako root; % w crontabie trzeba escapować
0 3 * * * /usr/bin/sqlite3 /var/lib/rph-scouter/scouter.db "VACUUM INTO '/var/backups/rph-scouter/nightly-$(date -u +\%Y\%m\%d).db'"

# z laptopa, po turnieju
rsync ubuntu@twoj-ip:/var/backups/rph-scouter/ ./backup/
```

**Logi.** `journalctl -u rph-scouter -f` i `/var/log/caddy/rph-scouter.log`.

**Oracle usypia bezczynne maszyny.** Poniżej 10% CPU *i* 10% sieci przez 7 dni → Oracle
może **zatrzymać** instancję (nie usunąć). Ta aplikacja między turniejami będzie dokładnie
taka. To znaczy jedno: **na dzień przed turniejem sprawdź, czy box stoi** i czy strona
odpowiada. Zarezerwowany IP sprawia, że po ręcznym starcie nie trzeba ruszać DNS-u.

---

## Czego nie robić

**Nie skaluj do dwóch instancji** — ale już tylko z powodu bazy. Aplikacja nie trzyma
niczego w pamięci procesu (to zniknęło razem z SSE), więc druga maszyna nie zgubi już
żadnego powiadomienia. Zostaje plik SQLite: dwie instancje to dwie różne bazy i ciche
rozjechanie danych. Jedna maszyna albo wspólna baza sieciowa.

**Nie stawiaj tego za CDN-em, który cache'uje `/api/*`.** Lista i delta muszą lecieć
z serwera — zacache'owana delta zamraża listę i nic tego nie zgłosi. Statyki — do woli.

**Nie buduj `node_modules` lokalnie.** Patrz sekcja 7.
