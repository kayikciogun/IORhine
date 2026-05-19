import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ["IO_CAM_MOCK_HARDWARE"] = "1"

from app.main import app  # noqa: E402


@pytest.mark.asyncio
async def test_camera_devices_and_select():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        dev = await client.get("/api/camera/devices")
        assert dev.status_code == 200
        body = dev.json()
        assert "usb" in body
        assert "webcam" not in body
        assert "ndi" not in body

        sel = await client.post(
            "/api/camera/select",
            json={"device_id": "mock:mock"},
        )
        assert sel.status_code == 200

        st = await client.get("/api/camera/status")
        assert st.status_code == 200
        assert st.json()["config"]["kind"] == "mock"
