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
        st = await client.get("/api/job/status")
        assert st.json()["phase"] in ("ready", "preparing")
