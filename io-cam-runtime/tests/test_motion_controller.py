from app.motion.controller import MotionController
from app.motion.gcode_driver import GcodeDriver
from app.motion.mock_driver import MockSerial


def test_home_and_move():
    driver = GcodeDriver.from_serial(MockSerial())
    mc = MotionController(driver)
    mc.home()
    mc.move_xy(10, 20)
    mc.move_z(1)
    mc.vacuum_on()
    mc.vacuum_off()
    mc.rotate_c(45)
    mc.rotate_c_to(0)
    mc.sync()
    # P2-C20: MockSerial.written buffer'ını inspect et — komutların gerçekten
    # gönderildiğini doğrula. Sadece ``ok`` dönmesi komutun gönderildiği anlamına
    # gelmez; write() hiç çağrılmasa da ``ok`` dönebilir (mock default).
    written = driver.ser.written  # type: ignore[attr-defined]
    assert any("G28" in w for w in written), f"home (G28) not sent: {written}"
    assert any("X10" in w and "Y20" in w for w in written), (
        f"move_xy(10,20) not sent: {written}"
    )
    assert any("M106 S255" in w for w in written), f"vacuum_on (M106 S255) not sent: {written}"
    assert any("M107" in w for w in written), f"vacuum_off (M107) not sent: {written}"
    assert any("M400" in w for w in written), f"sync (M400) not sent: {written}"
