/* ==========================================================================
   DEVELOPER WORKSPACE - RUNNER, SEARCH & DIAGNOSTICS ENGINE (engine2.js)
   ========================================================================== */

/* ==========================================================================
   WEB RUNNER & PREVIEW ENGINE
   ========================================================================== */

async function runWebProject() {
  if (!state.directoryHandle) {
    setStatus("Cannot run: No project folder opened", "error");
    return;
  }
  await refreshFilesystemState({
    render: false
  });

  const wrapper = elements['preview-wrapper'];
  if (!wrapper) return;

  // Search entry point HTML
  let indexFile = state.files.find(f => f.name.toLowerCase() === 'index.html');
  if (!indexFile) {
    indexFile = state.files.find(f => f.extension === 'html');
  }

  if (!indexFile) {
    setStatus("Cannot run: No HTML file found in project", "error");
    return;
  }

  try {
    let htmlContent = await readFile(indexFile.handle);

    // Bundle inline CSS if referenced locally
    for (const file of state.files) {
      if (file.extension === 'css') {
        const cssContent = await readFile(file.handle);
        htmlContent = `<style>\n/* Inline file: ${file.path} */\n${cssContent}\n</style>\n` + htmlContent;
      }
    }

    // Bundle inline JS if referenced locally
    for (const file of state.files) {
      if (file.extension === 'js' && file.name !== 'engine.js') {
        const jsContent = await readFile(file.handle);
        htmlContent += `\n<script>\n/* Inline file: ${file.path} */\n${jsContent}\n</script>`;
      }
    }

    wrapper.innerHTML = "";
    const iframe = document.createElement('iframe');
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.sandbox = "allow-scripts allow-modals";
    iframe.srcdoc = htmlContent;

    wrapper.appendChild(iframe);
    setStatus(`Preview running for ${indexFile.path} (Browser Isolated Preview)`, "success");
  } catch (err) {
    setStatus(`Preview failed: ${err.message}`, "error");
  }
}

function stopWebProject() {
  if (elements['preview-wrapper']) {
    elements['preview-wrapper'].innerHTML = "";
  }
  setStatus("Preview stopped", "neutral");
}

function refreshPreview() {
  runWebProject();
}

function openPreview() {
  runWebProject();
}

/* ==========================================================================
   COMMAND PARSER & VALIDATOR
   ========================================================================== */

function parseVariableAssignment(rawCommand) {
  const match = String(rawCommand || '').match(
    /^\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/s
  );

  if (!match) {
    return null;
  }

  return {
    name: match[1],
    command: match[2].trim()
  };
}

