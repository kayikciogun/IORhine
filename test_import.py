import sys
class Dummy: pass
sys.modules['mod'] = Dummy()
sys.modules['mod']._ai_status = "first"

def test():
    from mod import _ai_status
    return _ai_status

print(test())
sys.modules['mod']._ai_status = "second"
print(test())
