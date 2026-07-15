import threading

import torch
from PIL import Image
from falcon_perception import build_prompt_for_task, load_and_prepare_model, setup_torch_config
from falcon_perception.batch_inference import BatchInferenceEngine, process_batch_and_generate


def worker():
    print("Worker started")
    setup_torch_config()
    assert torch.cuda.is_available(), "CUDA gerekli"
    model, tokenizer, args = load_and_prepare_model(
        hf_model_id="tiiuae/Falcon-Perception",
        backend="torch",
        dtype="bfloat16",
        device="cuda",
        compile=True,
    )
    engine = BatchInferenceEngine(model, tokenizer)
    img = Image.new("RGB", (640, 480))
    prompt = build_prompt_for_task("stone", "detection")
    batch = process_batch_and_generate(
        tokenizer,
        [(img, prompt)],
        max_length=min(4096, int(getattr(args, "max_seq_len", 4096))),
        min_dimension=256,
        max_dimension=512,
    )
    device = model.device
    batch = {k: (v.to(device) if torch.is_tensor(v) else v) for k, v in batch.items()}
    engine.generate(
        **batch,
        max_new_tokens=10,
        temperature=0.0,
        stop_token_ids=[tokenizer.eos_token_id],
        seed=42,
        task="detection",
    )
    print("Worker finished")


t = threading.Thread(target=worker)
t.start()
t.join()
