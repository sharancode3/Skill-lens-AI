import fs from 'fs';
import path from 'path';

const INPUT_PATH = path.resolve('scratch/lora_dataset.json');
const TRAIN_PATH = path.resolve('scratch/lora_train.json');
const EVAL_PATH = path.resolve('scratch/lora_eval.json');

// Banned phrases from Phase F5 tone constraints
const BANNED_PHRASES = [
  "great job", "awesome", "hello candidate", "welcome to", "i hope this helps",
  "certainly", "as an ai", "let's dive into", "thank you for answering",
  "congratulations", "good answer", "nice explanation", "i understand that"
];

function cleanAndFormatDataset() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`ERROR: Raw dataset not found at ${INPUT_PATH}. Please run src/generateLoRAData.js first.`);
    process.exit(1);
  }

  console.log('Loading raw dataset for Phase L3 cleaning pass...');
  const rawData = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
  console.log(`Initial raw examples count: ${rawData.length}`);

  const cleaned = [];
  const seenReplies = new Set();
  let bannedCount = 0;
  let dupCount = 0;

  for (const item of rawData) {
    const gold = (item.goldReply || '').trim();
    const lowerGold = gold.toLowerCase();

    // 1. Filter out replies containing banned phrases
    const hasBanned = BANNED_PHRASES.some(phrase => lowerGold.includes(phrase));
    if (hasBanned) {
      bannedCount++;
      continue;
    }

    // 2. Filter out exact cross-topic duplicate replies
    if (seenReplies.has(lowerGold)) {
      dupCount++;
      continue;
    }
    seenReplies.add(lowerGold);

    // 3. Format strictly matching production inference format
    const formattedItem = {
      messages: [
        {
          role: 'system',
          content: `You are an expert technical interviewer. Follow these rules: 1. React first with a 3-8 word conversational beat. 2. Ask a follow-up or transition grounded on Day ${item.day} (${item.title}). 3. Maximum 2 sentences. 4. Omit day numbers from follow-ups.`
        },
        {
          role: 'user',
          content: `Classification: ${item.classification}\nCandidate Answer: ${item.syntheticAnswer}`
        },
        {
          role: 'assistant',
          content: gold
        }
      ]
    };

    cleaned.push(formattedItem);
  }

  console.log(`\n--- Cleaning Pass Statistics ---`);
  console.log(`Removed with banned phrases: ${bannedCount}`);
  console.log(`Removed duplicate replies:    ${dupCount}`);
  console.log(`Remaining clean examples:     ${cleaned.length}`);

  // Shuffle dataset deterministically
  cleaned.sort(() => Math.random() - 0.5);

  // 4. Split into 90% train and 10% held-out eval set
  const evalCount = Math.max(30, Math.floor(cleaned.length * 0.1));
  const evalSet = cleaned.slice(0, evalCount);
  const trainSet = cleaned.slice(evalCount);

  fs.writeFileSync(TRAIN_PATH, JSON.stringify(trainSet, null, 2));
  fs.writeFileSync(EVAL_PATH, JSON.stringify(evalSet, null, 2));

  console.log(`\nSuccessfully formatted and saved:`);
  console.log(`  Train set: ${trainSet.length} examples saved to -> ${TRAIN_PATH}`);
  console.log(`  Eval set:  ${evalSet.length} examples saved to  -> ${EVAL_PATH}`);
}

cleanAndFormatDataset();