function parseCommand(rawCommand) {
  let source = String(rawCommand || '').trim();

  if (!source) {
    return null;
  }

  /*
   * Split top-level statements.
   *
   * Normal newline:
   *   statement 1
   *
   *   statement 2
   *
   * becomes two commands.
   *
   * PowerShell continuation:
   *   command `
   *   | next-command
   *
   * remains one command.
   */
  const statements = [];
  let currentStatement = "";
  let quote = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    /*
     * PowerShell-style line continuation.
     */
    if (char === "`") {
      if (
        i + 1 < source.length &&
        (source[i + 1] === "\n" || source[i + 1] === "\r")
      ) {
        currentStatement += " ";

        if (source[i + 1] === "\r") {
          i++;
          if (
            i + 1 < source.length &&
            source[i + 1] === "\n"
          ) {
            i++;
          }
        } else {
          i++;
        }

        while (
          i + 1 < source.length &&
          /\s/.test(source[i + 1])
        ) {
          i++;
        }

        continue;
      }

      currentStatement += char;
      continue;
    }

    /*
     * Quote handling.
     */
    if (char === "\\" && i + 1 < source.length) {
      currentStatement += char;
      currentStatement += source[i + 1];
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      if (quote === null) {
        quote = char;
      } else if (quote === char) {
        quote = null;
      }

      currentStatement += char;
      continue;
    }

    /*
     * Normal newline outside quotes = new statement.
     */
    if (
  (char === "\n" || char === "\r") &&
  quote === null
) {
  /*
   * PowerShell allows a newline after a pipe
   * without requiring a backtick.
   *
   * Example:
   *
   * Get-ChildItem "." |
   * Select-String -Pattern "foo" |
   * Select-Object Path,Line
   *
   * This must remain ONE pipeline statement.
   */
  if (currentStatement.trim().endsWith("|")) {
    currentStatement += " ";

    if (
      char === "\r" &&
      i + 1 < source.length &&
      source[i + 1] === "\n"
    ) {
      i++;
    }

    while (
      i + 1 < source.length &&
      /\s/.test(source[i + 1])
    ) {
      i++;
    }

    continue;
  }

  /*
   * Normal top-level newline = new statement.
   */
  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }

  currentStatement = "";

  if (
    char === "\r" &&
    i + 1 < source.length &&
    source[i + 1] === "\n"
  ) {
    i++;
  }

  continue;
}

    currentStatement += char;
  }

  if (quote !== null) {
    throw new Error(`Unclosed quote: ${quote}`);
  }

  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }

  /*
   * Parse each statement as an independent pipeline.
   */
  const parsedStatements = [];

  for (const statement of statements) {
    const pipelines = [];
    let current = "";
    let pipelineQuote = null;

    for (let i = 0; i < statement.length; i++) {
      const char = statement[i];

      if (char === "\\" && i + 1 < statement.length) {
        current += char;
        current += statement[i + 1];
        i++;
        continue;
      }

      if (char === '"' || char === "'") {
        if (pipelineQuote === null) {
          pipelineQuote = char;
        } else if (pipelineQuote === char) {
          pipelineQuote = null;
        }

        current += char;
        continue;
      }

      if (char === "|" && pipelineQuote === null) {
        if (current.trim()) {
          pipelines.push(current.trim());
        }

        current = "";
        continue;
      }

      current += char;
    }

    if (pipelineQuote !== null) {
      throw new Error(`Unclosed quote: ${pipelineQuote}`);
    }

    if (current.trim()) {
      pipelines.push(current.trim());
    }

    const operations = [];

    for (const pipe of pipelines) {
      const tokens = tokenizeCommand(pipe);

      if (tokens.length === 0) {
        continue;
      }

      const command = tokens[0];
      const args = parseArgs(tokens.slice(1));

      operations.push({
        command,
        args
      });
    }

    if (operations.length > 0) {
      parsedStatements.push({
        type: "pipeline",
        operations
      });
    }
  }

  if (parsedStatements.length === 0) {
    return null;
  }

  /*
   * One statement keeps the existing API unchanged.
   */
  if (parsedStatements.length === 1) {
    return parsedStatements[0];
  }

  /*
   * Multiple top-level statements.
   */
  return {
    type: "script",
    statements: parsedStatements
  };
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    /*
     * Basic escape support.
     */
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
  current += char;
  escaped = true;
  continue;
}

    /*
     * Quote handling.
     */
    if (char === '"' || char === "'") {
      if (quote === null) {
        quote = char;
        continue;
      }

      if (quote === char) {
        quote = null;
        continue;
      }

      current += char;
      continue;
    }

    /*
     * Outside quotes, whitespace separates tokens.
     */
    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new Error(`Unclosed quote: ${quote}`);
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseArgs(tokens) {
  const args = {
    positional: [],
    flags: {}
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (!token) {
      continue;
    }

    /*
     * PowerShell-style flag.
     *
     * -Pattern "foo"
     * -Recurse
     * -First 90
     */
    if (token.startsWith("-")) {
      const flagName = token
        .substring(1)
        .toLowerCase();

      if (!flagName) {
        continue;
      }

      const nextToken = tokens[i + 1];

      if (
        nextToken !== undefined &&
        !nextToken.startsWith("-")
      ) {
        args.flags[flagName] = nextToken;
        i++;
      } else {
        args.flags[flagName] = true;
      }

      continue;
    }

    /*
     * Support:
     *
     * Get-Content engine.js,engine1.js,engine2.js
     */
    const values = token
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    args.positional.push(...values);
  }

  return args;
}

function validateCommand(parsedCommand) {
  if (!parsedCommand || (!parsedCommand.operations && !parsedCommand.statements)) {
    throw new Error("Invalid command.");
  }

  if (parsedCommand.statements) {
    for (const stmt of parsedCommand.statements) {
      validateCommand(stmt);
    }
    return true;
  }

  for (const op of parsedCommand.operations) {
    const cmdLower = op.command.toLowerCase();

    if (typeof UNSUPPORTED_COMMANDS !== 'undefined' && UNSUPPORTED_COMMANDS.has && UNSUPPORTED_COMMANDS.has(cmdLower)) {
      throw new Error(
        `ERROR: Command '${op.command}' tidak didukung oleh Web Search Engine.`
      );
    }
  }

  return true;
}

