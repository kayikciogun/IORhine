from app.motion.gcode_driver import GcodeDriver, MarlinError
from app.motion.mock_driver import MockSerial


def test_send_ok():
    driver = GcodeDriver.from_serial(MockSerial())
    lines = driver.send("G28")
    assert any("ok" in l.lower() for l in lines)


def test_send_empty():
    driver = GcodeDriver.from_serial(MockSerial())
    assert driver.send("") == []
