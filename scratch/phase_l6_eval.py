# phase_l6_eval.py
# Phase L6: Evaluation & Blind Side-by-Side Comparison

import json
import torch
from unsloth import FastLanguageModel

# 1. Load Trained LoRA Model
print("Loading base model with LoRA adapter...")
max_seq_length = 1024
dtype = None
load_in_4bit = True

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "interviewer_lora_adapter", # Load adapter weights directly
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)
FastLanguageModel.for_inference(model)

# 2. Evaluate on Held-Out Test Set (lora_eval.json)
print("\n--- Running Evaluation on Held-Out Test Set (lora_eval.json) ---")
try:
    with open("lora_eval.json", "r") as f:
        eval_data = json.load(f)
    print(f"Loaded {len(eval_data)} held-out evaluation examples.")
    
    # Sample 3 held-out examples
    for i, sample in enumerate(eval_data[:3]):
        messages = sample["messages"]
        system_content = messages[0]["content"]
        user_content = messages[1]["content"]
        target_gold = messages[2]["content"]
        
        inputs = tokenizer.apply_chat_template([
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content}
        ], tokenize=True, add_generation_prompt=True, return_tensors="pt").to("cuda")
        
        outputs = model.generate(input_ids=inputs, max_new_tokens=80, temperature=0.7)
        pred_text = tokenizer.batch_decode(outputs)[0].split("<|im_start|>assistant")[-1].replace("<|im_end|>", "").strip()
        
        print(f"\n[Eval Sample {i+1}]")
        print(f"  User Input: {user_content.replace(chr(10), ' | ')}")
        print(f"  Target Gold: {target_gold}")
        print(f"  LoRA Output: {pred_text}")
except Exception as e:
    print(f"Held-out eval notice: {e}")

# 3. Eight Realistic Blind Test Cases
test_cases = [
    {
        "day": 12, "title": "Prompt Engineering Fundamentals",
        "classification": "strong",
        "answer": "I use zero-shot for straightforward taxonomy classification, few-shot when I need exact JSON keys, and chain-of-thought to break down multi-step calculations."
    },
    {
        "day": 29, "title": "Monitoring, Logging & Observability",
        "classification": "shallow",
        "answer": "I check logs using console.log and print statements."
    },
    {
        "day": 7, "title": "Embeddings Explained",
        "classification": "partial",
        "answer": "Embeddings turn text into arrays of floating point numbers so you can search them."
    },
    {
        "day": 16, "title": "Retrieval Augmented Generation",
        "classification": "strong",
        "answer": "RAG queries a vector store for top-k chunks, reranks them, and injects them into the context window with citations."
    },
    {
        "day": 8, "title": "Vector Databases in Practice",
        "classification": "off_topic",
        "answer": "I like using React and Tailwind for making nice responsive buttons."
    },
    {
        "day": 28, "title": "Containerization with Docker",
        "classification": "explicit_non_answer",
        "answer": "I don't know anything about Docker containers."
    },
    {
        "day": 21, "title": "Evaluation Frameworks for LLMs",
        "classification": "partial",
        "answer": "We evaluate LLMs by having human judges rate answers on a 1 to 5 scale."
    },
    {
        "day": 4, "title": "Tokenization & Language Models",
        "classification": "shallow",
        "answer": "Tokens are basically words."
    }
]

print("\n" + "="*70)
print("PHASE L6: BLIND SIDE-BY-SIDE COMPARISON GENERATION")
print("="*70)

blind_results = []
for idx, tc in enumerate(test_cases):
    sys_prompt = f"You are an expert technical interviewer. Follow these rules: 1. React first with a 3-8 word conversational beat. 2. Ask a follow-up or transition grounded on Day {tc['day']} ({tc['title']}). 3. Maximum 2 sentences. 4. Omit day numbers from follow-ups."
    u_prompt = f"Classification: {tc['classification']}\nCandidate Answer: {tc['answer']}"
    
    # Generate LoRA reply
    inputs = tokenizer.apply_chat_template([
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": u_prompt}
    ], tokenize=True, add_generation_prompt=True, return_tensors="pt").to("cuda")
    
    outputs = model.generate(input_ids=inputs, max_new_tokens=80, temperature=0.7)
    lora_reply = tokenizer.batch_decode(outputs)[0].split("<|im_start|>assistant")[-1].replace("<|im_end|>", "").strip()
    
    blind_results.append({
        "case_id": idx + 1,
        "day": tc["day"],
        "title": tc["title"],
        "classification": tc["classification"],
        "candidate_answer": tc["answer"],
        "lora_reply": lora_reply
    })

print(f"Generated {len(blind_results)} blind test cases.")
with open("blind_eval_results.json", "w") as f:
    json.dump(blind_results, f, indent=2)
print("Saved blind evaluation cases to blind_eval_results.json. Team can now blind-rate each pair!")
