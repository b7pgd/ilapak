/* ==========================================================================
   DEVELOPER WORKSPACE - CORE STATE & UI MANAGEMENT (engine1.js)
   ========================================================================== */

/**
 * Single State Store
 */
const state = {
  directoryHandle: null,
  currentFile: null,
  currentFileHandle: null,
  files: [],
  folders: [],
  editorContent: "",
  editorDirty: false,
  currentMode: "terminal",
  terminalCommand: "",
  terminalOutput: "",
  logOutput: "",
  lastSearchResult: null,
  diagnostics: [],
  serverRunning: false,
  serverPort: 8080,
  previewUrl: null,

  searchEngine: {
    lastResult: null,
    lastError: null,
    pipelineType: null,
    history: []
  }
};

/* ==========================================================================
   SEARCH ENGINE RESULT & DIAGNOSTIC SYSTEM
   ========================================================================== */

/**
 * Search result contract.
 *
 * Every terminal operation can report one of these states:
 *
 * - matches
 * - empty
 * - property-error
 * - pipeline-error
 * - command-error
 * - engine-error
 */
const SEARCH_RESULT_TYPES = Object.freeze({
  MATCHES: "matches",
  EMPTY: "empty",
  PROPERTY_ERROR: "property-error",
  PIPELINE_ERROR: "pipeline-error",
  COMMAND_ERROR: "command-error",
  ENGINE_ERROR: "engine-error"
});

/**
 * Creates a normalized search result.
 */
function createSearchResult(type, data = [], meta = {}) {
  return {
    __searchResult: true,

    ok: ![
      SEARCH_RESULT_TYPES.PROPERTY_ERROR,
      SEARCH_RESULT_TYPES.PIPELINE_ERROR,
      SEARCH_RESULT_TYPES.COMMAND_ERROR,
      SEARCH_RESULT_TYPES.ENGINE_ERROR
    ].includes(type),

    type,
    data,
    command: meta.command || null,
    message: meta.message || null,
    property: meta.property || null,
    availableProperties: Array.isArray(meta.availableProperties)
      ? meta.availableProperties
      : [],
    inputType: meta.inputType || null,
    outputType: meta.outputType || null,
    details: meta.details || null
  };
}

/**
 * Detect the logical type of pipeline data.
 */
function getPipelineType(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return "Boolean";
  }

  if (typeof value === "string") {
    return "String";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "Array<unknown>";
    }

    const first = value[0];

    if (
      first &&
      typeof first === "object" &&
      first.file &&
      first.content !== undefined
    ) {
      return "FileContent[]";
    }

    if (
      first &&
      typeof first === "object" &&
      first.Path !== undefined &&
      first.LineNumber !== undefined &&
      first.Line !== undefined
    ) {
      return "Match[]";
    }

    if (
      first &&
      typeof first === "object" &&
      first.handle
    ) {
      return "File[]";
    }

    if (
      first &&
      typeof first === "object"
    ) {
      return "Object[]";
    }

    return `${typeof first}[]`;
  }

  if (typeof value === "object") {
    return "Object";
  }

  return typeof value;
}

/**
 * Get available properties from a pipeline item.
 */
function getAvailableProperties(item) {
  if (!item || typeof item !== "object") {
    return [];
  }

  return Object.keys(item);
}

/**
 * Validate requested Select-Object properties.
 *
 * This prevents mysterious "{}" output when a property
 * does not exist on the current pipeline object.
 */
