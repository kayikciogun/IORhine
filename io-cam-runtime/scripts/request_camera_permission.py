"""macOS kamera izni talep et — Terminal.app içinde çalıştır.

OpenCode sandbox'ından macOS TCC diyalogu görünmüyor. Bu script Terminal.app'de
çalıştırılırsa macOS izin penceresi görünür ve kullanıcı evet/hayır diyebilir.
"""
import AVFoundation
from Foundation import NSRunLoop, NSDefaultRunLoopMode, NSDate

status = AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(
    AVFoundation.AVMediaTypeVideo
)
print(f"Mevcut durum: {status}")
# 0=NotDetermined, 1=Restricted, 2=Denied, 3=Authorized

if status == 3:
    print("Zaten yetkili.")
elif status == 2:
    print("DENIED - Sistem Ayarlari > Gizlilik > Kamera -> Terminal izni acik olsun")
elif status == 0:
    print("Izin talep ediliyor... macOS diyalog penceresi gelmeli.")
    result = [None]

    def handler(granted):
        result[0] = bool(granted)
        print(f"Izin sonucu: granted={granted}")

    AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
        AVFoundation.AVMediaTypeVideo, handler
    )
    loop = NSRunLoop.currentRunLoop()
    end = NSDate.dateWithTimeIntervalSinceNow_(30.0)
    while NSDate.date().compare_(end) < 0 and result[0] is None:
        loop.runMode_beforeDate_(
            NSDefaultRunLoopMode, NSDate.dateWithTimeIntervalSinceNow_(0.1)
        )
    print(f"Final: {result[0]}")