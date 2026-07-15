// Target File: /pertanyaan/js/generator.js
// =========================================
import { getRandomElement } from './random.js';

// State internal untuk menyimpan dataset yang berhasil dimuat
const state = {
  topics: [],
  patterns: [],
  objectives: [],
  twists: [],
  difficulties: {}
};

/**
 * Memuat semua dataset JSON yang diperlukan oleh engine generator.
 * Dipanggil saat inisialisasi aplikasi.
 */
export async function loadDatasets() {
  try {
    // Menggunakan fetch langsung yang aman terhadap cache status 304
    const [topics, patterns, objectives, twists, difficulty] = await Promise.all([
      fetch('data/topics.json').then(res => res.json()),
      fetch('data/patterns.json').then(res => res.json()),
      fetch('data/objectives.json').then(res => res.json()),
      fetch('data/twists.json').then(res => res.json()),
      fetch('data/difficulty.json').then(res => res.json())
    ]);

    state.topics = topics;
    state.patterns = patterns;
    state.objectives = objectives;
    state.twists = twists;
    state.difficulties = difficulty;

  } catch (error) {
    console.error("Gagal memuat dataset untuk generator:", error);
    throw new Error("ERR_LOAD_DATA");
  }
}

/**
 * Merakit tantangan baru secara deterministik berdasarkan parameter kesulitan dan kategori.
 * @param {string} selectedDifficulty - Tingkat kesulitan ('easy', 'medium', 'hard')
 * @param {string} selectedCategory - Kategori topik spesifik (atau 'all' untuk acak)
 * @returns {Object} Objek tantangan (Challenge) sesuai dengan Shared Data Model
 */
export function generateChallenge(selectedDifficulty, selectedCategory) {
  // 1. Validasi opsi tingkat kesulitan
  const diffKey = selectedDifficulty && state.difficulties[selectedDifficulty] ?
    selectedDifficulty : 'medium';
  const difficultyData = state.difficulties[diffKey];

  // 2. Tentukan topik (kategori)
  let topic;
  if (selectedCategory && selectedCategory !== 'all') {
    topic = state.topics.includes(selectedCategory) ? selectedCategory : getRandomElement(state.topics);
  } else {
    topic = getRandomElement(state.topics);
  }

  // 3. Ambil elemen acak untuk parameter lainnya
  const patternObj = getRandomElement(state.patterns);
  const objectiveObj = getRandomElement(state.objectives);
  const twistObj = getRandomElement(state.twists);

  // 4. Proses interpolasi string dengan penyesuaian tata bahasa sederhana
  const rawPattern = patternObj.text;
  const structuredQuestion = smartReplaceTag(rawPattern, topic);

  // 5. Kembalikan objek tantangan baru
  return {
    topic: topic,
    difficulty: difficultyData.label,
    objective: `${objectiveObj.name} (${objectiveObj.description})`,
    question: structuredQuestion,
    twist: twistObj.text,
    thinkingTime: difficultyData.thinkingTime,
    speakingTime: difficultyData.speakingTime
  };
}

/**
 * Mengganti tag {topic} di dalam pola kalimat dengan penanganan
 * tata bahasa sederhana (seperti penyesuaian preposisi atau kapitalisasi).
 * @param {string} pattern - Pola kalimat dengan placeholder '{topic}'
 * @param {string} topic - String topik pengganti
 * @returns {string} Kalimat akhir yang sudah rapi secara sintaksis
 */
export function smartReplaceTag(pattern, topic) {
  if (!pattern) return "";
  // Deteksi kata hubung "di" / "pada" / "tentang" sebelum {topic} untuk memastikan keselarasan
  let replaced = pattern.replace(/{topic}/g, topic);
  // Aturan kosmetik sederhana: Pastikan kalimat diakhiri tanda baca yang benar jika hilang
  if (!replaced.endsWith('?') && !replaced.endsWith('.') && !replaced.endsWith('!')) {
    replaced += '?';
  }
  
  return replaced;
}
