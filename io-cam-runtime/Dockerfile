# syntax=docker/dockerfile:1.7
# ── Build stage ──────────────────────────────────────────────────────────
# Sadece runtime bağımlılıklarını (dev grubu olmadan) kurmak için kullanılır.
# Bu sayede final imajda pytest/dev paketleri yer almaz.
FROM python:3.11-slim AS builder

WORKDIR /build

# Sistem kütüphaneleri (OpenCV headless için gerekli)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Önce sadece metadata kopyalanır → pip install katmanı cache dostu olur
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    "fastapi>=0.115.0" \
    "uvicorn[standard]>=0.32.0" \
    "pyserial>=3.5" \
    "opencv-python-headless>=4.10.0" \
    "numpy>=2.0.0" \
    "pydantic>=2.9.0" \
    "pydantic-settings>=2.6.0" \
    "python-multipart>=0.0.12" \
    "websockets>=13.0" \
    "ezdxf>=1.3.0"


# ── Runtime stage ───────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Güvenlik: non-root kullanıcı. UID 10001 rastgele seçildi (host ile çakışma
# riski düşük; prod ortamında gerekirse build arg ile değiştirilebilir).
RUN groupadd --system --gid 10001 iorhine \
    && useradd  --system --uid 10001 --gid iorhine --no-create-home --shell /usr/sbin/nologin iorhine

WORKDIR /app

# Sistem kütüphaneleri (yalnızca runtime için gerekli olanlar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Builder'dan site-packages kopyala
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn 2>/dev/null || true

# Uygulama kodu (yalnızca runtime için gereken klasörler)
COPY --chown=iorhine:iorhine pyproject.toml ./
COPY --chown=iorhine:iorhine app ./app
COPY --chown=iorhine:iorhine calibration ./calibration

# Calibration dizini yazılabilir olmalı (runtime'da glue_sheet_state.json vb. yazılır)
RUN chown -R iorhine:iorhine /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    IO_CAM_CALIBRATION_DIR=/app/calibration \
    PATH="/home/iorhine/.local/bin:${PATH}"

USER iorhine

EXPOSE 8000

# Sağlık kontrolü: container ayağa kalktıktan 5 sn sonra /healthz'i yokla
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
