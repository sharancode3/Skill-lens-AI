# phase_l7_export.py
# Phase L7: GGUF Model Export for Ollama Local Serving

import torch
from unsloth import FastLanguageModel

print("Loading trained LoRA adapter for GGUF export...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "interviewer_lora_adapter",
    max_seq_length = 1024,
    dtype = None,
    load_in_4bit = True,
)

# Export directly to 4-bit GGUF format for Ollama
export_dir = "interviewer_gguf"
print(f"Merging weights and exporting GGUF (q4_k_m) to {export_dir}...")
model.save_pretrained_gguf(export_dir, tokenizer, quantization_method = "q4_k_m")

print(f"\n[Phase L7 Success] Model exported to {export_dir}/")
print("To import into local Ollama on your machine:")
print("1. Download the exported .gguf file to your machine.")
print("2. Create a Modelfile with: FROM ./interviewer-q4_k_m.gguf")
print("3. Run: ollama create interviewer -f Modelfile")
print("4. Set ENABLE_LORA_REPLY=true and LORA_MODEL_NAME=interviewer in your .env file.")
