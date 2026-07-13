import time
from app.vision.ai_detect import get_ai_model, ai_snapshot_detect
import numpy as np

get_ai_model()
frame = np.zeros((480, 640, 3), dtype=np.uint8)

for i in range(5):
    objs, out, prompt = ai_snapshot_detect(frame)
    print(f"[{i}] Prompt: {prompt}, Objs: {len(objs)}")
    time.sleep(1)

print("Waiting for ready...")
time.sleep(30)
objs, out, prompt = ai_snapshot_detect(frame)
print(f"Final Objs: {len(objs)}")
