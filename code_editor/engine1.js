/*
 * PS Web - WASM & Native Batch Grep Engine (Baseline Engine 1)
 */

"use strict";

(function () {
  window.PSWeb = window.PSWeb || {};

  const GREP_WASM_URL = "https://uutils.org/wasm/grep.wasm";
  const WASI_SHIM_URL = "https://esm.sh/@bjorn3/browser_wasi_shim@0.4.2";

  const EXCLUDED_DIRS = new Set([
    "node_modules", ".next", ".git", "dist", "build", "coverage", "vendor", "cache", "temp", "generated"
  ]);

  const SOURCE_EXTENSIONS = new Set([
    ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".json", ".go", ".py", ".java", ".kt", ".kts", ".c", ".h", ".cpp", ".hpp",
    ".cs", ".rs", ".php", ".sql", ".xml", ".yaml", ".yml", ".md", ".txt", ".vue", ".svelte"
  ]);

  const state = {
    directoryHandle: null,
    currentFile: null,
    currentFileHandle: null,
    files: [],
    fileMap: new Map(),
    grepModule: null,
    grepLoading: null,
    editorSavedContent: "",
    editorHistory: [],
    editorHistoryIndex: -1,
    editorHistoryApplying: false,
    editorHistoryTimer: null
  };

  /* =========================================================
     UI HELPERS
     ========================================================= */

  function $(id) {
    return document.getElementById(id);
  }

  function output(text, type = "normal") {
    const el = $("output");
    if (!el) {
      console.log(text);
      return;
    }
    el.textContent = text;
    el.classList.remove("error", "success");
    if (type === "error") el.classList.add("error");
    else if (type === "success") el.classList.add("success");
  }

  function appendOutput(text) {
    const el = $("output");
    if (!el) {
      console.log(text);
      return;
    }
    el.textContent += text;
  }

  function setStatus(text, type = "neutral") {
    const el = $("status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("error", "success");
    if (type === "error") el.classList.add("error");
    if (type === "success") el.classList.add("success");
  }

  /* =========================================================
     FOLDER SCANNING
     ========================================================= */

  async function openFolder() {
    if (!window.showDirectoryPicker) {
      setStatus("File System Access API tidak tersedia di browser ini", "error");
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      state.directoryHandle = handle;
      state.files = [];
      state.fileMap.clear();

      setStatus("Scanning folder...", "neutral");
      await scanDirectory(handle, "");
      renderFileTree();

      setStatus(`${state.files.length} source files loaded`, "success");
      output([
        "PS Web Search Engine Ready.",
        "",
        `Folder : ${handle.name}`,
        `Files  : ${state.files.length}`,
        "",
        "Examples:",
        '  grep "ShowAuditTrail"',
        '  grep-batch "Idle" "Running" "EndTimestamp"',
        '  grep-batch -i "idle" "running"',
        '  Select-String "ShowAuditTrail"'
      ].join("\n"));
    } catch (err) {
      if (err && err.name === "AbortError") {
        setStatus("Folder selection cancelled", "neutral");
        return;
      }
      console.error(err);
      setStatus(`Error opening folder: ${err.message}`, "error");
      output(`ERROR: ${err.message}`, "error");
    }
  }

  async function scanDirectory(directoryHandle, relativePath) {
    for await (const entry of directoryHandle.values()) {
      if (entry.name.startsWith(".") && EXCLUDED_DIRS.has(entry.name)) continue;

      if (entry.kind === "directory") {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const nextPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        await scanDirectory(entry, nextPath);
        continue;
      }

      if (entry.kind !== "file" || !isSourceFile(entry.name)) continue;

      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const item = { path, name: entry.name, handle: entry };
      state.files.push(item);
      state.fileMap.set(path, item);
    }
  }

  function isSourceFile(filename) {
    const lower = filename.toLowerCase();
    const dot = lower.lastIndexOf(".");
    return dot !== -1 && SOURCE_EXTENSIONS.has(lower.slice(dot));
  }

  /* =========================================================
     FILE TREE & EDITOR
     ========================================================= */

  function renderFileTree() {
    const tree = $("file-tree");
    if (!tree) return;
    tree.innerHTML = "";

    const sorted = [...state.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of sorted) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-tree-item";
      button.textContent = file.path;
      button.addEventListener("click", () => openFile(file));
      tree.appendChild(button);
    }
  }

  async function openFile(file) {
    try {
      const handle = file.handle;
      const f = await handle.getFile();
      const text = await f.text();

      state.currentFile = file.path;
      state.currentFileHandle = handle;
      state.editorSavedContent = text;
      state.editorHistory = [text];
      state.editorHistoryIndex = 0;

      const editor = $("editor");
      if (editor) {
        editor.value = text;
        updateLineNumbers();
        updateEditorHistoryButtons();
      }
      const current = $("current-file");
      if (current) current.textContent = file.path;
    } catch (err) {
      output(`ERROR opening ${file.path}: ${err.message}`, "error");
    }
  }

  function updateLineNumbers() {
    const editor = $("editor");
    const numbers = $("line-numbers");
    if (!editor || !numbers) return;
    const count = editor.value.split("\n").length;
    numbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
  }

  async function saveCurrentFile() {
    if (!state.currentFileHandle) {
      output("No file selected.", "error");
      return;
    }
    try {
      const editor = $("editor");
      if (!editor) return;
      const writable = await state.currentFileHandle.createWritable();
      await writable.write(editor.value);
      await writable.close();
      state.editorSavedContent = editor.value;
      updateEditorHistoryButtons();
      output(`Saved: ${state.currentFile}`, "success");
    } catch (err) {
      output(`ERROR saving file: ${err.message}`, "error");
    }
  }

  function clearEditor() {
    const editor = $("editor");
    if (!editor) return;

    editor.value = "";
    updateLineNumbers();
    recordEditorHistory();
  }

  async function copyEditor() {
    const editor = $("editor");
    if (editor) await navigator.clipboard.writeText(editor.value);
  }

  async function pasteEditor() {
    const editor = $("editor");
    if (!editor) return;

    editor.value = await navigator.clipboard.readText();
    updateLineNumbers();
    recordEditorHistory();
  }

  function recordEditorHistory() {
    const editor = $("editor");
    if (!editor || state.editorHistoryApplying) return;

    clearTimeout(state.editorHistoryTimer);

    state.editorHistoryTimer = setTimeout(() => {
      const value = editor.value;

      if (
        state.editorHistoryIndex >= 0 &&
        state.editorHistory[state.editorHistoryIndex] === value
      ) {
        return;
      }

      state.editorHistory = state.editorHistory.slice(
        0,
        state.editorHistoryIndex + 1
      );

      state.editorHistory.push(value);

      if (state.editorHistory.length > 100) {
        state.editorHistory.shift();
      }

      state.editorHistoryIndex = state.editorHistory.length - 1;
      updateEditorHistoryButtons();
    }, 500);
  }

  function applyEditorHistory(index) {
    const editor = $("editor");
    if (!editor) return;

    if (index < 0 || index >= state.editorHistory.length) return;

    state.editorHistoryApplying = true;

    editor.value = state.editorHistory[index];
    state.editorHistoryIndex = index;

    updateLineNumbers();
    updateEditorHistoryButtons();

    state.editorHistoryApplying = false;
  }

  function undoEditor() {
    if (state.editorHistoryIndex <= 0) return;
    applyEditorHistory(state.editorHistoryIndex - 1);
  }

  function redoEditor() {
    if (state.editorHistoryIndex >= state.editorHistory.length - 1) return;
    applyEditorHistory(state.editorHistoryIndex + 1);
  }

  function cancelEditorChanges() {
    const editor = $("editor");
    if (!editor) return;

    editor.value = state.editorSavedContent;
    state.editorHistory = [state.editorSavedContent];
    state.editorHistoryIndex = 0;

    updateLineNumbers();
    updateEditorHistoryButtons();

    output("Changes cancelled. Editor reverted to last saved version.", "success");
  }

  function updateEditorHistoryButtons() {
    const undo = $("editor-undo");
    const redo = $("editor-redo");
    const cancel = $("editor-cancel");

    if (undo) {
      undo.disabled = state.editorHistoryIndex <= 0;
    }

    if (redo) {
      redo.disabled =
        state.editorHistoryIndex >= state.editorHistory.length - 1;
    }

    if (cancel) {
      const editor = $("editor");
      cancel.disabled =
        !editor || editor.value === state.editorSavedContent;
    }
  }

  function toggleEditorMinimize() {
    const editorContainer = document.querySelector(".editor-container");
    const button = $("editor-minimize");

    if (!editorContainer) return;

    const minimized = editorContainer.classList.toggle("editor-minimized");

    if (button) {
      button.textContent = minimized ? "+" : "−";
      button.title = minimized ? "Restore editor" : "Minimize editor";
    }
  }

  /* =========================================================
     WASM MODULE LOADER
     ========================================================= */

  async function loadGrepWasm() {
    if (state.grepModule) return state.grepModule;
    if (state.grepLoading) return state.grepLoading;

    state.grepLoading = (async () => {
      setStatus("Loading grep.wasm...", "neutral");
      const wasiModule = await import(WASI_SHIM_URL);
      const response = await fetch(GREP_WASM_URL);
      if (!response.ok) throw new Error(`grep.wasm HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const module = await WebAssembly.compile(bytes);

      state.grepModule = {
        WASI: wasiModule.WASI,
        File: wasiModule.File,
        OpenFile: wasiModule.OpenFile,
        ConsoleStdout: wasiModule.ConsoleStdout,
        PreopenDirectory: wasiModule.PreopenDirectory,
        module
      };
      setStatus("grep.wasm loaded", "success");
      return state.grepModule;
    })();

    try {
      return await state.grepLoading;
    } finally {
      state.grepLoading = null;
    }
  }

  /* =========================================================
     SINGLE & BATCH GREP ENGINE
     ========================================================= */

  async function grepFiles(pattern, options = {}) {
    const batchResult = await grepBatchFiles([pattern], options);
    const patRes = batchResult.patternResults[0];
    if (patRes && patRes.error) throw new Error(patRes.error);
    return patRes ? patRes.matches : [];
  }

  async function grepBatchFiles(patterns, options = {}) {
    if (!state.files.length) throw new Error("Open a folder first.");

    const {
      caseInsensitive = false,
      regex = false,
      filesOnly = false,
      context = 0
    } = options;

    const patternStats = patterns.map(p => {
      let matcher = null;
      let error = null;
      try {
        matcher = regex
          ? new RegExp(p, caseInsensitive ? "i" : "")
          : null;
      } catch (err) {
        error = err.message;
      }
      return {
        pattern: p,
        matcher,
        error,
        matches: [],
        matchedFiles: new Set()
      };
    });

    const combinedMatches = [];

    for (const file of state.files) {
      let text = "";
      try {
        const f = await file.handle.getFile();
        text = await f.text();
      } catch (err) {
        for (const pStat of patternStats) {
          pStat.matches.push({
            path: file.path,
            lineNumber: 0,
            line: `[ERROR reading file: ${err.message}]`,
            contextLines: []
          });
        }
        continue;
      }

      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matchedPatternIndices = [];

        for (let pIdx = 0; pIdx < patternStats.length; pIdx++) {
          const pStat = patternStats[pIdx];
          if (pStat.error) continue;

          let isMatch = false;
          if (regex) {
            pStat.matcher.lastIndex = 0;
            isMatch = pStat.matcher.test(line);
          } else {
            isMatch = caseInsensitive
              ? line.toLowerCase().includes(pStat.pattern.toLowerCase())
              : line.includes(pStat.pattern);
          }

          if (isMatch) {
            pStat.matchedFiles.add(file.path);
            matchedPatternIndices.push(pIdx);

            let ctxLines = [];
            if (context > 0 && !filesOnly) {
              const start = Math.max(0, i - context);
              const end = Math.min(lines.length - 1, i + context);
              for (let c = start; c <= end; c++) {
                ctxLines.push({ lineNumber: c + 1, line: lines[c] });
              }
            }

            const matchObj = {
              path: file.path,
              lineNumber: i + 1,
              line,
              contextLines: ctxLines
            };

            pStat.matches.push(matchObj);
          }
        }

        if (matchedPatternIndices.length > 0) {
          let ctxLines = [];
          if (context > 0 && !filesOnly) {
            const start = Math.max(0, i - context);
            const end = Math.min(lines.length - 1, i + context);
            for (let c = start; c <= end; c++) {
              ctxLines.push({ lineNumber: c + 1, line: lines[c] });
            }
          }

          combinedMatches.push({
            path: file.path,
            lineNumber: i + 1,
            line,
            contextLines: ctxLines,
            matchedPatterns: matchedPatternIndices.map(idx => patternStats[idx].pattern)
          });
        }
      }
    }

    if (filesOnly) {
      for (const pStat of patternStats) {
        pStat.matches = Array.from(pStat.matchedFiles).map(path => ({
          path,
          lineNumber: 0,
          line: "",
          contextLines: []
        }));
      }
    }

    return { patternResults: patternStats, combinedMatches };
  }

  /* =========================================================
     COMMAND PARSER & TOKENIZER
     ========================================================= */

  function tokenizeCommand(command) {
    const tokens = [];
    let current = "";
    let inDouble = false;
    let inSingle = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (char === '\\' && i + 1 < command.length) {
        const next = command[i + 1];

        // Pertahankan escape sequence regex seperti \(,\), \., \[, \s, dll.
        current += "\\" + next;
        i++;
        continue;
      }

      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }

      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }

      if (!inDouble && !inSingle) {
        if (char === ';' || char === ',' || /\s/.test(char)) {
          if (current.length > 0) {
            tokens.push(current);
            current = "";
          }
          continue;
        }
      }

      current += char;
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  function parseCommandArguments(tokens) {
    const result = {
      command: tokens[0] ? tokens[0].toLowerCase() : "",
      patterns: [],
      caseInsensitive: false,
      regex: false,
      filesOnly: false,
      combined: false,
      recursive: true,
      context: 0
    };

    const rawCmd = tokens[0] || "";
    let i = 1;

    if (rawCmd.toLowerCase() === "grep" && tokens.length > 1) {
      const second = tokens[1].toLowerCase();
      if (second === "batch" || second === "-batch" || second === "--batch" || second === "-b") {
        result.command = "grep-batch";
        i = 2;
      }
    }

    for (; i < tokens.length; i++) {
      const tok = tokens[i];

      if (tok === "-i" || tok === "--ignore-case") {
        result.caseInsensitive = true;
      } else if (tok === "-regex" || tok === "--regex") {
        result.regex = true;
      } else if (tok === "-E") {
        if (tokens.length - i > 2) {
          result.regex = true;
        } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
          result.regex = true;
          result.patterns.push(tokens[++i]);
        } else {
          result.regex = true;
        }
      } else if (tok.startsWith("--regexp=")) {
        result.regex = true;
        result.patterns.push(tok.split("=")[1]);
      } else if (tok === "-e" || tok === "--regexp") {
        result.regex = true;
        if (i + 1 < tokens.length) {
          result.patterns.push(tokens[++i]);
        }
      } else if (tok === "-files" || tok === "-l") {
        result.filesOnly = true;
      } else if (tok === "-c" || tok === "--combined") {
        result.combined = true;
      } else if (tok === "-r" || tok === "--recursive") {
        result.recursive = true;
      } else if (tok === "-C" || tok === "--context") {
        if (i + 1 < tokens.length && !isNaN(parseInt(tokens[i + 1], 10))) {
          result.context = parseInt(tokens[++i], 10);
        }
      } else if (tok.startsWith("-")) {
        continue;
      } else {
        if (tok.includes("|") && result.regex) {
          const parts = tok.split("|");
          result.patterns.push(...parts);
        } else {
          result.patterns.push(tok);
        }
      }
    }

    return result;
  }

  /* =========================================================
     EXECUTE COMMANDS
     ========================================================= */

  async function executeCommand(command) {
    const raw = command.trim();
    if (!raw) return;

    // Check layer execution (Router/Compatibility handlers in engine 2, 3, 4)
    if (window.PSWeb && Array.isArray(window.PSWeb.layers)) {
      for (const layer of window.PSWeb.layers) {
        if (typeof layer.execute === "function") {
          const handled = await layer.execute(raw, { state, output, tokenizeCommand, parseCommandArguments, runSearch, runBatchSearch });
          if (handled) return;
        }
      }
    }

    const tokens = tokenizeCommand(raw);
    if (!tokens.length) return;

    const parsed = parseCommandArguments(tokens);
    const cmd = parsed.command;

    if (cmd === "clear" || cmd === "cls") {
      output("");
      return;
    }

    if (cmd === "help" || cmd === "?") {
      output([
        "PS Web Search Engine Commands:",
        "",
        "Single Search:",
        '  grep "text"',
        '  grep -i "text"',
        '  grep -regex "Show.*Trail"',
        "",
        "Batch Search:",
        '  grep-batch "Idle" "Running" "Status"',
        '  grep-batch -i "idle" "running"',
        '  grep-batch -regex "Idle" "Running"',
        '  grep-batch -files "Idle" "Running"',
        '  grep-batch --combined "Idle" "Running"',
        '  grep -e "Idle" -e "Running"',
        "",
        "PowerShell-like:",
        '  Select-String "text"',
        '  Select-String -Pattern "text"',
        "",
        "File Operations:",
        '  Get-Content "path/file.go"',
        '  cat "path/file.go"',
        '  pwd',
        "  clear"
      ].join("\n"));
      return;
    }

    if (cmd === "grep") {
      if (!state.directoryHandle) {
        output("ERROR: Open a folder first.", "error");
        return;
      }

      if (!parsed.patterns.length) {
        output('Usage: grep [-i] [-regex] "pattern"', "error");
        return;
      }

      await runSearch(parsed.patterns[0], {
        caseInsensitive: parsed.caseInsensitive,
        regex: parsed.regex,
        filesOnly: parsed.filesOnly
      });
      return;
    }

    if (
      cmd === "grep-batch" ||
      cmd === "grep--batch" ||
      cmd === "grep-b"
    ) {
      if (!state.directoryHandle) {
        output("ERROR: Open a folder first.", "error");
        return;
      }

      if (!parsed.patterns.length) {
        output('Usage: grep-batch "pattern1" "pattern2" ...', "error");
        return;
      }

      await runBatchSearch(parsed.patterns, {
        caseInsensitive: parsed.caseInsensitive,
        regex: parsed.regex,
        filesOnly: parsed.filesOnly,
        combined: parsed.combined,
        context: parsed.context
      });
      return;
    }

    if (cmd === "select-string" || cmd === "selectstring") {
      if (!state.directoryHandle) {
        output("ERROR: Open a folder first.", "error");
        return;
      }

      let pattern = null;
      let caseInsensitive = false;
      let regex = false;

      for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.toLowerCase() === "-pattern") {
          if (i + 1 < tokens.length) pattern = tokens[++i];
          continue;
        }
        if (token.toLowerCase() === "-casesensitive") {
          caseInsensitive = false;
          continue;
        }
        if (token.toLowerCase() === "-notmatch") {
          regex = true;
          continue;
        }
        if (token.startsWith("-")) continue;
        if (pattern === null) pattern = token;
      }

      if (!pattern) {
        output('Usage: Select-String -Pattern "text"', "error");
        return;
      }

      await runSearch(pattern, { caseInsensitive, regex });
      return;
    }

    if (cmd === "get-content" || cmd === "cat") {
      const path = tokens[1];

      if (!path) {
        output("Usage: Get-Content FILE [START END]", "error");
        return;
      }

      const file = state.fileMap.get(path);

      if (!file) {
        output(`File not found: ${path}`, "error");
        return;
      }

      const f = await file.handle.getFile();
      const text = await f.text();

      const start = Number(tokens[2]);
      const end = Number(tokens[3]);

      if (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start > 0 &&
        end >= start
      ) {
        const lines = text.split(/\r?\n/);
        output(lines.slice(start - 1, end).join("\n"));
      } else {
        output(text);
      }

      return;
    }

    if (cmd === "pwd") {
      output(state.directoryHandle ? state.directoryHandle.name : "No folder opened");
      return;
    }

    output([`Command not recognized: ${tokens[0]}`, "", "Type help for supported commands."].join("\n"), "error");
  }

  /* =========================================================
     SEARCH RUNNERS & OUTPUT FORMATTERS
     ========================================================= */

  async function runSearch(pattern, options) {
    try {
      output(`Searching ${state.files.length} files...\n`);
      try {
        await loadGrepWasm();
      } catch (wasmError) {
        console.warn("grep.wasm unavailable; using browser fallback:", wasmError);
      }

      const results = await grepFiles(pattern, options);
      if (!results.length) {
        output([
          "===== SEARCH RESULT =====",
          `Pattern: ${pattern}`,
          "",
          "No matches found.",
          "===== 0 MATCHES ====="
        ].join("\n"));
        return;
      }

      const lines = ["===== SEARCH RESULT =====", `Pattern: ${pattern}`, ""];
      for (const result of results) {
        if (options.filesOnly) {
          lines.push(result.path);
        } else {
          lines.push(`${result.path}:${result.lineNumber}: ${result.line}`);
        }
      }
      lines.push("", `===== ${results.length} MATCHES =====`);
      output(lines.join("\n"), "success");
    } catch (err) {
      console.error(err);
      output(["===== SEARCH ERROR =====", `Pattern: ${pattern}`, `Error: ${err.message}`].join("\n"), "error");
    }
  }

  async function runBatchSearch(patterns, options) {
    try {
      output(`Searching ${state.files.length} files for ${patterns.length} pattern(s)...\n`);
      try {
        await loadGrepWasm();
      } catch (wasmError) {
        console.warn("grep.warn unavailable; using browser fallback:", wasmError);
      }

      const { patternResults, combinedMatches } = await grepBatchFiles(patterns, options);
      const lines = ["===== BATCH SEARCH RESULT =====", ""];
      let totalMatches = 0;
      const allUniqueFiles = new Set();

      if (options.combined) {
        for (const m of combinedMatches) {
          totalMatches++;
          allUniqueFiles.add(m.path);
          const patLabel = `[${m.matchedPatterns.join(", ")}]`;
          if (options.filesOnly) {
            lines.push(`${m.path} ${patLabel}`);
          } else {
            lines.push(`${m.path}:${m.lineNumber}: ${patLabel} ${m.line}`);
            if (m.contextLines && m.contextLines.length > 0) {
              for (const c of m.contextLines) {
                lines.push(`  ${c.lineNumber}: ${c.line}`);
              }
            }
          }
        }
      } else {
        for (let i = 0; i < patternResults.length; i++) {
          const pRes = patternResults[i];
          lines.push(`--- PATTERN ${i + 1}: ${pRes.pattern} ---`);

          if (pRes.error) {
            lines.push(`[Error: ${pRes.error}]`, "");
            continue;
          }

          if (pRes.matches.length === 0) {
            lines.push("No matches.", "");
            continue;
          }

          for (const m of pRes.matches) {
            totalMatches++;
            allUniqueFiles.add(m.path);
            if (options.filesOnly) {
              lines.push(m.path);
            } else {
              lines.push(`${m.path}:${m.lineNumber}: ${m.line}`);
              if (m.contextLines && m.contextLines.length > 0) {
                for (const c of m.contextLines) {
                  lines.push(`  ${c.lineNumber}: ${c.line}`);
                }
              }
            }
          }
          lines.push("");
        }
      }

      lines.push("===== BATCH SUMMARY =====");
      lines.push(`Patterns : ${patterns.length}`);
      lines.push(`Matches  : ${totalMatches}`);
      lines.push(`Files    : ${allUniqueFiles.size}`);
      lines.push("");

      for (const pRes of patternResults) {
        if (pRes.error) {
          lines.push(`${pRes.pattern} : Error (${pRes.error})`);
        } else {
          lines.push(`${pRes.pattern} : ${pRes.matches.length} matches`);
        }
      }

      output(lines.join("\n"), "success");
    } catch (err) {
      console.error(err);
      output(["===== BATCH SEARCH ERROR =====", err.message].join("\n"), "error");
    }
  }

  /* =========================================================
     TERMINAL & RUN CONTROLLERS
     ========================================================= */

  async function runTerminal() {
    const input = $("terminal-input");
    if (!input) return;
    const command = input.value.trim();
    if (!command) return;

    try {
      await executeCommand(command);
    } catch (err) {
      console.error(err);
      output(`ERROR: ${err.message}`, "error");
    }
  }

  function runCurrentFile() {
    if (!state.currentFile) {
      output("No file selected.", "error");
      return;
    }

    const file = state.fileMap.get(state.currentFile);
    if (!file) return;

    const extension = state.currentFile.split(".").pop().toLowerCase();
    if (extension === "html") {
      const editor = $("editor");
      const wrapper = $("preview-frame-wrapper");
      if (!editor || !wrapper) return;

      wrapper.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "0";
      wrapper.appendChild(iframe);
      iframe.srcdoc = editor.value;
      return;
    }

    output(`Preview/run is only supported for HTML in browser mode.\nCurrent file: ${state.currentFile}`);
  }

  /* =========================================================
     EVENT BINDINGS & INIT
     ========================================================= */

  function bindEvents() {
    $("open-folder")?.addEventListener("click", openFolder);
    $("terminal-run")?.addEventListener("click", runTerminal);

    $("terminal-input")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        runTerminal();
      }
    });

    $("terminal-clear")?.addEventListener("click", () => output(""));

    $("terminal-copy")?.addEventListener("click", async () => {
      const text = $("output")?.textContent || "";
      await navigator.clipboard.writeText(text);
    });

    $("terminal-paste")?.addEventListener("click", async () => {
      const input = $("terminal-input");
      if (!input) return;
      input.value = await navigator.clipboard.readText();
      input.focus();
    });

    $("editor-save")?.addEventListener("click", saveCurrentFile);
    $("editor-clear")?.addEventListener("click", clearEditor);
    $("editor-copy")?.addEventListener("click", copyEditor);
    $("editor-paste")?.addEventListener("click", pasteEditor);
    $("editor-run")?.addEventListener("click", runCurrentFile);

    $("editor-cancel")?.addEventListener("click", cancelEditorChanges);
    $("editor-undo")?.addEventListener("click", undoEditor);
    $("editor-redo")?.addEventListener("click", redoEditor);
    $("editor-minimize")?.addEventListener("click", toggleEditorMinimize);

    $("editor")?.addEventListener("input", () => {
      updateLineNumbers();
      recordEditorHistory();
    });
    $("editor")?.addEventListener("scroll", () => {
      const editor = $("editor");
      const numbers = $("line-numbers");
      if (editor && numbers) numbers.scrollTop = editor.scrollTop;
    });
  }

  function initialize() {
    bindEvents();
    updateLineNumbers();
    output([
      "PS Web Batch Grep Engine Active.",
      "",
      "Open a folder to begin search.",
      "",
      'Single: grep "keyword"',
      'Batch : grep-batch "Idle" "Running" "EndTimestamp"'
    ].join("\n"));
  }

  // Expose State, Helpers, & Core APIs to Shared Namespace
  window.PSWeb.state = state;
  window.PSWeb.output = output;
  window.PSWeb.executeCommand = executeCommand;
  window.PSWeb.legacyExecute = executeCommand;
  window.PSWeb.initialize = initialize;

  // Expose Grep Engine Core APIs
  window.PSWeb.grepFiles = grepFiles;
  window.PSWeb.grepBatchFiles = grepBatchFiles;
  window.PSWeb.runSearch = runSearch;
  window.PSWeb.runBatchSearch = runBatchSearch;
})();