function validateObjectProperties(inputData, properties, command = "Select-Object") {
  if (!Array.isArray(inputData) || inputData.length === 0) {
    return createSearchResult(
      SEARCH_RESULT_TYPES.EMPTY,
      [],
      {
        command,
        inputType: getPipelineType(inputData),
        outputType: "Array<unknown>"
      }
    );
  }

  const validProperties = [];
  const missingProperties = new Set();
  const availableProperties = new Set();

  for (const item of inputData) {
    if (!item || typeof item !== "object") {
      continue;
    }

    for (const key of Object.keys(item)) {
      availableProperties.add(key);
    }

    for (const property of properties) {
      if (Object.prototype.hasOwnProperty.call(item, property)) {
        validProperties.push(property);
      } else {
        missingProperties.add(property);
      }
    }
  }

  /*
   * If every requested property is missing,
   * this is almost certainly a bad pipeline/property request.
   */
  const uniqueRequested = [
    ...new Set(properties)
  ];

  const allMissing = uniqueRequested.length > 0 &&
    uniqueRequested.every(property =>
      missingProperties.has(property)
    );

  if (allMissing) {
    return createSearchResult(
      SEARCH_RESULT_TYPES.PROPERTY_ERROR,
      [],
      {
        command,
        property: uniqueRequested.join(", "),
        availableProperties: [...availableProperties],
        inputType: getPipelineType(inputData),
        outputType: null,
        message:
          `Requested property '${uniqueRequested.join(", ")}' does not exist on the input object.`
      }
    );
  }

  /*
   * Some properties may exist while others don't.
   * This is still useful information, but not a fatal
   * pipeline error if at least one requested property exists.
   */
  return null;
}

/**
 * Convert raw engine output into a normalized result.
 */
function normalizeSearchResult(result) {
  /*
   * Already normalized diagnostic/result.
   */
  if (
    result &&
    typeof result === "object" &&
    result.__searchResult === true
  ) {
    return result;
  }

  /*
   * null / undefined = empty result.
   */
  if (
    result === null ||
    result === undefined
  ) {
    return markSearchResult(
      createSearchResult(
        SEARCH_RESULT_TYPES.EMPTY,
        []
      )
    );
  }

  /*
   * Boolean result.
   */
  if (typeof result === "boolean") {
    return markSearchResult(
      createSearchResult(
        SEARCH_RESULT_TYPES.MATCHES,
        result
      )
    );
  }

  /*
   * Array result.
   */
  if (Array.isArray(result)) {
    if (result.length === 0) {
      return markSearchResult(
        createSearchResult(
          SEARCH_RESULT_TYPES.EMPTY,
          []
        )
      );
    }

    return markSearchResult(
      createSearchResult(
        SEARCH_RESULT_TYPES.MATCHES,
        result,
        {
          inputType: getPipelineType(result),
          outputType: getPipelineType(result)
        }
      )
    );
  }

  /*
   * Generic scalar/object result.
   */
  return markSearchResult(
    createSearchResult(
      SEARCH_RESULT_TYPES.MATCHES,
      result,
      {
        inputType: getPipelineType(result),
        outputType: getPipelineType(result)
      }
    )
  );
}

/**
 * Mark normalized result so it can safely travel through
 * the existing terminal system.
 */
function markSearchResult(result) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return result;
  }

  result.__searchResult = true;

  return result;
}

/**
 * Human-readable diagnostic formatter.
 */
