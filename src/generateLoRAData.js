import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const CURRICULUM_PATH = path.resolve('curriculum.json');
const OUTPUT_PATH = path.resolve('scratch/lora_dataset.json');

// Helper to delay between API calls to avoid rate limits
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY is not defined in your environment variables. Please add it to generate synthetic dataset.');
    process.exit(1);
  }

  console.log('Loading curriculum data from curriculum.json...');
  const curriculum = JSON.parse(fs.readFileSync(CURRICULUM_PATH, 'utf-8'));
  const days = curriculum.days || [];
  
  if (days.length === 0) {
    console.error('ERROR: No days found in curriculum.json');
    process.exit(1);
  }

  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Target distributions per day: ~12 examples x 31 days = 372 open-ended examples
  const categories = [
    { name: 'strong', count: 3 },               // ~25%
    { name: 'partial', count: 4 },              // ~30-33%
    { name: 'shallow', count: 3 },              // ~25%
    { name: 'off_topic', count: 1 },            // ~8%
    { name: 'explicit_non_answer', count: 1 }   // ~8%
  ];

  const dataset = [];
  console.log(`Starting Phase L2 Synthetic Generation for ${days.length} curriculum days...`);

  const systemPrompt = `You are a synthetic data generator for an AI Technical Interviewer voice adapter model.
Your task is to generate realistic candidate-interviewer dialogue pairs for a specific curriculum topic day.
You must output a JSON object containing:
1. "syntheticAnswer": A realistic candidate response matching the requested classification.
2. "goldReply": A high-quality interviewer response adhering to these strict rules:
   - Begin with a 3-8 word conversational reaction beat matching the candidate's quality:
     * strong: "Right.", "Perfect, exactly.", "Excellent breakdown."
     * partial / shallow: "Hm, okay —", "Fair enough.", "That's part of it, but —"
     * off_topic / explicit_non_answer: "No worries — let's try a different angle.", "Let's pivot here."
   - Follow with a concise technical follow-up or transition question grounded in the day's objectives.
   - Do NOT mention curriculum Day numbers in follow-up questions.
   - Restrict to maximum 2 sentences.
   - NEVER use generic AI filler phrases ("Great job", "I hope this helps", "Certainly!").

Output Schema:
{
  "syntheticAnswer": string,
  "goldReply": string
}`;

  for (const dayItem of days) {
    console.log(`\nGenerating open questions for Day ${dayItem.day}: "${dayItem.title}"...`);
    for (const cat of categories) {
      for (let i = 0; i < cat.count; i++) {
        const userPrompt = `Day: ${dayItem.day}\nTitle: "${dayItem.title}"\nObjectives: ${JSON.stringify(dayItem.objectives)}\nRequested Answer Classification: ${cat.name}`;

        try {
          const res = await callGemini(apiKey, systemPrompt, userPrompt);
          if (res && res.syntheticAnswer && res.goldReply) {
            dataset.push({
              day: dayItem.day,
              title: dayItem.title,
              objectives: dayItem.objectives,
              classification: cat.name,
              syntheticAnswer: res.syntheticAnswer,
              goldReply: res.goldReply,
              messages: [
                {
                  role: 'system',
                  content: `You are an expert technical interviewer conducting a review. Ground your follow-ups strictly on the candidate's last answer and the day's objectives: Day ${dayItem.day} (${dayItem.title}). Follow these rules: 1. React first with a 3-8 word conversational beat. 2. Ask a follow-up or transition. 3. Maximum 2 sentences. 4. Omit day numbers from follow-ups.`
                },
                {
                  role: 'user',
                  content: `Classification: ${cat.name}\nCandidate Answer: ${res.syntheticAnswer}`
                },
                {
                  role: 'assistant',
                  content: res.goldReply
                }
              ]
            });
            process.stdout.write(`+`);
          }
          await sleep(500); // 500ms delay for rate-limits
        } catch (err) {
          process.stdout.write(`x`);
        }
      }
    }
    // Incrementally save progress
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));
  }

  // Supplementary set: MCQ transitions & Diagram Intros (~50 examples)
  console.log(`\n\nGenerating supplementary MCQ & Diagram transitions...`);
  for (let i = 0; i < 25; i++) {
    const randomDay = days[i % days.length];
    
    // MCQ Transition example
    dataset.push({
      day: randomDay.day,
      title: randomDay.title,
      objectives: randomDay.objectives,
      classification: 'mcq_transition',
      syntheticAnswer: 'Choice 2: Incorrect option selected',
      goldReply: `Not quite — it's actually about ${randomDay.objectives[0] || randomDay.title}. Let's look at why that matters.`,
      messages: [
        {
          role: 'system',
          content: `You are an expert technical interviewer conducting a review for Day ${randomDay.day} (${randomDay.title}). React with concise feedback on MCQ answer choices.`
        },
        {
          role: 'user',
          content: `Classification: mcq_transition\nCandidate Answer: Choice 2: Incorrect option selected`
        },
        {
          role: 'assistant',
          content: `Not quite — it's actually about ${randomDay.objectives[0] || randomDay.title}. Let's look at why that matters.`
        }
      ]
    });

    // Diagram intro example
    dataset.push({
      day: randomDay.day,
      title: randomDay.title,
      objectives: randomDay.objectives,
      classification: 'diagram_intro',
      syntheticAnswer: 'Ready for diagram critique.',
      goldReply: `Right. Please examine the architecture diagram above and identify the primary structural bottleneck or misconfiguration.`,
      messages: [
        {
          role: 'system',
          content: `You are an expert technical interviewer conducting a review for Day ${randomDay.day} (${randomDay.title}). Introduce diagram critiques succinctly.`
        },
        {
          role: 'user',
          content: `Classification: diagram_intro\nCandidate Answer: Ready for diagram critique.`
        },
        {
          role: 'assistant',
          content: `Right. Please examine the architecture diagram above and identify the primary structural bottleneck or misconfiguration.`
        }
      ]
    });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));
  console.log(`\nPhase L2 Data generation complete! Total ${dataset.length} examples saved to: ${OUTPUT_PATH}`);
}

async function callGemini(apiKey, systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\nInput Data:\n${userPrompt}` }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`API returned HTTP ${response.status}`);
  }

  const json = await response.json();
  const text = json.candidates[0].content.parts[0].text;
  return JSON.parse(text);
}

main().catch(console.error);
