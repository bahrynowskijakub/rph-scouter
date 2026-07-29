#!/usr/bin/env bash
#
# Deploy na miejscu, na maszynie docelowej:  sudo /srv/rph-scouter/scripts/deploy.sh
#
# Uruchamiany jako root, ale git i yarn lecą przez runuser jako $APP_USER — nic się nie
# instaluje z prawami roota, a repo nie zmienia właściciela w połowie wdrożenia.
#
# Build musi się dziać TUTAJ, nie na laptopie. better-sqlite3 to modu natywny: node_modules
# zbudowane na x86 nie wystartuje na ARM-ie, a instancja Ampere jest właśnie ARM-em.
set -euo pipefail

APP_DIR=${APP_DIR:-/srv/rph-scouter}
APP_USER=${APP_USER:-rph}
SERVICE=${SERVICE:-rph-scouter}
BRANCH=${BRANCH:-main}
DB_PATH=${DB_PATH:-/var/lib/rph-scouter/scouter.db}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/rph-scouter}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:4000/api/health}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-30}

if [[ $EUID -ne 0 ]]; then
  echo "deploy.sh musi lecieć jako root (systemctl restart). Użyj sudo." >&2
  exit 1
fi

as_app() { runuser -u "$APP_USER" -- "$@"; }
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }

cd "$APP_DIR"

# ── baza przed zmianami ──────────────────────────────────────────────────────────────
# Scouting z turnieju to jedyna rzecz w tym projekcie, której nie da się odtworzyć.
# VACUUM INTO, nie cp: przy WAL kopiowanie samego .db daje plik bez ostatnich zapisów.
step "Backup bazy"
if [[ -f $DB_PATH ]]; then
  if command -v sqlite3 >/dev/null; then
    install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    as_app sqlite3 "$DB_PATH" "VACUUM INTO '$BACKUP_DIR/scouter-$stamp.db'"
    echo "  → $BACKUP_DIR/scouter-$stamp.db"
    # Trzydzieści kopii bazy, która waży ~200 kB. Starsze lecą.
    ls -1t "$BACKUP_DIR"/scouter-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
  else
    echo "  ! brak sqlite3 — pomijam backup. sudo apt install -y sqlite3" >&2
  fi
else
  echo "  (bazy jeszcze nie ma — pierwszy deploy)"
fi

# ── kod ─────────────────────────────────────────────────────────────────────────────
step "Pobranie kodu ($BRANCH)"
before=$(as_app git rev-parse --short HEAD 2>/dev/null || echo '—')
as_app git fetch --prune origin
as_app git reset --hard "origin/$BRANCH"
after=$(as_app git rev-parse --short HEAD)
echo "  $before → $after"

# ── zależności i build ──────────────────────────────────────────────────────────────
# --immutable wywali się, gdyby yarn.lock nie zgadzał się z manifestami; na serwerze
# to jest dokładnie to, czego chcemy.
step "Zależności"
# Yarn 4 przychodzi z corepacka (`sudo corepack enable` raz przy setupie, patrz DEPLOY.md),
# więc shim leży w /usr/local/bin i runuser go widzi.
as_app yarn install --immutable

step "Build frontendu"
# `yarn build` to `tsc -b && vite build` — typy są tu bramką, nie ozdobą.
as_app yarn build

# ── restart ─────────────────────────────────────────────────────────────────────────
step "Restart usługi"
systemctl restart "$SERVICE"

printf '  czekam na %s ' "$HEALTH_URL"
for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    printf '\n\033[1;32m✓ %s działa na %s\033[0m\n' "$SERVICE" "$after"
    exit 0
  fi
  printf '.'
  sleep 1
done

printf '\n\033[1;31m✗ Health check nie odpowiedział w %ss\033[0m\n' "$HEALTH_TIMEOUT" >&2
echo "Ostatnie logi:" >&2
journalctl -u "$SERVICE" -n 40 --no-pager >&2
exit 1
