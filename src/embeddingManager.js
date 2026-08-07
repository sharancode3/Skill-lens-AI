import { daysByNumber } from './dataManager.js';

// In-memory array of day embeddings: [{ day, title, objectives, embedding: number[] }]
export const dayEmbeddings = [];

// Track if we are using the real cloud API or mock fallback
export let embeddingMode = 'mock'; // 'real' or 'mock'

// Vocabulary for mock fallback
let globalVocabulary = [];
const STOP_WORDS = new Set([
  'and', 'the', 'to', 'of', 'a', 'in', 'your', 'with', 'on', 'for', 'is', 'that', 'this',
  'it', 'an', 'are', 'as', 'at', 'be', 'by', 'how', 'from', 'or', 'which', 'you', 'about'
]);

/**
 * Clean and tokenize a text string.
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Builds vocabulary and constructs mock frequency vectors for each day.
 */
function initializeMockEmbeddings() {
  embeddingMode = 'mock';
  console.log('[EmbeddingManager] Initializing in-memory mock embeddings (keyword overlapping)...');

  const tokenizedDays = [];
  const vocabSet = new Set();

  // 1. Tokenize all days and build a global vocabulary
  for (const [dayNum, dayData] of daysByNumber.entries()) {
    const textToEmbed = `${dayData.title} ${dayData.objectives.join(' ')}`;
    const tokens = tokenize(textToEmbed);
    tokenizedDays.push({ dayNum, dayData, tokens });
    tokens.forEach(token => vocabSet.add(token));
  }

  globalVocabulary = Array.from(vocabSet);
  console.log(`[EmbeddingManager] Mock vocabulary size: ${globalVocabulary.length} words.`);

  // 2. Build normalized frequency vectors
  dayEmbeddings.length = 0; // Clear existing
  for (const item of tokenizedDays) {
    const vector = new Array(globalVocabulary.length).fill(0);
    item.tokens.forEach(token => {
      const idx = globalVocabulary.indexOf(token);
      if (idx !== -1) {
        vector[idx]++;
      }
    });

    // Normalize the vector
    const normalized = normalizeVector(vector);

    dayEmbeddings.push({
      day: item.dayNum,
      title: item.dayData.title,
      objectives: item.dayData.objectives,
      embedding: normalized
    });
  }

  console.log(`[EmbeddingManager] Precomputed ${dayEmbeddings.length} mock vectors.`);
}

/**
 * Normalizes a vector to unit length.
 */
function normalizeVector(vec) {
  let sumSq = 0;
  for (const val of vec) {
    sumSq += val * val;
  }
  const magnitude = Math.sqrt(sumSq);
  if (magnitude === 0) return vec;
  return vec.map(val => val / magnitude);
}

/**
 * Computes cosine similarity between two normalized vectors.
 * Since they are normalized, this is just the dot product.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

/**
 * Startup step that generates embeddings for all 31 curriculum days.
 * Runs once at process startup.
 */
export async function generateEmbeddings() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[EmbeddingManager Warning] GEMINI_API_KEY is not defined in env.');
    initializeMockEmbeddings();
    return;
  }

  console.log('[EmbeddingManager] Initializing Gemini cloud embeddings...');
  try {
    const requests = [];
    const dayMap = []; // Keep track of ordering for response mapping

    for (const [dayNum, dayData] of daysByNumber.entries()) {
      const textToEmbed = `${dayData.title} ${dayData.objectives.join(' ')}`;
      requests.push({
        model: 'models/text-embedding-004',
        content: {
          parts: [{ text: textToEmbed }]
        }
      });
      dayMap.push({ day: dayNum, title: dayData.title, objectives: dayData.objectives });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (HTTP ${response.status}): ${errText}`);
    }

    const data = await response.json();
    if (!data.embeddings || data.embeddings.length !== requests.length) {
      throw new Error('Malformed API response: mismatch in embeddings count');
    }

    dayEmbeddings.length = 0; // Clear existing
    for (let i = 0; i < data.embeddings.length; i++) {
      const values = data.embeddings[i].values;
      // Normalize vector for faster dot product similarity
      const normalized = normalizeVector(values);
      dayEmbeddings.push({
        day: dayMap[i].day,
        title: dayMap[i].title,
        objectives: dayMap[i].objectives,
        embedding: normalized
      });
    }

    embeddingMode = 'real';
    console.log(`[EmbeddingManager] Successfully generated and cached ${dayEmbeddings.length} real embeddings via Gemini API.`);

  } catch (error) {
    console.error('[EmbeddingManager] Failed to load real embeddings. Falling back to mock embeddings.', error.message);
    initializeMockEmbeddings();
  }
}

/**
 * Embeds input text using either mock keyword frequencies or Gemini API,
 * and computes similarity to find top matches.
 * 
 * @param {string} text - The search/query text.
 * @param {Array} excludeDays - Day numbers to exclude.
 * @param {number} topK - Max number of results.
 * @returns {Promise<Array>} Matches array: [{ day, title, similarity }]
 */
export async function findRelatedDays(text, excludeDays = [], topK = 2) {
  if (!text || text.trim() === '') return [];

  // Exclude days set for faster lookups
  const excludeSet = new Set(excludeDays);

  let queryVector = [];

  if (embeddingMode === 'mock') {
    // Generate mock vector
    const tokens = tokenize(text);
    const vector = new Array(globalVocabulary.length).fill(0);
    tokens.forEach(token => {
      const idx = globalVocabulary.indexOf(token);
      if (idx !== -1) {
        vector[idx]++;
      }
    });
    queryVector = normalizeVector(vector);
  } else {
    // Call real Gemini embedding API
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[EmbeddingManager] Switched back to mock search because GEMINI_API_KEY is missing.');
      embeddingMode = 'mock';
      return findRelatedDays(text, excludeDays, topK);
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      if (!data.embedding || !data.embedding.values) {
        throw new Error('Malformed embedContent response shape');
      }

      queryVector = normalizeVector(data.embedding.values);
    } catch (error) {
      console.error('[EmbeddingManager] embedContent API call failed. Falling back to mock similarity computation.', error.message);
      // Fallback temporarily to mock model for this single call
      // We must generate a mock vector of length globalVocabulary.length
      const tokens = tokenize(text);
      const vector = new Array(globalVocabulary.length).fill(0);
      tokens.forEach(token => {
        const idx = globalVocabulary.indexOf(token);
        if (idx !== -1) {
          vector[idx]++;
        }
      });
      queryVector = normalizeVector(vector);
    }
  }

  // Compute similarities
  const matches = [];
  const similarityThreshold = embeddingMode === 'real' ? 0.70 : 0.15;

  for (const item of dayEmbeddings) {
    if (excludeSet.has(item.day)) {
      continue;
    }

    const similarity = cosineSimilarity(queryVector, item.embedding);
    if (similarity >= similarityThreshold) {
      matches.push({
        day: item.day,
        title: item.title,
        similarity: parseFloat(similarity.toFixed(4))
      });
    }
  }

  // Sort descending by similarity score
  matches.sort((a, b) => b.similarity - a.similarity);

  return matches.slice(0, topK);
}
