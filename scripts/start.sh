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
# P2-C25: ``--reload`` varsayılan kapalı (production güvenliği). ``--dev``
# flag'ı ile açılır; production'ta uvicorn --reload kullanılmaz (hot-reload
# overhead + dosya izleyici process'leri).
DEV_MODE=0

RUNTIME_PID=""
FRONTEND_PID=""
RUNTIME_TAIL_PID=""

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
    --dev) DEV_MODE=1 ;;  # P2-C25: --reload + verbose logging
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
  # version_ge "3.11.0" "3.11" → $1 >= $2 ?
  # macOS / BSD ``sort -V`` tutarsız; Python'un standart kütüphanesine
  # devredilir (harici ``packaging`` bağımlılığı yok). Karşılaştırma
  # nokta-sayı tuple'ı üzerinden yapılır; eksik segmentler 0 olarak kabul
  # edilir (PEP 440 sürüm normalleştirmesine uygun).
  python3 - "$1" "$2" <<'PY'
import sys
from sys import version_info as _vi

def _parse(v: str) -> tuple[int, ...]:
    parts: list[int] = []
    for p in v.split("."):
        n = ""
        for ch in p:
            if ch.isdigit():
                n += ch
            else:
                break
        parts.append(int(n) if n else 0)
    # PEP 440: "3.11" → (3, 11, 0)
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts)

a, b = _parse(sys.argv[1]), _parse(sys.argv[2])
sys.exit(0 if a >= b else 1)
PY
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
  # Tek .env — frontend + runtime aynı dosyayı okur (io-cam-runtime/app/config/settings.py).
  local env_file="$ROOT/.env"
  local example_file="$ROOT/.env.example"
  if [[ -f "$env_file" ]]; then
    ok ".env mevcut"
    return
  fi
  if [[ -f "$example_file" ]]; then
    cp "$example_file" "$env_file"
  else
    cat >"$env_file" <<EOF
NEXT_PUBLIC_RUNTIME_URL=${RUNTIME_URL}
EOF
  fi
  ok ".env oluşturuldu (NEXT_PUBLIC_RUNTIME_URL=${RUNTIME_URL})"
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
  if [[ -n "$RUNTIME_TAIL_PID" ]] && kill -0 "$RUNTIME_TAIL_PID" 2>/dev/null; then
    kill "$RUNTIME_TAIL_PID" 2>/dev/null || true
    wait "$RUNTIME_TAIL_PID" 2>/dev/null || true
  fi
  # Orphan tail|grep kalanları (önceki Ctrl+C → çift satır sebebi)
  pkill -f "tail -n 0 -F ${LOG_DIR}/runtime.log" 2>/dev/null || true
  pkill -f "io_cam_vlm_tail.py" 2>/dev/null || true
  if [[ -n "$RUNTIME_PID" ]] && kill -0 "$RUNTIME_PID" 2>/dev/null; then
    kill "$RUNTIME_PID" 2>/dev/null || true
    wait "$RUNTIME_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    # P2-C25 (macOS fix): ``setsid`` kaldırıldı — ``nohup`` ile başlatıldığı için
    # process group yok. Direkt PID kill + npm alt süreçleri pkill ile yakala.
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    # next-server alt süreçlerini de sonlandır
    pkill -f "next-server" 2>/dev/null || true
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
  export OPENCV_AVFOUNDATION_SKIP_AUTH="1"
  if [[ "$MOCK_HARDWARE" -eq 1 ]]; then
    export IO_CAM_MOCK_HARDWARE=1
    warn "Mock hardware: kamera ve seri port simüle edilir"
  else
    unset IO_CAM_MOCK_HARDWARE 2>/dev/null || true
    if [[ "$(uname -s)" == "Darwin" ]]; then
      warn "macOS: Sistem Ayarları → Gizlilik → Kamera → Terminal izni gerekebilir"
    fi
  fi

  log "Runtime başlatılıyor (port ${RUNTIME_PORT})…"
  # P2-C25: ``--reload`` sadece ``--dev`` flag'inde. Production'ta kapalı.
  local reload_flag=""
  if [[ "$DEV_MODE" -eq 1 ]]; then
    reload_flag="--reload"
    warn "Dev mode: --reload açık (production'ta kullanma)"
  fi

  (
    cd "$RUNTIME_DIR"
    export PYTHONUNBUFFERED=1
    exec uvicorn app.main:app $reload_flag --host 0.0.0.0 --port "$RUNTIME_PORT"
  ) >>"$LOG_DIR/runtime.log" 2>&1 &  # P2-C25: ``>`` → ``>>`` append
  RUNTIME_PID=$!
  wait_for_runtime
}

start_frontend() {
  log "Next.js başlatılıyor (port ${FRONTEND_PORT})…"
  # P2-C25 (macOS fix): ``setsid`` Linux-only — macOS'ta yok. Subshell kullanmıyoruz
  # çünkü subshell içinde ``$!`` parent'e propagate olmaz (FRONTEND_PID boş kalır).
  # ``nohup`` + ``&`` ile arka plan. ``disown`` KULLANMIYORUZ çünkü disown job'u
  # shell job table'dan kaldırır ve ``wait $FRONTEND_PID`` anında döner (script biter).
  # Ctrl+C'de ``cleanup`` trap'i ``FRONTEND_PID``'i kill eder; npm alt süreçleri
  # ``pkill -f next-server`` ile yakalanır.
  (
    cd "$ROOT" && \
    export NEXT_PUBLIC_RUNTIME_URL="$RUNTIME_URL" && \
    exec nohup npm run dev:next >>"$LOG_DIR/frontend.log" 2>&1
  ) &
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
  # Dev: tek process ile VLM satırlarını terminale yansıt (pipe orphan → çift satır yok).
  if [[ "$DEV_MODE" -eq 1 ]] && [[ -f "$LOG_DIR/runtime.log" ]]; then
    pkill -f "tail -n 0 -F ${LOG_DIR}/runtime.log" 2>/dev/null || true
    pkill -f "io_cam_vlm_tail.py" 2>/dev/null || true
    ok "Terminalde yalnızca [VLM] / ERROR (tam log: ${LOG_DIR}/runtime.log)"
    (
      # Tek PID — kill güvenilir. İsim io_cam_vlm_tail.py (pkill için).
      exec python3 -u -c "
import sys, time
path = sys.argv[1]
# sys.argv[0] taklidi: process listesinde tanınsın
sys.argv[0] = 'io_cam_vlm_tail.py'
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    f.seek(0, 2)
    while True:
        line = f.readline()
        if not line:
            time.sleep(0.05)
            continue
        if line.startswith('[VLM]') or 'ERROR:' in line or line.startswith('Traceback') or ' CRITICAL' in line:
            sys.stdout.write(line)
            sys.stdout.flush()
" "$LOG_DIR/runtime.log"
    ) &
    RUNTIME_TAIL_PID=$!
  fi
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
