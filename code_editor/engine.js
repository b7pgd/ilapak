/* ==========================================================================
   DEVELOPER WORKSPACE - ENTRY POINT LOADER (engine.js)
   Satu-satunya file yang dimuat oleh HTML
   ========================================================================== */

(function () {
  /**
   * Helper untuk memuat script secara berurutan
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve(src);
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Inisialisasi utama aplikasi setelah semua modul termuat
   */
  function initApp() {
    try {
      cacheDOM();
      initializeState();
      bindEvents();
      initializeEditor();
      initializeModes();
      initializeButtons();
      setInitialUI();
    } catch (err) {
      console.error("Application initialization error:", err);
      if (elements['status']) {
        setStatus("Initialization failed", "error");
      }
    }
  }

  // Load modul-modul turunan berurutan
  loadScript('engine1.js')
    .then(() => loadScript('engine2.js'))
    .then(() => loadScript('engine3.js'))
    .then(() => loadScript('engine4.js'))
    .then(() => loadScript('engine5.js'))
    .then(() => loadScript('engine6.js'))
    .then(() => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
      } else {
        initApp();
      }
    })
    .catch((err) => {
      console.error("Critical error loading application modules:", err);
    });
})();
