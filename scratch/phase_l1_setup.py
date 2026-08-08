# phase_l1_setup.py
# Phase L1: Environment Setup & Sanity Test
# Run these cells in Google Colab (Runtime -> Change runtime type -> T4 GPU)

# Step 1: Install Unsloth and all compatible dependencies in one step
# !pip install unsloth

import torch
from unsloth import FastLanguageModel

# Step 2: Verify GPU is visible and accessible
print("--- GPU Verification ---")
if not torch.cuda.is_available():
    raise SystemError("CUDA GPU not detected! In Google Colab, go to Runtime -> Change runtime type -> Select T4/L4 GPU.")
else:
    print(f"CUDA Device: {torch.cuda.get_device_name(0)}")
    print(f"VRAM Available: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.2f} GB")

# Step 3: Load Base Model in 4-bit (QLoRA)
max_seq_length = 1024
dtype = None # Auto-detected (float16 on T4, bfloat16 on Ampere+)
load_in_4bit = True

model_name = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"
print(f"\nLoading {model_name} in 4-bit precision...")

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = model_name,
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

# Step 4: Run a Quick Test Generation (Sanity Check)
print("\n--- Running Test Generation ---")
FastLanguageModel.for_inference(model) # 2x faster inference

prompt = "You are a technical interviewer. Ask a brief question about Docker container isolation."
messages = [
    {"role": "system", "content": "You are a senior technical interviewer."},
    {"role": "user", "content": prompt}
]

inputs = tokenizer.apply_chat_template(
    messages,
    tokenize = True,
    add_generation_prompt = True,
    return_tensors = "pt"
).to("cuda")

outputs = model.generate(
    input_ids = inputs, 
    max_new_tokens = 64, 
    use_cache = True,
    temperature = 0.7
)

response_text = tokenizer.batch_decode(outputs)
print("\nModel Output:")
print(response_text[0])
print("\n[Phase L1 Success] Environment is ready and model loads correctly in 4-bit precision!")
