# IO-CAM Runtime

Python FastAPI backend for vision-guided pick & place. See [IO-CAM-ARCHITECTURE.md](../IO-CAM-ARCHITECTURE.md).

## Local dev

```bash
cd io-cam-runtime
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Set `IO_CAM_MOCK_HARDWARE=1` to run without serial/camera.

## Tests

```bash
pytest
```
