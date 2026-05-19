FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY calibration ./calibration

RUN pip install --no-cache-dir -e ".[dev]"

ENV PYTHONUNBUFFERED=1
ENV IO_CAM_CALIBRATION_DIR=/app/calibration

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