/* ==========================================================================
   SEARCH ENGINE REGISTRY & EXTENSION API (FOR ENGINE3)
   ========================================================================== */

const searchCommandHooks = {};

function registerSearchCommand(commandName, handler) {
  if (typeof commandName !== 'string' || typeof handler !== 'function') {
    throw new Error("Invalid search command hook registration.");
  }
  searchCommandHooks[commandName.toLowerCase()] = handler;
}

function unregisterSearchCommand(commandName) {
  if (typeof commandName === 'string') {
    delete searchCommandHooks[commandName.toLowerCase()];
  }
}


/* ==========================================================================
   BROWSER SEARCH ENGINE IMPLEMENTATION
   ========================================================================== */

async function runTerminalCommand() {
  const input = elements['terminal-input'].value.trim();

  if (!input) {
    return;
  }

  state.terminalCommand = input;
  state.terminalOutput += `\nPS> ${input}\n`;

  try {
    const parsed = parseCommand(input);

    validateCommand(parsed);

    const result = await executeSearch(parsed);

    if (
      result &&
      result.__scriptResult === true
    ) {
      /*
       * Multiline script.
       *
       * Write-Host output is displayed directly.
       * Only the final search result goes through
       * the normal search formatter.
       */
      if (
        Array.isArray(result.hostOutput) &&
        result.hostOutput.length > 0
      ) {
        state.terminalOutput +=
          result.hostOutput.join("\n") + "\n";
      }

      const normalized =
        recordSearchResult(result.result);

      const formatted =
        formatSearchDiagnostic(normalized);

      state.lastSearchResult = formatted;

      state.terminalOutput +=
        formatted + "\n";

      if (normalized.ok) {
        setStatus(
          normalized.type === SEARCH_RESULT_TYPES.EMPTY
            ? "Search complete: no matches"
            : "Search complete",
          normalized.type === SEARCH_RESULT_TYPES.EMPTY
            ? "neutral"
            : "success"
        );
      } else {
        setStatus(
          normalized.message ||
            "Search command failed",
          "error"
        );
      }

    } else {
      /*
       * Existing single-command behavior.
       */
      const normalized =
        recordSearchResult(result);

      const formatted =
        formatSearchDiagnostic(normalized);

      state.lastSearchResult = formatted;

      state.terminalOutput +=
        formatted + "\n";

      if (normalized.ok) {
        setStatus(
          normalized.type === SEARCH_RESULT_TYPES.EMPTY
            ? "Search complete: no matches"
            : "Search complete",
          normalized.type === SEARCH_RESULT_TYPES.EMPTY
            ? "neutral"
            : "success"
        );
      } else {
        setStatus(
          normalized.message ||
            "Search command failed",
          "error"
        );
      }
    }

  } catch (err) {
    const diagnostic = createSearchError(err, {
      type: SEARCH_RESULT_TYPES.ENGINE_ERROR,
      command: state.terminalCommand
    });

    recordSearchResult(diagnostic);

    const formatted =
      formatSearchDiagnostic(diagnostic);

    state.terminalOutput +=
      formatted + "\n";

    state.lastSearchResult =
      formatted;

    setStatus(
      err.message ||
        "Search engine failure",
      "error"
    );
  }

  elements['terminal-input'].value = "";

  renderOutput();
  updateButtonStates();

  if (elements['output']) {
    elements['output'].scrollTop =
      elements['output'].scrollHeight;
  }
}

