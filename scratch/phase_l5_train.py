# phase_l5_train.py
# Phase L5: Full Training Run with Loss Tracking and LoRA Adapter Export

import torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# 1. Configuration & 4-bit Loading
max_seq_length = 1024
dtype = None # Auto-detected (Float16 on T4, Bfloat16 on Ampere+)
load_in_4bit = True

model_name = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"

print(f"Loading base model: {model_name}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = model_name,
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

# 2. Inject LoRA Adapter Matrices
print("Injecting LoRA adapters (Rank 16, Alpha 16)...")
model = FastLanguageModel.get_peft_model(
    model,
    r = 16,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
)

# 3. Load Formatted Training and Eval Datasets
print("Loading train and eval datasets...")
import os
train_file = "scratch/lora_train.json" if os.path.exists("scratch/lora_train.json") else "lora_train.json"
eval_file = "scratch/lora_eval.json" if os.path.exists("scratch/lora_eval.json") else "lora_eval.json"

train_dataset = load_dataset("json", data_files=train_file, split="train")
eval_dataset = load_dataset("json", data_files=eval_file, split="train")

def format_prompts(examples):
    formatted = []
    for msg_list in examples["messages"]:
        text = tokenizer.apply_chat_template(msg_list, tokenize=False, add_generation_prompt=False)
        formatted.append(text)
    return { "text" : formatted }

train_dataset = train_dataset.map(format_prompts, batched=True)
eval_dataset = eval_dataset.map(format_prompts, batched=True)

# 4. Set Up SFTTrainer with Loss Logging
print("Configuring SFTTrainer...")
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = train_dataset,
    eval_dataset = eval_dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4, # Effective batch size = 8
        warmup_steps = 5,
        max_steps = 60, # ~2-3 epochs across ~300 examples
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 1, # Log loss every step to monitor convergence
        eval_strategy = "steps",
        eval_steps = 15, # Evaluate loss every 15 steps
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "lora_training_outputs",
        save_strategy = "no"
    ),
)

# 5. Kick off Training
print("\n" + "="*50)
print("STARTING FULL LORA TRAINING RUN")
print("Expected time: 20-35 minutes on Colab T4 GPU")
print("="*50 + "\n")

trainer_stats = trainer.train()

# 6. Save Lightweight LoRA Adapter (~20-50MB)
adapter_output_dir = "interviewer_lora_adapter"
print(f"\nTraining complete! Saving LoRA adapter weights to: {adapter_output_dir}...")
model.save_pretrained_lora(adapter_output_dir)
tokenizer.save_pretrained(adapter_output_dir)

print("\n[Phase L5 Complete] Training run finished successfully and adapter checkpoint saved.")