function formatSearchDiagnostic(result) {
  const normalized =
    normalizeSearchResult(result);

  /*
   * --------------------------------------------------------------
   * EMPTY
   * --------------------------------------------------------------
   */
  if (
    normalized.type ===
    SEARCH_RESULT_TYPES.EMPTY
  ) {
    return [
      "===== SEARCH RESULT =====",
      "No matches found.",
      "===== 0 MATCHES ====="
    ].join("\n");
  }

  /*
   * --------------------------------------------------------------
   * PROPERTY ERROR
   * --------------------------------------------------------------
   */
  if (
    normalized.type ===
    SEARCH_RESULT_TYPES.PROPERTY_ERROR
  ) {
    return [
      "===== PIPELINE ERROR =====",
      normalized.message ||
        "Requested property does not exist.",
      "",
      `Input type: ${
        normalized.inputType || "unknown"
      }`,
      "",
      "Available properties:",
      ...(
        normalized.availableProperties &&
        normalized.availableProperties.length > 0
          ? normalized.availableProperties.map(
              property => `- ${property}`
            )
          : ["- none"]
      ),
      "",
      "===== COMMAND FAILED ====="
    ].join("\n");
  }

  /*
   * --------------------------------------------------------------
   * PIPELINE ERROR
   * --------------------------------------------------------------
   */
  if (
    normalized.type ===
    SEARCH_RESULT_TYPES.PIPELINE_ERROR
  ) {
    return [
      "===== PIPELINE ERROR =====",
      normalized.message ||
        "Pipeline execution failed.",
      "",
      normalized.inputType
        ? `Input type: ${normalized.inputType}`
        : null,
      normalized.outputType
        ? `Output type: ${normalized.outputType}`
        : null,
      "",
      "===== COMMAND FAILED ====="
    ]
      .filter(value => value !== null)
      .join("\n");
  }

  /*
   * --------------------------------------------------------------
   * COMMAND ERROR
   * --------------------------------------------------------------
   */
  if (
    normalized.type ===
    SEARCH_RESULT_TYPES.COMMAND_ERROR
  ) {
    return [
      "===== COMMAND ERROR =====",
      normalized.message ||
        "Command execution failed.",
      "",
      "===== COMMAND FAILED ====="
    ].join("\n");
  }

  /*
   * --------------------------------------------------------------
   * ENGINE ERROR
   * --------------------------------------------------------------
   */
  if (
    normalized.type ===
    SEARCH_RESULT_TYPES.ENGINE_ERROR
  ) {
    return [
      "===== ENGINE ERROR =====",
      normalized.message ||
        "Unexpected search engine failure.",
      "",
      "===== ENGINE FAILED ====="
    ].join("\n");
  }

  /*
   * --------------------------------------------------------------
   * SUCCESS / MATCHES
   * --------------------------------------------------------------
   *
   * IMPORTANT:
   * The actual array is inside normalized.data.
   * Never stringify the wrapper itself.
   */
  return formatNormalizedMatches(
    normalized.data
  );
}

/**
 * Format successful search results.
 *
 * Keeps the existing atomic:
 * Path:Line >>> Code
 * format.
 */
function formatNormalizedMatches(results) {
  if (
    results === null ||
    results === undefined
  ) {
    return "No results.";
  }

  if (typeof results === "boolean") {
    return results ? "True" : "False";
  }

  if (!Array.isArray(results)) {
    return String(results);
  }

  if (results.length === 0) {
    return [
      "===== SEARCH RESULT =====",
      "No matches found.",
      "===== 0 MATCHES ====="
    ].join("\n");
  }

  let output =
    "===== SEARCH RESULT =====\n";

  for (const result of results) {

    if (
      result &&
      result.Path !== undefined &&
      result.LineNumber !== undefined &&
      result.Line !== undefined
    ) {
      output +=
        `${result.Path}:${result.LineNumber} >>> ${result.Line}\n`;

      continue;
    }

    if (
      result &&
      typeof result === "object"
    ) {
      output +=
        JSON.stringify(result) + "\n";

      continue;
    }

    output +=
      String(result) + "\n";
  }

  output +=
    `===== ${results.length} MATCHES =====`;

  return output;
}

/**
 * Central error conversion.
 *
 * Converts ordinary JavaScript errors into structured
 * search-engine diagnostics.
 */
function createSearchError(err, meta = {}) {
  const message =
    err instanceof Error
      ? err.message
      : String(err);

  return markSearchResult(
    createSearchResult(
      meta.type || SEARCH_RESULT_TYPES.ENGINE_ERROR,
      [],
      {
        command: meta.command || null,
        message,
        property: meta.property || null,
        availableProperties:
          meta.availableProperties || [],
        inputType:
          meta.inputType || null,
        outputType:
          meta.outputType || null,
        details:
          meta.details || null
      }
    )
  );
}

/**
 * DOM Elements Cache
 */
const elements = {};

/**
 * Rules & Exclusions
 */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.next', '.next-scanner', '.git', 'dist', 'build', 'out',
  'coverage', 'vendor', 'cache', 'temp', 'generated'
]);

const EXCLUDED_EXTENSIONS = new Set([
  'map', 'min.js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2',
  'ttf', 'eot', 'zip', 'tar', 'gz', 'pdf', 'exe', 'dll', 'so', 'dylib', 'bin', 'base64'
]);

const UNSUPPORTED_COMMANDS = new Set([
  'npm', 'node', 'go', 'flutter', 'python', 'powershell', 'cmd', 'bash', 'termux'
]);

/* ==========================================================================
   APP INITIALIZATION HELPERS
   ========================================================================== */

