import asyncio
import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ["IO_CAM_MOCK_HARDWARE"] = "1"

from app.main import app  # noqa: E402

CSV = """id,target_x,target_y,target_angle,shape_id
0,10,20,0,SHAPE1
"""


@pytest.mark.asyncio
async def test_job_upload_and_status():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/job",
            data={"csv": CSV},
        )
        assert r.status_code == 200
        assert "jobId" in r.json()
        # P2-C21: deterministic poll — ``phase in ("ready","preparing")`` flaky.
        # ``preparing`` asenkron; ``ready``'ye geçene kadar poll (max 5 sn).
        deadline = asyncio.get_event_loop().time() + 5.0
        phase = None
        while asyncio.get_event_loop().time() < deadline:
            st = await client.get("/api/job/status")
            phase = st.json()["phase"]
            if phase == "ready":
                break
            await asyncio.sleep(0.1)
        assert phase == "ready", f"job did not reach ready phase (last: {phase})"
