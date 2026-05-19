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
