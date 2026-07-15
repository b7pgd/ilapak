// Target File: /pertanyaan/js/timer.js
// =========================================
// ================================================================================
// js/timer.js
// ================================================================================

// State internal modul pengatur waktu
let intervalId = null;
let timeLeft = 0;
let status = "idle"; // "idle" | "running" | "paused"

/**
 * Memulai hitung mundur waktu baru.
 * Jika ada timer yang berjalan, akan dihentikan terlebih dahulu.
 * @param {number} seconds - Durasi waktu dalam detik.
 * @param {Function} onTick - Callback function yang dipanggil setiap detik, menerima sisa waktu (detik).
 * @param {Function} onComplete - Callback function ketika durasi waktu habis.
 */
export function startTimer(seconds, onTick, onComplete) {
  stopTimer();
  timeLeft = seconds;
  status = "running";
  
  // Trigger tick pertama secara instan di UI sebelum interval berjalan
  if (typeof onTick === "function") {
    onTick(timeLeft);
  }

  intervalId = setInterval(() => {
    tick(onTick, onComplete);
  }, 1000);
}

/**
 * Menghentikan dan mereset pengatur waktu secara total.
 */
export function stopTimer() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  timeLeft = 0;
  status = "idle";
}

/**
 * Menghentikan sementara (pause) jalannya pengatur waktu tanpa mereset sisa waktu.
 */
export function pauseTimer() {
  if (status === "running" && intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    status = "paused";
  }
}

/**
 * Fungsi internal pemroses pengurangan waktu setiap detik.
 * @param {Function} onTick - Callback per detik.
 * @param {Function} onComplete - Callback saat habis.
 */
function tick(onTick, onComplete) {
  if (timeLeft > 0) {
    timeLeft--;
    if (typeof onTick === "function") {
      onTick(timeLeft);
    }
  }

  if (timeLeft <= 0) {
    stopTimer();
    if (typeof onComplete === "function") {
      onComplete();
    }
  }
}
