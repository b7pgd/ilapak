(function () {
  if (window.B7_READER_ACTIVE) {
    alert("B7 Reader already running");
    return;
  }

  window.B7_READER_ACTIVE = true;

  // =========================
  // CONFIG
  // =========================
  let currentRate = 1.1;
  let currentVoice = null;
  let autoNextPage = false;
  let speaking = false;
  let currentUtterance = null;
  let voicesReady = false;

  // =========================
  // WAIT BODY SAFE
  // =========================
  function waitBody(cb) {
    if (document.body) return cb();
    const t = setInterval(() => {
      if (document.body) {
        clearInterval(t);
        cb();
      }
    }, 50);
  }

  waitBody(init);

  function init() {

    // =========================
    // PANEL
    // =========================
    const panel = document.createElement("div");

    panel.innerHTML = `
      <div id="b7-reader-panel">
        <div id="b7-header">B7 Reader</div>

        <button id="b7-play">▶ Play</button>
        <button id="b7-pause">⏸ Pause</button>
        <button id="b7-stop">⏹ Stop</button>
        <button id="b7-summary">🧠 Summary</button>

        <div style="margin-top:10px;">
          Speed:
          <input type="range" id="b7-speed" min="0.5" max="2" step="0.1" value="1.1">
          <span id="b7-speed-label">1.1x</span>
        </div>

        <div style="margin-top:10px;">
          <label>
            <input type="checkbox" id="b7-auto-next">
            Auto Next Page
          </label>
        </div>

        <div style="margin-top:10px;">
          <button id="b7-minimize">—</button>
          <button id="b7-close">✕</button>
        </div>

        <div id="b7-status">Loading voice...</div>
      </div>
    `;

    document.body.appendChild(panel);

    const style = document.createElement("style");

    style.innerHTML = `
      #b7-reader-panel {
        position: fixed;
        top: 20px;
        left: 20px;
        z-index: 999999;
        width: 280px;
        background: #111;
        color: white;
        padding: 15px;
        border-radius: 16px;
        font-family: Arial;
        box-shadow: 0 0 20px rgba(0,0,0,0.5);
      }

      #b7-reader-panel button {
        margin: 4px;
        padding: 8px 12px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
      }

      #b7-header {
        font-weight: bold;
        margin-bottom: 10px;
        cursor: move;
      }

      #b7-status {
        margin-top: 10px;
        font-size: 12px;
        opacity: 0.8;
      }
    `;

    document.head.appendChild(style);

    const root = document.getElementById("b7-reader-panel");
    const header = document.getElementById("b7-header");

    // =========================
    // DRAG FIX
    // =========================
    let drag = false;
    let dx = 0, dy = 0;

    header.addEventListener("touchstart", startDrag, { passive: true });
    header.addEventListener("mousedown", startDrag);

    function startDrag(e) {
      drag = true;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const y = e.touches ? e.touches[0].clientY : e.clientY;

      const rect = root.getBoundingClientRect();
      dx = x - rect.left;
      dy = y - rect.top;
    }

    document.addEventListener("touchmove", moveDrag, { passive: true });
    document.addEventListener("mousemove", moveDrag);

    function moveDrag(e) {
      if (!drag) return;

      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const y = e.touches ? e.touches[0].clientY : e.clientY;

      root.style.left = `${x - dx}px`;
      root.style.top = `${y - dy}px`;
    }

    document.addEventListener("touchend", () => drag = false);
    document.addEventListener("mouseup", () => drag = false);

    // =========================
    // TEXT
    // =========================
    function extractText() {
      const a = document.querySelector("article");
      return a ? a.innerText : document.body.innerText;
    }

    // =========================
    // VOICE FIX (IMPORTANT VIA BROWSER)
    // =========================
    function loadVoices() {
      const v = speechSynthesis.getVoices();

      if (!v || v.length === 0) {
        setTimeout(loadVoices, 300);
        return;
      }

      currentVoice =
        v.find(x => x.lang.includes("en")) || v[0];

      voicesReady = true;
      setStatus("Voice ready");
    }

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;

    // =========================
    // UNLOCK AUDIO (VIA FIX)
    // =========================
    function unlockSpeech() {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
      speechSynthesis.cancel();
    }

    document.addEventListener("click", unlockSpeech, { once: true });

    // =========================
    // SPEAK FIX (CORE)
    // =========================
    function speakText() {
      stopSpeech();

      const text = extractText();

      if (!text || text.trim().length < 5) {
        setStatus("No text found");
        return;
      }

      const u = new SpeechSynthesisUtterance(text);

      u.rate = currentRate;

      if (currentVoice) u.voice = currentVoice;

      u.onerror = (e) => {
        console.log("speech error", e);
        setStatus("Speech error");
      };

      u.onstart = () => setStatus("Reading...");
      u.onend = () => {
        setStatus("Done");
        if (autoNextPage) goNextPage();
      };

      speechSynthesis.cancel();

      // VIA BROWSER FIX: delay speak
      setTimeout(() => {
        speechSynthesis.speak(u);
      }, 150);
    }

    function pauseSpeech() {
      speechSynthesis.pause();
      setStatus("Paused");
    }

    function stopSpeech() {
      speechSynthesis.cancel();
      speaking = false;
    }

    function setStatus(t) {
      const el = document.getElementById("b7-status");
      if (el) el.innerText = t;
    }

    // =========================
    // NEXT PAGE
    // =========================
    function goNextPage() {
      const keys = ["next", "selanjutnya", ">", "›", "→"];

      const els = document.querySelectorAll("a, button");

      for (const el of els) {
        const t = (el.innerText || "").toLowerCase().trim();
        if (keys.includes(t)) {
          setStatus("Next page...");
          el.click();

          setTimeout(speakText, 2000);
          return;
        }
      }

      setStatus("No next page");
    }

    // =========================
    // SUMMARY
    // =========================
    function summarizeText() {
      const t = extractText().slice(0, 3000);
      alert(t.split(".").slice(0, 5).join("."));
    }

    // =========================
    // EVENTS
    // =========================
    document.getElementById("b7-play").onclick = () => {
      if (!voicesReady) setStatus("Loading voice...");
      speakText();
    };

    document.getElementById("b7-pause").onclick = pauseSpeech;

    document.getElementById("b7-stop").onclick = () => {
      stopSpeech();
      setStatus("Stopped");
    };

    document.getElementById("b7-summary").onclick = summarizeText;

    document.getElementById("b7-speed").oninput = (e) => {
      currentRate = parseFloat(e.target.value);
      document.getElementById("b7-speed-label").innerText = currentRate + "x";
    };

    document.getElementById("b7-auto-next").onchange = (e) => {
      autoNextPage = e.target.checked;
    };

    document.getElementById("b7-close").onclick = () => {
      stopSpeech();
      panel.remove();
      style.remove();
      window.B7_READER_ACTIVE = false;
    };

    document.getElementById("b7-minimize").onclick = () => {
      const box = document.getElementById("b7-reader-panel");
      box.style.display = box.style.display === "none" ? "block" : "none";
    };
  }

})();