async function executeSearch(parsedCommand) {
  if (state.directoryHandle) {
    await refreshFilesystemState({
      render: false
    });
  }

  let intermediate = null;


  /*
   * Execute multiple top-level statements sequentially.
   *
   * Example:
   *
   * Write-Host "===== X ====="
   *
   * Get-ChildItem ... |
   * Select-String ...
   */
  if (
    parsedCommand &&
    parsedCommand.type === "script"
  ) {
    let finalResult = null;
    const hostOutput = [];

    for (const statement of parsedCommand.statements) {
      const result = await executeSearch(statement);

      /*
       * Write-Host produces a plain string array.
       * Keep it as host output instead of treating it
       * as search matches.
       */
      const firstOperation =
        statement.operations &&
        statement.operations[0];

      if (
        firstOperation &&
        typeof firstOperation.command === "string" &&
        firstOperation.command.toLowerCase() === "write-host"
      ) {
        if (Array.isArray(result)) {
          hostOutput.push(
            ...result.map(value => String(value))
          );
        } else if (
          result !== undefined &&
          result !== null
        ) {
          hostOutput.push(String(result));
        }
      } else {
        finalResult = result;
      }
    }

    return {
      __scriptResult: true,
      hostOutput,
      result: finalResult
    };
  }

  if (parsedCommand && parsedCommand.type === "assignment") {
    const commandResult = await executeSearch({
      type: "pipeline",
      operations: parsedCommand.operations
    });

    if (
      commandResult &&
      commandResult.__searchResult === true &&
      !commandResult.ok
    ) {
      return commandResult;
    }

    if (
      window.PSWeb &&
      window.PSWeb.Runtime &&
      window.PSWeb.Runtime.variables &&
      typeof window.PSWeb.Runtime.variables.setVariable === "function"
    ) {
      window.PSWeb.Runtime.variables.setVariable(
        parsedCommand.variable,
        commandResult
      );
    }

    return commandResult;
  }

  for (const op of parsedCommand.operations) {

    if (
      typeof op.command === "string" &&
      /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(op.command)
    ) {
      const variableName = op.command.slice(1);

      const variableValue =
        window.PSWeb &&
        window.PSWeb.Runtime &&
        window.PSWeb.Runtime.variables &&
        typeof window.PSWeb.Runtime.variables.getVariable === "function"
          ? window.PSWeb.Runtime.variables.getVariable(variableName)
          : undefined;

      if (variableValue !== undefined) {
        intermediate = variableValue;
        continue;
      }
    }

    const cmd = op.command.toLowerCase();

    // Check engine3 registered hook / override first
    if (typeof searchCommandHooks[cmd] === 'function') {
      intermediate = await searchCommandHooks[cmd](intermediate, op.args, op);
    } else {
      switch (cmd) {

        case "get-childitem":
          intermediate = await getChildItems(
            op.args.positional[0] || ".",
            op.args
          );
          break;

        case "get-content":
          intermediate = await getContent(
            op.args.positional,
            intermediate
          );
          break;

        case "select-string":
          intermediate = await selectString(
            intermediate,
            op.args
          );
          break;

        case "select-object":
          intermediate = selectObject(
            intermediate,
            op.args
          );
          break;

        case "where-object":
          intermediate = whereObject(
            intermediate,
            op.args
          );
          break;

        case "test-path":
          intermediate = testPath(
            op.args.positional[0]
          );
          break;

        default:
          return createSearchError(
            new Error(
              `Command '${op.command}' is not supported.`
            ),
            {
              type: SEARCH_RESULT_TYPES.COMMAND_ERROR,
              command: op.command
            }
          );
      }
    }

    /*
     * A command returned a structured diagnostic.
     * Stop the pipeline immediately.
     */
    if (
      intermediate &&
      intermediate.__searchResult === true &&
      !intermediate.ok
    ) {
      return intermediate;
    }
  }

  return intermediate;
}

/* ==========================================================================
   GET-CHILDITEM
   ========================================================================== */

async function getChildItems(targetPath, args = {}) {
  if (!state.directoryHandle) {
    throw new Error("No folder opened in workspace.");
  }

  const recursive =
    args.flags['recurse'] === true ||
    args.flags['r'] === true ||
    args.flags['recurse'] === "true";

  let matchedFiles = [...state.files];

  /*
   * Target filtering.
   */
  if (
    targetPath &&
    targetPath !== "." &&
    targetPath !== "./"
  ) {
    const resolved = resolveTarget(targetPath);

    matchedFiles = matchedFiles.filter(file => {
      return (
        file.path === resolved ||
        file.path.startsWith(resolved + "/")
      );
    });
  }

  /*
   * Without -Recurse only direct children.
   */
  if (!recursive) {
    matchedFiles = matchedFiles.filter(file => {
      const relativePath = targetPath &&
        targetPath !== "." &&
        targetPath !== "./"
        ? file.path.substring(
            resolveTarget(targetPath).length
          ).replace(/^\/+/, "")
        : file.path;

      return !relativePath.includes("/");
    });
  }

  return matchedFiles;
}

