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
  // CREATE UI
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

    <div id="b7-status">Idle</div>
  </div>
  `;

  document.body.appendChild(panel);

  const style = document.createElement("style");

  style.innerHTML = `
  #b7-reader-panel {
    position: fixed;
    top: 20px;
    right: 20px;
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

  // =========================
  // DRAGGABLE PANEL
  // =========================

  const header = document.getElementById("b7-header");

  let isDragging = false;
  let offsetX, offsetY;

  header.addEventListener("mousedown", (e) => {
    isDragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    panel.style.left = `${e.clientX - offsetX}px`;
    panel.style.top = `${e.clientY - offsetY}px`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // =========================
  // GET MAIN TEXT
  // =========================

  function extractText() {
    const article = document.querySelector("article");

    if (article) {
      return article.innerText;
    }

    return document.body.innerText;
  }

  // =========================
  // SPEAK
  // =========================

  function speakText() {
    stopSpeech();

    const text = extractText();

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

      if (autoNextPage) {
        goNextPage();
      }
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

  function setStatus(text) {
    document.getElementById("b7-status").innerText = text;
  }

  // =========================
  // AUTO NEXT PAGE
  // =========================

  function goNextPage() {
    setStatus("Searching next page...");

    const possibleButtons = [
      "next",
      "selanjutnya",
      ">",
      "›",
      "→"
    ];

    const buttons = document.querySelectorAll("button, a");

    for (const btn of buttons) {
      const text = btn.innerText.toLowerCase().trim();

      if (possibleButtons.includes(text)) {
        setStatus("Next page found");
        btn.click();

        setTimeout(() => {
          speakText();
        }, 3000);

        return;
      }
    }

    setStatus("Next page not found");
  }

  // =========================
  // SUMMARY
  // =========================

  async function summarizeText() {
    const text = extractText().slice(0, 4000);

    const summary = text
      .split(".")
      .slice(0, 5)
      .join(".");

    alert("Summary:\n\n" + summary);
  }

  // =========================
  // EVENTS
  // =========================

  document.getElementById("b7-play").onclick = () => {
    speakText();
  };

  document.getElementById("b7-pause").onclick = () => {
    pauseSpeech();
  };

  document.getElementById("b7-stop").onclick = () => {
    stopSpeech();
    setStatus("Stopped");
  };

  document.getElementById("b7-summary").onclick = () => {
    summarizeText();
  };

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
    const body = document.querySelector("#b7-reader-panel");

    if (body.style.height === "40px") {
      body.style.height = "auto";
      body.style.overflow = "visible";
    } else {
      body.style.height = "40px";
      body.style.overflow = "hidden";
    }
  };

  // =========================
  // AUTO LOAD VOICES
  // =========================

  function loadVoices() {
    const voices = speechSynthesis.getVoices();

    currentVoice = voices.find(v =>
      v.lang.includes("en")
    ) || voices[0];
  }

  loadVoices();

  speechSynthesis.onvoiceschanged = loadVoices;

  setStatus("Ready");
})();