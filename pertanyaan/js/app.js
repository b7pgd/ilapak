import { loadDatasets, generateChallenge } from './generator.js';
import { startTimer, stopTimer } from './timer.js';

// State global aplikasi klien
const state = {
  activeChallenge: null,
  timerMode: "idle", // "idle" | "thinking" | "speaking"
  historyLog: [],
  favoriteLog: [],
  isRecording: false
};

// Objek penampung instansi IndexedDB dan MediaRecorder
let db = null;
let mediaRecorder = null;
let audioChunks = [];

/**
 * Inisialisasi aplikasi saat halaman selesai dimuat.
 */
window.addEventListener('DOMContentLoaded', async () => {
  await init();
});

/**
 * Alur bootstrap inisialisasi modul data, database lokal, dan binding elemen UI.
 */
async function init() {
  try {
    // 1. Muat dataset JSON pendukung generator
    await loadDatasets();
    // 2. Inisialisasi penyimpanan database lokal IndexedDB untuk file audio
    await initIndexedDB();
    // 3. Muat riwayat dan favorit yang tersimpan dari LocalStorage
    loadStoredData();
    // 4. Daftarkan seluruh penanganan event DOM
    bindEvents();

    console.log("Public Speaking Trainer siap digunakan.");
  } catch (error) {
    if (error.message === "ERR_LOAD_DATA") {
      alert("Gagal memuat dataset aplikasi. Silakan muat ulang halaman atau periksa koneksi data lokal Anda.");
    } else {
      console.error("Terjadi kesalahan saat inisialisasi:", error);
    }
  }
}

/**
 * Menginisialisasi IndexedDB untuk penyimpanan rekaman suara lokal (kapasitas besar).
 */
async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PublicSpeakingDB", 1);

    request.onerror = (event) => {
      console.error("Gagal membuka IndexedDB:", event.target.error);
      reject(new Error("ERR_INDEXEDDB_FAIL"));
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains("recordings")) {
        database.createObjectStore("recordings", { keyPath: "id" });
      }
    };
  });
}

/**
 * Memuat riwayat dan favorit dari Local Storage.
 */
function loadStoredData() {
  try {
    const storedHistory = localStorage.getItem("pst_history");
    const storedFavorites = localStorage.getItem("pst_favorites");

    if (storedHistory) state.historyLog = JSON.parse(storedHistory);
    if (storedFavorites) state.favoriteLog = JSON.parse(storedFavorites);

    renderHistory();
  } catch (e) {
    console.warn("Gagal membaca Local Storage:", e);
  }
}

/**
 * Menghubungkan elemen HTML dengan aksi interaksi logika program.
 */
function bindEvents() {
  const generateBtn = document.querySelector('#generateBtn');
  const recordBtn = document.querySelector('#recordBtn');

  if (generateBtn) {
    // Menggunakan arrow function langsung untuk keandalan binding event
    generateBtn.onclick = (e) => {
      e.preventDefault();
      handleGenerate();
    };
  }

  if (recordBtn) {
    recordBtn.onclick = (e) => {
      e.preventDefault();
      toggleRecord();
    };
  }
}

/**
 * Mengendalikan aksi generate tantangan latihan baru.
 */
function handleGenerate() {
  const difficultySelect = document.querySelector('#difficulty');
  const categorySelect = document.querySelector('#category');

  const selectedDifficulty = difficultySelect ? difficultySelect.value : 'medium';
  const selectedCategory = categorySelect ? categorySelect.value : 'all';
  // Hentikan timer & rekaman yang sedang berjalan jika pengguna langsung generate ulang
  stopTimer();
  if (state.isRecording) {
    stopAudioCapture(false); // Berhenti tanpa menyimpan
  }

  // Bangun tantangan baru melalui generator mekanis
  state.activeChallenge = generateChallenge(selectedDifficulty, selectedCategory);
  // Simpan tantangan ke riwayat lokal
  saveToHistory(state.activeChallenge);

  // Render konten visual ke layar pengguna
  renderChallenge(state.activeChallenge);
  // Mulai fase berpikir pengguna secara otomatis
  startThinkingPhase();
}

/**
 * Menjalankan fase berpikir pengguna (Thinking Phase).
 */
function startThinkingPhase() {
  state.timerMode = "thinking";
  const timerDisplay = document.querySelector('#timer');
  
  if (timerDisplay) {
    timerDisplay.classList.remove('speaking-active');
    timerDisplay.classList.add('thinking-active');
  }

  const thinkingSeconds = state.activeChallenge.thinkingTime;

  startTimer(
    thinkingSeconds,
    (timeLeft) => {
      // Mengubah format tampilan waktu detik ke MM:SS
      if (timerDisplay) {
        timerDisplay.textContent = `Berpikir - ${formatTime(timeLeft)}`;
      }
    },
    () => {
      // Setelah waktu berpikir habis, langsung masuk ke fase berbicara secara otomatis
      startSpeakingPhase();
    }
  );
}

/**
 * Menjalankan fase berbicara (Speaking Phase).
 */
function startSpeakingPhase() {
  state.timerMode = "speaking";
  const timerDisplay = document.querySelector('#timer');
  if (timerDisplay) {
    timerDisplay.classList.remove('thinking-active');
    timerDisplay.classList.add('speaking-active');
  }

  // Bunyikan sinyal beep sederhana menggunakan Web Audio API
  playBeep();
  const speakingSeconds = state.activeChallenge.speakingTime;

  startTimer(
    speakingSeconds,
    (timeLeft) => {
      if (timerDisplay) {
        timerDisplay.textContent = `Bicara - ${formatTime(timeLeft)}`;
      }
    },
    () => {
      // Sesi latihan selesai
      state.timerMode = "idle";
      if (timerDisplay) {
        timerDisplay.textContent = "Selesai!";
      }
      playBeep();
         
      // Matikan rekaman otomatis jika sedang aktif merekam saat waktu habis
      if (state.isRecording) {
        toggleRecord();
      }
    }
  );
}