/* ==========================================================================
   GET-CONTENT
   ========================================================================== */

async function getContent(targetPaths, previousPipeline) {
  let filesToRead = [];

  /*
   * Pipeline:
   *
   * Get-ChildItem -Recurse | Get-Content
   */
  if (
    Array.isArray(previousPipeline) &&
    previousPipeline.length > 0
  ) {
    filesToRead = previousPipeline.filter(item => {
      return item && item.handle;
    });
  } else {
    /*
     * Explicit files:
     *
     * Get-Content engine.js,engine1.js,engine2.js
     */
    const paths = Array.isArray(targetPaths)
      ? targetPaths
      : targetPaths
        ? [targetPaths]
        : [];

    for (const targetPath of paths) {
      const resolved = resolveTarget(targetPath);

      const found = state.files.find(file => {
        return (
          file.path === resolved ||
          file.name === targetPath
        );
      });

      if (
        found &&
        !filesToRead.includes(found)
      ) {
        filesToRead.push(found);
      }
    }
  }

  const results = [];

  for (const fileItem of filesToRead) {
    try {
      const text = await readFile(fileItem.handle);

      results.push({
        file: fileItem,
        content: text
      });
    } catch (err) {
      /*
       * Ignore unreadable/binary files.
       */
    }
  }

  return results;
}

/* ==========================================================================
   SELECT-STRING
   ========================================================================== */

async function selectString(inputData, args = {}) {
  const pattern =
    args.flags['pattern'] ||
    args.positional[0];

  if (!pattern) {
    throw new Error(
      "Select-String requires -Pattern."
    );
  }

  let regex;

  try {
    regex = new RegExp(pattern, "g");
  } catch (err) {
    throw new Error(
      `Invalid regex pattern: ${pattern}`
    );
  }

  let itemsToSearch = [];

  /*
   * Pipeline input.
   */
  if (Array.isArray(inputData)) {

    if (inputData.length === 0) {
      itemsToSearch = [];
    }

    /*
     * Get-Content output:
     * [
     *   { file: {...}, content: "..." }
     * ]
     */
    else if (
      inputData[0] &&
      inputData[0].content !== undefined &&
      inputData[0].file
    ) {
      itemsToSearch = inputData;
    }

    /*
     * Get-ChildItem output:
     * [
     *   { name, path, handle, ... }
     * ]
     */
    else if (
      inputData[0] &&
      inputData[0].handle
    ) {
      itemsToSearch =
        await getContent(
          null,
          inputData
        );
    }

    /*
     * ForEach-Object output:
     * [
     *   "engine1.js",
     *   "engine2.js"
     * ]
     *
     * PowerShell Select-String treats string
     * pipeline values as file paths when they
     * resolve to files in the workspace.
     */
    else if (
      inputData.every(
        item => typeof item === 'string'
      )
    ) {
      for (const targetPath of inputData) {
        const resolved = resolveTarget(targetPath);

        const fileItem = state.files.find(file => {
          return (
            file.path === resolved ||
            file.name === targetPath
          );
        });

        if (!fileItem) {
          continue;
        }

        try {
          const text =
            await readFile(fileItem.handle);

          itemsToSearch.push({
            file: fileItem,
            content: text
          });
        } catch (err) {
          console.warn(
            `[Select-String] Failed to read '${targetPath}':`,
            err
          );
        }
      }
    }
  }

  /*
   * No pipeline:
   * search currently opened file.
   */
  else if (state.currentFileHandle) {
    const editor = elements['editor'];

    if (editor) {
      itemsToSearch.push({
        file: {
          path: state.currentFile
        },
        content: editor.value
      });
    }
  }

  const matches = [];

  for (const item of itemsToSearch) {
    if (
      !item ||
      !item.content ||
      !item.file
    ) {
      continue;
    }

    const lines = item.content.split("\n");

    for (let index = 0; index < lines.length; index++) {
      const lineText = lines[index];

      regex.lastIndex = 0;

      if (regex.test(lineText)) {
        matches.push({
          Path: item.file.path,
          LineNumber: index + 1,
          Line: lineText.trim()
        });
      }
    }
  }

  return matches;
}

/* ==========================================================================
   SELECT-OBJECT
   ========================================================================== */