function cacheDOM() {
  const ids = [
    'open-folder', 'file-tree', 'current-file', 'editor', 'line-numbers',
    'editor-save', 'editor-clear', 'editor-copy', 'editor-paste', 'editor-run',
    'mode-terminal', 'mode-log', 'terminal-input', 'output',
    'terminal-run', 'terminal-paste', 'terminal-copy', 'terminal-clear', 'status'
  ];

  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) {
      console.error(`DOM Error: Required element #${id} not found.`);
      throw new Error(`Initialization failed. Missing contract DOM element: #${id}`);
    }
    elements[id] = el;
  }

  // Wrapper optional untuk preview
  elements['preview-wrapper'] = document.getElementById('preview-frame-wrapper');
}

function initializeState() {
  state.directoryHandle = null;
  state.currentFile = null;
  state.currentFileHandle = null;
  state.files = [];
  state.folders = [];
  state.editorContent = "";
  state.editorDirty = false;
  state.currentMode = "terminal";
  state.terminalCommand = "";
  state.terminalOutput = "Welcome to Browser Search Engine Terminal.\nEnter PowerShell-like command to search source code.\n";
  state.logOutput = "";
  state.lastSearchResult = null;
  state.diagnostics = [];
  state.serverRunning = false;
  state.previewUrl = null;

  state.searchEngine = {
    lastResult: null,
    lastError: null,
    pipelineType: null,
    history: []
  };
}

function bindEvents() {
  // Folder
  elements['open-folder'].addEventListener('click', openProjectFolder);

  // Editor Actions
  elements['editor-save'].addEventListener('click', saveCurrentFile);
  elements['editor-clear'].addEventListener('click', clearEditor);
  elements['editor-copy'].addEventListener('click', copyEditor);
  elements['editor-paste'].addEventListener('click', pasteEditor);
  elements['editor-run'].addEventListener('click', runWebProject);

  // Editor Inputs
  elements['editor'].addEventListener('input', handleEditorInput);
  elements['editor'].addEventListener('scroll', syncEditorScroll);

  // Modes
  elements['mode-terminal'].addEventListener('click', () => setMode('terminal'));
  elements['mode-log'].addEventListener('click', () => setMode('log'));

  // Terminal Input
  elements['terminal-input'].addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runTerminalCommand();
    }
  });

  // Terminal Actions
  elements['terminal-run'].addEventListener('click', runTerminalCommand);
  elements['terminal-paste'].addEventListener('click', pasteTerminal);
  elements['terminal-copy'].addEventListener('click', copyTerminal);
  elements['terminal-clear'].addEventListener('click', clearTerminal);
}

function initializeEditor() {
  elements['editor'].value = "";
  updateLineNumbers();
}

function initializeModes() {
  setMode("terminal");
}

function initializeButtons() {
  updateButtonStates();
}

function setInitialUI() {
  setStatus("No folder opened", "neutral");
  renderOutput();
}

/* ==========================================================================
   UI & STATUS MANAGEMENT
   ========================================================================== */

function setStatus(message, type = "neutral") {
  if (!elements['status']) return;
  elements['status'].textContent = message;
  elements['status'].className = `status-${type}`;
}

function recordSearchResult(result) {
  const normalized =
    normalizeSearchResult(result);

  state.searchEngine.lastResult =
    normalized;

  state.searchEngine.lastError =
    normalized.ok
      ? null
      : normalized;

  state.searchEngine.pipelineType =
    getPipelineType(normalized.data);

  state.searchEngine.history.push({
    type: normalized.type,
    ok: normalized.ok,
    timestamp: Date.now(),
    inputType: normalized.inputType,
    outputType: normalized.outputType,
    message: normalized.message
  });

  /*
   * Prevent unlimited history growth.
   */
  if (
    state.searchEngine.history.length > 100
  ) {
    state.searchEngine.history.shift();
  }

  return normalized;
}

function updateButtonStates() {
  elements['editor-save'].disabled = !(state.currentFileHandle && state.editorDirty);
  elements['editor-clear'].disabled = elements['editor'].value.length === 0;
  elements['editor-copy'].disabled = elements['editor'].value.length === 0;
  elements['editor-run'].disabled = !state.directoryHandle;

  elements['terminal-copy'].disabled = !state.lastSearchResult;
  elements['terminal-clear'].disabled = state.terminalOutput.length === 0 && state.diagnostics.length === 0;
}

