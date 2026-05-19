import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ["IO_CAM_MOCK_HARDWARE"] = "1"

from app.main import app  # noqa: E402


@pytest.mark.asyncio
async def test_glue_sheet_from_planning_and_status():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/glue_sheet/from_planning",
            json={
                "origin_x": 10,
                "origin_y": 20,
                "z": 0.5,
                "cell_size": 20,
                "cols": 5,
                "rows": 2,
            },
        )
        assert r.status_code == 200
        st = await client.get("/api/glue_sheet/status")
        assert st.status_code == 200
        data = st.json()
        assert data["cols"] == 5
        assert data["rows"] == 2
        assert data["total"] == 10
        assert data["cursor"] == 0