function selectObject(inputData, args = {}) {
  if (!Array.isArray(inputData)) {
    return inputData;
  }

  let result = [...inputData];

  /*
   * --------------------------------------------------------------
   * -First N
   * --------------------------------------------------------------
   *
   * Example:
   * Select-Object -First 90
   */
  if (args.flags['first'] !== undefined) {
    const count = parseInt(
      args.flags['first'],
      10
    );

    if (Number.isNaN(count)) {
      throw new Error(
        "Select-Object -First requires a number."
      );
    }

    result = result.slice(
      0,
      Math.max(0, count)
    );
  }

  /*
   * --------------------------------------------------------------
   * -Last N
   * --------------------------------------------------------------
   */
  if (args.flags['last'] !== undefined) {
    const count = parseInt(
      args.flags['last'],
      10
    );

    if (Number.isNaN(count)) {
      throw new Error(
        "Select-Object -Last requires a number."
      );
    }

    if (count <= 0) {
      result = [];
    } else {
      result = result.slice(-count);
    }
  }

  /*
   * --------------------------------------------------------------
   * -Property
   * --------------------------------------------------------------
   *
   * Example:
   * Select-Object Path,LineNumber,Line
   *
   * Or:
   * Select-Object -Property Path,LineNumber,Line
   */
  let propStr =
    args.flags['property'];

  /*
   * Only treat positional arguments as properties
   * when -First/-Last are NOT occupying them.
   */
  if (
    !propStr &&
    args.positional.length > 0
  ) {
    propStr = args.positional.join(",");
  }

  if (!propStr) {
    return result;
  }

  const properties = propStr
    .split(",")
    .map(prop => prop.trim())
    .filter(Boolean);

  const propertyValidation =
    validateObjectProperties(
      result,
      properties,
      "Select-Object"
    );

  if (
    propertyValidation &&
    propertyValidation.type ===
      SEARCH_RESULT_TYPES.PROPERTY_ERROR
  ) {
    return propertyValidation;
  }

  if (properties.length === 0) {
    return result;
  }

  return result.map(item => {
    const obj = {};

    for (const prop of properties) {
      if (
        item &&
        item[prop] !== undefined
      ) {
        obj[prop] = item[prop];
      }
    }

    return obj;
  });
}

/* ==========================================================================
   WHERE-OBJECT
   ========================================================================== */

function whereObject(inputData, args = {}) {
  if (!Array.isArray(inputData)) {
    return inputData;
  }

  /*
   * MVP support for common PowerShell-style expressions:
   *
   * Where-Object Path -like "*.js"
   * Where-Object Path -eq "engine.js"
   * Where-Object Line -like "*foo*"
   *
   * Also supports:
   * -match
   * -ne
   * -contains
   */

  const positional = args.positional || [];

  if (positional.length < 3) {
    /*
     * No usable condition:
     * preserve pipeline instead of destroying it.
     */
    return inputData;
  }

  const property = positional[0];
  const operator = positional[1].toLowerCase();
  const expected = positional
    .slice(2)
    .join(" ");

  return inputData.filter(item => {
    if (!item) {
      return false;
    }

    const actual = item[property];

    if (actual === undefined) {
      return false;
    }

    const actualString = String(actual);

    switch (operator) {

      case "-eq":
        return actualString === expected;

      case "-ne":
        return actualString !== expected;

      case "-like": {
        const regexPattern =
          "^" +
          expected
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$";

        return new RegExp(
          regexPattern,
          "i"
        ).test(actualString);
      }

      case "-match":
        try {
          return new RegExp(
            expected,
            "i"
          ).test(actualString);
        } catch (err) {
          throw new Error(
            `Invalid Where-Object regex: ${expected}`
          );
        }

      case "-contains":
        return actualString.includes(expected);

      default:
        throw new Error(
          `Where-Object operator unsupported: ${operator}`
        );
    }
  });
}

/* ==========================================================================
   TEST-PATH
   ========================================================================== */

function testPath(targetPath) {
  if (!targetPath) {
    return false;
  }

  const resolved =
    resolveTarget(targetPath);

  return (
    state.files.some(
      file => file.path === resolved
    ) ||
    state.folders.some(
      folder => folder.path === resolved
    )
  );
}

/* ==========================================================================
   TARGET RESOLUTION
   ========================================================================== */

