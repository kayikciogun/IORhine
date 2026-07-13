import threading
import time
from falcon_perception import load_and_prepare_model
from falcon_perception.mlx.batch_inference import BatchInferenceEngine, process_batch_and_generate
from PIL import Image

def worker():
    print("Worker started")
    model, processor, args = load_and_prepare_model(hf_model_id="tiiuae/Falcon-Perception", backend="mlx", dtype="float16")
    engine = BatchInferenceEngine(model, processor)
    img = Image.new("RGB", (640, 480))
    from falcon_perception import build_prompt_for_task
    prompt = build_prompt_for_task("stone", "detection")
    batch = process_batch_and_generate(processor, [(img, prompt)], max_length=args.max_seq_len, min_dimension=256, max_dimension=768, patch_size=args.spatial_patch_size, merge_size=1)
    engine.generate(**batch, max_new_tokens=10, task="detection")
    print("Worker finished")

t = threading.Thread(target=worker)
t.start()
t.join()
