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

  // =========================
  // WAIT FOR BODY (IMPORTANT FIX)
  // =========================
  if (!document.body) {
    const t = setInterval(() => {
      if (document.body) {
        clearInterval(t);
        init();
      }
    }, 50);
  } else {
    init();
  }

  function init() {

    // =========================
    // CREATE PANEL WRAPPER
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

        <div id="b7-status">Ready</div>
      </div>
    `;

    document.body.appendChild(panel);

    const style = document.createElement("style");

    style.innerHTML = `
      #b7-reader-panel {
        position: fixed;
        top: 20px;
        left: 20px;
        right: auto;
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
    // DRAG FIXED
    // =========================
    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    header.addEventListener("mousedown", (e) => {
      isDragging = true;
      offsetX = e.clientX - root.getBoundingClientRect().left;
      offsetY = e.clientY - root.getBoundingClientRect().top;
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      root.style.left = `${e.clientX - offsetX}px`;
      root.style.top = `${e.clientY - offsetY}px`;
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    // =========================
    // TEXT EXTRACTION
    // =========================
    function extractText() {
      const article = document.querySelector("article");
      return article ? article.innerText : document.body.innerText;
    }

    // =========================
    // SPEECH FIX
    // =========================
    function speakText() {
      stopSpeech();

      const text = extractText();

      if (!text || text.trim().length === 0) {
        setStatus("No text found");
        return;
      }

      currentUtterance = new SpeechSynthesisUtterance(text);

      currentUtterance.rate = currentRate;

      if (currentVoice) {
        currentUtterance.voice = currentVoice;
      }

      currentUtterance.onstart = () => {
        speaking = true;
        setStatus("Reading...");
      };

      currentUtterance.onend = () => {
        speaking = false;
        setStatus("Finished");

        if (autoNextPage) goNextPage();
      };

      speechSynthesis.speak(currentUtterance);
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
    // AUTO NEXT PAGE
    // =========================
    function goNextPage() {
      setStatus("Searching next page...");

      const keywords = ["next", "selanjutnya", ">", "›", "→"];

      const buttons = document.querySelectorAll("button, a");

      for (const b of buttons) {
        const t = (b.innerText || "").toLowerCase().trim();

        if (keywords.includes(t)) {
          setStatus("Next page found");
          b.click();

          setTimeout(() => speakText(), 2000);
          return;
        }
      }

      setStatus("Next page not found");
    }

    // =========================
    // SUMMARY SIMPLE
    // =========================
    function summarizeText() {
      const text = extractText().slice(0, 3000);

      const summary = text
        .split(".")
        .slice(0, 5)
        .join(".");

      alert(summary || "No content");
    }

    // =========================
    // EVENTS
    // =========================
    document.getElementById("b7-play").onclick = speakText;
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

      if (box.style.height === "40px") {
        box.style.height = "auto";
        box.style.overflow = "visible";
      } else {
        box.style.height = "40px";
        box.style.overflow = "hidden";
      }
    };

    // =========================
    // VOICE LOADER FIX (CRITICAL)
    // =========================
    function loadVoices() {
      const voices = speechSynthesis.getVoices();

      if (voices && voices.length) {
        currentVoice =
          voices.find(v => v.lang.includes("en")) || voices[0];

        setStatus("Voice ready");
      }
    }

    loadVoices();

    speechSynthesis.onvoiceschanged = loadVoices;
  }

})();