function renderOutput() {
  const container = elements['output'];
  container.innerHTML = "";

  if (state.currentMode === "terminal") {
    container.textContent = state.terminalOutput;
  } else if (state.currentMode === "log") {
    if (state.diagnostics.length === 0) {
      container.textContent = "No problems or diagnostics detected.";
    } else {
      renderDiagnostics(state.diagnostics);
    }
  }
}

function setMode(mode) {
  if (mode !== "terminal" && mode !== "log") return;
  state.currentMode = mode;

  if (mode === "terminal") {
    elements['mode-terminal'].classList.add('active');
    elements['mode-log'].classList.remove('active');
  } else {
    elements['mode-log'].classList.add('active');
    elements['mode-terminal'].classList.remove('active');
  }

  renderOutput();
}

/* ==========================================================================
   FOLDER & FILE SYSTEM ACCESS API
   ========================================================================== */

async function openProjectFolder() {
  if (!window.showDirectoryPicker) {
    setStatus("File System Access API is not supported in this browser", "error");
    return;
  }

  try {
    const handle = await window.showDirectoryPicker();
    state.directoryHandle = handle;
    state.files = [];
    state.folders = [];

    setStatus(`Scanning ${handle.name}...`, "neutral");
    await scanDirectory(handle, "");

    renderFileTree();
    setStatus(`Loaded folder: ${handle.name}`, "success");
    updateButtonStates();
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus("Folder selection cancelled", "neutral");
    } else {
      setStatus(`Error opening folder: ${err.message}`, "error");
    }
  }
}

async function refreshFilesystemState(options = {}) {
  if (!state.directoryHandle) {
    return false;
  }

  const currentPath = state.currentFile;
  const wasDirty = state.editorDirty;

  state.files = [];
  state.folders = [];

  await scanDirectory(state.directoryHandle, "");

  if (currentPath) {
    const currentFile = state.files.find(
      file => file.path === currentPath
    );

    if (currentFile) {
      state.currentFileHandle = currentFile.handle;

      if (!wasDirty) {
        try {
          const content = await readFile(currentFile.handle);

          state.editorContent = content;

          const editor = elements['editor'];
          if (editor) {
            editor.value = content;
          }

          if (typeof runDiagnostics === 'function') {
            runDiagnostics();
          }
        } catch (err) {
          console.warn(
            `[FS Refresh] Failed to refresh current file '${currentPath}':`,
            err
          );
        }
      }
    } else {
      state.currentFileHandle = null;
    }
  }

  if (options.render !== false) {
    renderFileTree();
    updateButtonStates();
  }

  return true;
}

async function scanDirectory(directoryHandle, relativePath = "") {
  for await (const entry of directoryHandle.values()) {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      state.folders.push({ name: entry.name, path: entryPath, handle: entry });
      await scanDirectory(entry, entryPath);
    } else if (entry.kind === 'file') {
      const ext = entry.name.split('.').pop().toLowerCase();
      if (EXCLUDED_EXTENSIONS.has(ext)) continue;

      state.files.push({
        name: entry.name,
        path: entryPath,
        handle: entry,
        extension: ext
      });
    }
  }
}


async function readFile(handle) {
  try {
    const file = await handle.getFile();
    return await file.text();
  } catch (err) {
    setStatus(`Failed to read file: ${err.message}`, "error");
    throw err;
  }
}

async function writeFile(handle, content) {
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (err) {
    setStatus(`Failed to write file: ${err.message}`, "error");
    throw err;
  }
}

async function openFile(fileItem) {
  try {
    const content = await readFile(fileItem.handle);
    state.currentFile = fileItem.path;
    state.currentFileHandle = fileItem.handle;
    state.editorContent = content;
    state.editorDirty = false;

    elements['current-file'].textContent = fileItem.path;
    elements['editor'].value = content;

    updateLineNumbers();
    runDiagnostics();
    updateButtonStates();
    renderFileTree();
    setStatus(`Opened file: ${fileItem.path}`, "neutral");
  } catch (err) {
    setStatus(`Could not open file: ${err.message}`, "error");
  }
}

