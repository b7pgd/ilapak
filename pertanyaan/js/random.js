// Target File: /pertanyaan/js/random.js
// =========================================
// ================================================================================
// js/random.js
// ================================================================================

/**
 * Mengambil elemen acak dari sebuah array.
 * @param {Array} array - Array sumber data yang tidak boleh kosong.
 * @returns {*} Elemen acak dari array.
 */
export function getRandomElement(array) {
  if (!Array.isArray(array) || array.length === 0) {
    throw new Error("Array must not be empty or null");
  }
  const index = getRandomIndex(array);
  return array[index];
}

/**
 * Mengambil indeks acak yang valid dari sebuah array.
 * @param {Array} array - Array target.
 * @returns {number} Indeks acak.
 */
export function getRandomIndex(array) {
  return Math.floor(Math.random() * array.length);
}
