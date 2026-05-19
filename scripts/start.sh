#!/usr/bin/env bash
# IO-CAM — tüm uygulamayı kurar ve başlatır (Next.js + Python runtime).
#
# Kullanım:
#   ./scripts/start.sh              # normal (gerçek kamera / seri port)
#   ./scripts/start.sh --mock       # kamera ve motion mock
#   ./scripts/start.sh --install    # sadece bağımlılıkları kur, çık
#   ./scripts/start.sh --help
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/io-cam-runtime"
VENV_DIR="$RUNTIME_DIR/.venv"
LOG_DIR="$ROOT/.logs"
RUNTIME_PORT="${RUNTIME_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-9002}"
RUNTIME_URL="http://127.0.0.1:${RUNTIME_PORT}"

MOCK_HARDWARE=0
INSTALL_ONLY=0
SKIP_INSTALL=0
SKIP_RUNTIME=0
SKIP_FRONTEND=0

RUNTIME_PID=""
FRONTEND_PID=""

usage() {
  cat <<'EOF'
IO-CAM başlatıcı

  ./scripts/start.sh [seçenekler]

Seçenekler:
  --mock              IO_CAM_MOCK_HARDWARE=1 (kamera/seri port olmadan)
  --install           Bağımlılıkları kur ve çık
  --no-install        npm/pip kurulumunu atla
  --skip-runtime      Sadece Next.js
  --skip-frontend     Sadece Python runtime
  --help              Bu metin

Ortam değişkenleri:
  RUNTIME_PORT        Varsayılan 8000
  FRONTEND_PORT       Varsayılan 9002 (npm run dev zaten 9002 kullanır)

Adresler:
  Planlama:    http://localhost:9002/
  Üretim:      http://localhost:9002/production
  Runtime API: http://localhost:8000/health
EOF
}

log()  { printf '\033[1;36m▶\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mock) MOCK_HARDWARE=1 ;;
    --install) INSTALL_ONLY=1 ;;
    --no-install) SKIP_INSTALL=1 ;;
    --skip-runtime) SKIP_RUNTIME=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    -h|--help) usage; exit 0 ;;
    *) err "Bilinmeyen seçenek: $1"; usage; exit 1 ;;
  esac
  shift
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Gerekli komut bulunamadı: $1"
    exit 1
  fi
}