async function saveCurrentFile() {
  if (!state.currentFileHandle) return;

  try {
    state.editorContent = elements['editor'].value;
    await writeFile(state.currentFileHandle, state.editorContent);
    state.editorDirty = false;

    setStatus(`Saved: ${state.currentFile}`, "success");
    updateButtonStates();
    runDiagnostics();
  } catch (err) {
    setStatus(`Save error: ${err.message}`, "error");
  }
}

/* ==========================================================================
   FILE EXPLORER RENDERER
   ========================================================================== */

function renderFileTree() {
  const container = elements['file-tree'];
  container.innerHTML = "";

  if (!state.directoryHandle) {
    container.textContent = "No folder loaded.";
    return;
  }

  // Build hierarchical structure
  const root = { name: state.directoryHandle.name, type: "folder", children: {} };

  state.files.forEach(file => {
    const parts = file.path.split('/');
    let current = root;

    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        current.children[part] = { name: part, type: "file", item: file };
      } else {
        if (!current.children[part]) {
          current.children[part] = { name: part, type: "folder", children: {} };
        }
        current = current.children[part];
      }
    });
  });

  const ul = createTreeDOM(root.children);
  container.appendChild(ul);
}

function createTreeDOM(nodeChildren) {
  const ul = document.createElement('ul');

  Object.keys(nodeChildren).sort().forEach(key => {
    const node = nodeChildren[key];
    const li = document.createElement('li');

    if (node.type === 'folder') {
      const folderDiv = document.createElement('div');
      folderDiv.className = 'tree-item tree-folder';
      folderDiv.textContent = `📁 ${node.name}`;
      li.appendChild(folderDiv);

      const subUl = createTreeDOM(node.children);
      li.appendChild(subUl);
    } else {
      const fileDiv = document.createElement('div');
      fileDiv.className = 'tree-item tree-file';
      if (state.currentFile === node.item.path) {
        fileDiv.classList.add('selected');
      }
      fileDiv.textContent = `📄 ${node.name}`;
      fileDiv.addEventListener('click', () => selectFile(node.item));
      li.appendChild(fileDiv);
    }

    ul.appendChild(li);
  });

  return ul;
}

function selectFile(fileItem) {
  openFile(fileItem);
}

/* ==========================================================================
   CODE EDITOR LOGIC
   ========================================================================== */

function handleEditorInput() {
  state.editorContent = elements['editor'].value;
  state.editorDirty = true;
  updateLineNumbers();
  updateButtonStates();
  runDiagnostics();
}

function updateLineNumbers() {
  const lines = elements['editor'].value.split('\n').length;
  let lineStr = "";
  for (let i = 1; i <= lines; i++) {
    lineStr += i + '\n';
  }
  elements['line-numbers'].textContent = lineStr;
}

function syncEditorScroll() {
  elements['line-numbers'].scrollTop = elements['editor'].scrollTop;
}

function clearEditor() {
  elements['editor'].value = "";
  state.editorContent = "";
  state.editorDirty = true;
  updateLineNumbers();
  updateButtonStates();
  runDiagnostics();
  setStatus("Editor cleared (Unsaved)", "neutral");
}

async function copyEditor() {
  try {
    await navigator.clipboard.writeText(elements['editor'].value);
    setStatus("Editor content copied to clipboard", "success");
  } catch (err) {
    setStatus("Clipboard copy permission denied", "error");
  }
}

async function pasteEditor() {
  try {
    const text = await navigator.clipboard.readText();
    elements['editor'].value += text;
    handleEditorInput();
    setStatus("Content pasted into editor", "neutral");
  } catch (err) {
    setStatus("Clipboard paste permission denied", "error");
  }
}

/* ==========================================================================
   ENGINE1 GLOBAL API BOUNDARY EXPOSE
   ========================================================================== */

window.PSWeb = Object.assign(window.PSWeb || {}, {
  state,
  SEARCH_RESULT_TYPES,
  createSearchResult,
  normalizeSearchResult,
  markSearchResult,
  createSearchError,
  recordSearchResult
});
