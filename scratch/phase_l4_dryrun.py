# phase_l4_dryrun.py
# Phase L4: LoRA Hyperparameter Configuration & 1-Step Dry Run

import torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# 1. Load Base Model in 4-bit
max_seq_length = 1024
dtype = None
load_in_4bit = True

model_name = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"

print(f"Loading {model_name}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = model_name,
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

# 2. Configure LoRA Parameters (Rank 16, Alpha 16)
print("\nConfiguring LoRA Adapter...")
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, # Modest rank for voice/style tuning
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth", # Crucial for free-tier Colab memory
    random_state = 3407,
)

# 3. Load Cleaned Dataset (from Phase L3)
import os
train_file = "scratch/lora_train.json" if os.path.exists("scratch/lora_train.json") else "lora_train.json"
dataset = load_dataset("json", data_files=train_file, split="train")

def format_prompts(examples):
    formatted = []
    for msg_list in examples["messages"]:
        text = tokenizer.apply_chat_template(msg_list, tokenize=False, add_generation_prompt=False)
        formatted.append(text)
    return { "text" : formatted }

dataset = dataset.map(format_prompts, batched=True)

# 4. Configure Trainer with 1 Step for Dry-Run
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4, # Effective batch size = 8
        warmup_steps = 1,
        max_steps = 1, # 1 STEP DRY-RUN ONLY
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 1,
        optim = "adamw_8bit",
        seed = 3407,
        output_dir = "dryrun_outputs",
    ),
)

# 5. Execute 1-step Dry Run
print("\n--- Running 1-Step Dry Run (OOM Check) ---")
dryrun_stats = trainer.train()

print("\n[Phase L4 Success] 1-step dry run completed without OOM error!")
print("Memory is within budget. Ready for full training run in Phase L5.")