function resolveTarget(target) {
  if (!target) {
    return "";
  }

  let clean = String(target)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");

  if (
    clean.startsWith("$FILE") &&
    state.currentFile
  ) {
    clean = clean.replace(
      "$FILE",
      state.currentFile
    );
  }

  return clean;
}

/* ==========================================================================
   SEARCH RESULT FORMATTER
   ========================================================================== */

function formatSearchResult(results) {
  if (results === null || results === undefined) {
    return "No results.";
  }

  if (typeof results === "boolean") {
    return results
      ? "True"
      : "False";
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

    /*
     * Standard Select-String result.
     */
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

    /*
     * Generic object.
     */
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

/* ==========================================================================
   TERMINAL ACTIONS
   ========================================================================== */

function clearTerminal() {
  state.terminalOutput = "";
  state.lastSearchResult = null;
  state.diagnostics = [];
  renderOutput();
  updateButtonStates();
  setStatus("Terminal output cleared", "neutral");
}

async function copyTerminal() {
  if (!state.lastSearchResult) return;

  try {
    await navigator.clipboard.writeText(state.lastSearchResult);
    setStatus("Search result copied to clipboard", "success");
  } catch (err) {
    setStatus("Failed to copy search result", "error");
  }
}

async function pasteTerminal() {
  try {
    const text = await navigator.clipboard.readText();
    elements['terminal-input'].value = text;
    setStatus("Pasted command to terminal", "neutral");
  } catch (err) {
    setStatus("Failed to paste from clipboard", "error");
  }
}

/* ==========================================================================
   DIAGNOSTICS & PROBLEMS
   ========================================================================== */

function runDiagnostics() {
  state.diagnostics = [];

  if (!state.currentFile) return;

  const content = elements['editor'].value;
  const ext = state.currentFile.split('.').pop().toLowerCase();

  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    analyzeJavaScript(content, state.currentFile);
  }

  if (state.currentMode === "log") {
    renderOutput();
  }
}

function analyzeJavaScript(code, filePath) {
  try {
    // Basic syntax check using Function constructor safely without execution
    new Function(code);
  } catch (err) {
    const loc = parseErrorLocation(err, code);
    state.diagnostics.push({
      severity: "error",
      file: filePath,
      line: loc.line,
      column: loc.column,
      message: err.message
    });
  }
}

function parseErrorLocation(err, code) {
  let line = 1;
  let column = 1;

  if (err.stack) {
    const match = err.stack.match(/<anonymous>:(\d+):(\d+)/);
    if (match) {
      line = parseInt(match[1], 10) - 2; // Offset Function wrapper line
      column = parseInt(match[2], 10);
    }
  }

  if (line < 1) line = 1;
  return { line, column };
}

function renderDiagnostics(results) {
  const container = elements['output'];
  container.innerHTML = "";

  results.forEach(diag => {
    const div = document.createElement('div');
    div.className = `diagnostic-item diagnostic-${diag.severity}`;
    div.textContent = `[${diag.severity.toUpperCase()}] ${diag.file} (${diag.line}:${diag.column}): ${diag.message}`;
    div.addEventListener('click', () => jumpToLine(diag.line, diag.column));
    container.appendChild(div);
  });
}

function jumpToLine(line, column = 1) {
  const editor = elements['editor'];
  const lines = editor.value.split('\n');

  if (line > lines.length) return;

  let pos = 0;
  for (let i = 0; i < line - 1; i++) {
    pos += lines[i].length + 1;
  }
  pos += Math.min(column - 1, lines[line - 1].length);

  editor.focus();
  editor.setSelectionRange(pos, pos);

  // Scroll to line
  const lineHeight = 18;
  editor.scrollTop = (line - 1) * lineHeight;
  setStatus(`Jumped to ${state.currentFile} line ${line}`, "neutral");
}

/* ==========================================================================
   PUBLIC SEARCH API EXPORTS / BOUNDARY FOR ENGINE3
   ========================================================================== */

if (typeof window !== 'undefined') {
  window.SearchAPI = Object.assign(window.SearchAPI || {}, {
    parseCommand,
    tokenizeCommand,
    parseArgs,
    validateCommand,
    executeSearch,
    getChildItems,
    getContent,
    selectString,
    selectObject,
    whereObject,
    testPath,
    resolveTarget,
    registerSearchCommand,
    unregisterSearchCommand,
    hooks: searchCommandHooks
  });
}