/**
 * Meremajakan tampilan struktur visual (DOM) tantangan yang aktif.
 * @param {Object} challenge - Objek struktur data tantangan yang aktif.
 */
function renderChallenge(challenge) {
  const topicEl = document.querySelector('#topic');
  const objectiveEl = document.querySelector('#objective');
  const questionEl = document.querySelector('#question');
  const rulesEl = document.querySelector('#rules');

  if (topicEl) topicEl.textContent = challenge.topic;
  if (objectiveEl) objectiveEl.textContent = challenge.objective;
  if (questionEl) questionEl.textContent = challenge.question;
  if (rulesEl) {
    rulesEl.innerHTML = `
      <li><strong>Tingkat Kesulitan:</strong> ${challenge.difficulty}</li>
      <li><strong>Tantangan Tambahan (Twist):</strong> ${challenge.twist}</li>
    `;
  }

  // Aktifkan kembali tombol rekaman jika sempat dinonaktifkan
  const recordBtn = document.querySelector('#recordBtn');
  if (recordBtn) {
    recordBtn.disabled = false;
  }
}

/**
 * Mengendalikan siklus rekam suara pengguna (On / Off).
 */
async function toggleRecord() {
  const recordBtn = document.querySelector('#recordBtn');
  
  if (!state.isRecording) {
    // Mulai perekaman suara
    const started = await startAudioCapture();
    if (started) {
      state.isRecording = true;
      if (recordBtn) {
        recordBtn.textContent = "Stop Rekam";
        recordBtn.classList.add('recording-pulsing');
      }
    }
  } else {
    // Hentikan perekaman dan simpan audio ke database lokal
    await stopAudioCapture(true);
    state.isRecording = false;
    if (recordBtn) {
      recordBtn.textContent = "Mulai Rekam";
      recordBtn.classList.remove('recording-pulsing');
    }
  }
}

/**
 * Menangkap akses mikrofon sistem dan mulai perekaman audio.
 * @returns {boolean} Keberhasilan pemesanan media recording
 */
async function startAudioCapture() {
  // Mode simulasi (pajangan): Selalu kembalikan true tanpa meminta akses mikrofon asli
  return true;
}

/**
 * Menghentikan proses perekaman media dan menyimpan hasilnya jika diinstruksikan.
 * @param {boolean} shouldSave - Menyimpan atau membuang chunk rekaman saat ini.
 */
async function stopAudioCapture(shouldSave = true) {
  // Mode simulasi (pajangan): Kembalikan Promise sukses langsung tanpa menyimpan apa pun ke memori/IndexedDB
  return new Promise((resolve) => {
    resolve();
  });
}

/**
 * Menyimpan blob audio mentah ke dalam IndexedDB.
 * @param {Object} recordingData - Payload data rekaman suara.
 */
async function saveAudioToIndexedDB(recordingData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("ERR_INDEXEDDB_FAIL"));
      return;
    }

    const transaction = db.transaction(["recordings"], "readwrite");
    const store = transaction.objectStore("recordings");
    const request = store.add(recordingData);

    request.onsuccess = () => {
      console.log("Audio berhasil disimpan secara offline.");
      resolve();
    };

    request.onerror = (event) => {
      console.error("Gagal menyimpan audio:", 
      event.target.error);
      reject(new Error("ERR_INDEXEDDB_FAIL"));
    };
  });
}

/**
 * Menyimpan log tantangan saat ini ke riwayat LocalStorage.
 * @param {Object} challenge - Objek struktur data tantangan yang aktif.
 */
function saveToHistory(challenge) {
  state.historyLog.unshift(challenge);
  // Batasi penyimpanan riwayat hanya sampai 20 entri agar optimal
  if (state.historyLog.length > 20) {
    state.historyLog.pop();
  }

  localStorage.setItem("pst_history", JSON.stringify(state.historyLog));
  renderHistory();
}

/**
 * Memperbarui komponen daftar riwayat pada tampilan UI.
 */
function renderHistory() {
  const historyList = document.querySelector('#historyList');
  if (!historyList) return;

  historyList.innerHTML = "";
  if (state.historyLog.length === 0) {
    historyList.innerHTML = "<li class='empty-history'>Belum ada riwayat latihan.</li>";
    return;
  }

  state.historyLog.forEach((item, index) => {
    const li = document.createElement('li');
    li.classList.add('history-item');
    li.innerHTML = `
      <div class="history-meta">
        <span class="badge difficulty-${item.difficulty.toLowerCase()}">${item.difficulty}</span>
        <span class="history-topic">${item.topic}</span>
      </div>
      <p class="history-question">${item.question}</p>
    `;
    historyList.appendChild(li);
  });
}

/**
 * Helper pembuat suara beep audio frekuensi tinggi untuk transisi sesi.
 */
function playBeep() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    // Nada A5 tegas
    gainNode.gain.setValueAtTime(0.1, context.currentTime);

    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
    // Durasi bunyi singkat
  } catch (e) {
    console.warn("Sistem Audio Browser tidak mendukung autoplay beep:", e);
  }
}

/**
 * Mengubah jumlah total detik menjadi format menit:detik standard (MM:SS)
 * @param {number} totalSeconds - Waktu dalam detik.
 * @returns {string} String termatiksasi.
 */
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