version_ge() {
  # version_ge "3.11.0" "3.11"
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

check_prerequisites() {
  need_cmd node
  need_cmd npm
  need_cmd python3
  need_cmd curl

  local node_major
  node_major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$node_major" -lt 20 ]]; then
    err "Node.js 20+ gerekli (mevcut: $(node -v))"
    exit 1
  fi

  local pyver
  pyver="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  if ! version_ge "$pyver" "3.11.0"; then
    err "Python 3.11+ gerekli (mevcut: $pyver)"
    exit 1
  fi
  ok "Node $(node -v), Python $pyver"
}

ensure_env_local() {
  local env_file="$ROOT/.env.local"
  if [[ -f "$env_file" ]]; then
    ok ".env.local mevcut"
    return
  fi
  cat >"$env_file" <<EOF
# Otomatik oluşturuldu — scripts/start.sh
NEXT_PUBLIC_RUNTIME_URL=${RUNTIME_URL}
EOF
  ok ".env.local oluşturuldu (NEXT_PUBLIC_RUNTIME_URL=${RUNTIME_URL})"
}

install_frontend() {
  log "Frontend bağımlılıkları (npm)…"
  cd "$ROOT"
  # Mevcut node_modules varsa npm install (daha güvenli); temiz klon için npm ci.
  if [[ -d node_modules ]] && [[ -n "$(ls -A node_modules 2>/dev/null)" ]]; then
    npm install --no-audit --no-fund
  elif [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  ok "npm install tamam"
}

install_runtime() {
  log "Runtime bağımlılıkları (Python venv)…"
  if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR"
    ok "venv oluşturuldu: $VENV_DIR"
  fi
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  python -m pip install -U pip wheel -q
  pip install -e "${RUNTIME_DIR}[dev]" -q
  ok "pip install -e io-cam-runtime[dev] tamam"
}

install_all() {
  if [[ "$SKIP_INSTALL" -eq 0 ]]; then
    install_frontend
    install_runtime
  else
    warn "Kurulum atlandı (--no-install)"
  fi
  ensure_env_local
  mkdir -p "$LOG_DIR"
}

cleanup() {
  local code=$?
  if [[ -n "$RUNTIME_PID" ]] && kill -0 "$RUNTIME_PID" 2>/dev/null; then
    kill "$RUNTIME_PID" 2>/dev/null || true
    wait "$RUNTIME_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  # uvicorn --reload alt süreçleri
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  exit "$code"
}

trap cleanup EXIT INT TERM

wait_for_runtime() {
  local i
  for i in $(seq 1 45); do
    if curl -sf "${RUNTIME_URL}/health" >/dev/null 2>&1; then
      ok "Runtime hazır (${RUNTIME_URL}/health)"
      return 0
    fi
    sleep 1
  done
  err "Runtime ${RUNTIME_URL} adresinde yanıt vermedi (45 sn)"
  if [[ -f "$LOG_DIR/runtime.log" ]]; then
    warn "Son runtime log satırları:"
    tail -n 20 "$LOG_DIR/runtime.log" >&2 || true
  fi
  return 1
}

start_runtime() {
  mkdir -p "$LOG_DIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  export IO_CAM_CORS_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"
  if [[ "$MOCK_HARDWARE" -eq 1 ]]; then
    export IO_CAM_MOCK_HARDWARE=1
    warn "Mock hardware: kamera ve seri port simüle edilir"
  else
    unset IO_CAM_MOCK_HARDWARE 2>/dev/null || true
    if [[ "$(uname -s)" == "Darwin" ]]; then
      warn "macOS: Sistem Ayarları → Gizlilik → Kamera → Terminal/Python izni gerekebilir"
    fi
  fi

  log "Runtime başlatılıyor (port ${RUNTIME_PORT})…"
  (
    cd "$RUNTIME_DIR"
    exec uvicorn app.main:app --reload --host 0.0.0.0 --port "$RUNTIME_PORT"
  ) >"$LOG_DIR/runtime.log" 2>&1 &
  RUNTIME_PID=$!
  wait_for_runtime
}

start_frontend() {
  log "Next.js başlatılıyor (port ${FRONTEND_PORT})…"
  (
    cd "$ROOT"
    export NEXT_PUBLIC_RUNTIME_URL="$RUNTIME_URL"
    exec npm run dev
  ) 2>&1 | tee "$LOG_DIR/frontend.log" &
  FRONTEND_PID=$!
}

print_banner() {
  cat <<EOF

╔══════════════════════════════════════════════════════════╗
║  IO-CAM çalışıyor                                        ║
╠══════════════════════════════════════════════════════════╣
║  Planlama:     http://localhost:${FRONTEND_PORT}/              ║
║  Üretim:       http://localhost:${FRONTEND_PORT}/production    ║
║  Runtime API:  ${RUNTIME_URL}                   ║
║  Loglar:       ${LOG_DIR}/                          ║
╚══════════════════════════════════════════════════════════╝

Durdurmak için Ctrl+C

EOF
}

main() {
  cd "$ROOT"
  log "IO-CAM başlatıcı"
  check_prerequisites
  install_all

  if [[ "$INSTALL_ONLY" -eq 1 ]]; then
    ok "Kurulum tamam (--install)"
    trap - EXIT INT TERM
    exit 0
  fi

  if [[ "$SKIP_RUNTIME" -eq 0 ]]; then
    start_runtime
  fi

  if [[ "$SKIP_FRONTEND" -eq 0 ]]; then
    start_frontend
  fi

  print_banner

  if [[ -n "$FRONTEND_PID" ]]; then
    wait "$FRONTEND_PID"
  elif [[ -n "$RUNTIME_PID" ]]; then
    warn "Sadece runtime çalışıyor; log: tail -f $LOG_DIR/runtime.log"
    wait "$RUNTIME_PID"
  fi
}

main "$@"
