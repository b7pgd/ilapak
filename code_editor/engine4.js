/*
 * PS Web - Final Router & Command Normalization Layer (Engine 4)
 */

"use strict";

(function () {
  window.PSWeb = window.PSWeb || {};

  // Flag Debugging Global
  window.PSWeb.debug = window.PSWeb.debug || false;

  const router = {
    name: "engine4",

    /**
     * Normalisasi Path secara Deterministik
     */
    normalizePath(pathStr) {
      if (!pathStr || typeof pathStr !== "string") return "";
      let clean = pathStr.replace(/^["']|["']$/g, "").trim();
      clean = clean.replace(/\\/g, "/");

      if (clean.startsWith("./")) {
        clean = clean.slice(2);
      }
      return clean;
    },

    /**
     * Quoted-Aware Tokenizer
     */
    tokenize(command) {
      const tokens = [];
      let current = "";
      let inDouble = false;
      let inSingle = false;

      for (let i = 0; i < command.length; i++) {
        const char = command[i];

        if (char === "\\" && i + 1 < command.length) {
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

        if (!inDouble && !inSingle && (char === ";" || char === "," || /\s/.test(char))) {
          if (current.length > 0) {
            tokens.push(current);
            current = "";
          }
          continue;
        }

        current += char;
      }

      if (current.length > 0) {
        tokens.push(current);
      }

      return tokens;
    },

    /**
     * Parse & Validasi Sintaks Read (Get-Content, cat, Select-Object)
     */
    parseRead(tokens) {
      const result = {
        type: "read",
        command: tokens[0].toLowerCase(),
        path: "",
        startLine: null,
        endLine: null,
        skip: null,
        first: null,
        mode: "full",
        warnings: [],
        errors: []
      };

      const cmd = result.command;
      const positionals = [];

      if (cmd === "select-object" || cmd === "selectobject") {
        for (let i = 1; i < tokens.length; i++) {
          const tok = tokens[i];
          const lower = tok.toLowerCase();

          if (lower === "-path" && i + 1 < tokens.length) {
            result.path = this.normalizePath(tokens[++i]);
          } else if (lower === "-skip" && i + 1 < tokens.length) {
            result.skip = parseInt(tokens[++i], 10);
          } else if (lower === "-first" && i + 1 < tokens.length) {
            result.first = parseInt(tokens[++i], 10);
          } else if (!tok.startsWith("-") && !result.path) {
            result.path = this.normalizePath(tok);
          }
        }

        if (!result.path) {
          result.errors.push("Usage: Select-Object -Path FILE [-Skip N] [-First M]");
          return result;
        }
      } else {
        // Get-Content / cat
        for (let i = 1; i < tokens.length; i++) {
          const tok = tokens[i];
          const lower = tok.toLowerCase();

          if (lower === "-path" && i + 1 < tokens.length) {
            result.path = this.normalizePath(tokens[++i]);
          } else if (lower === "-skip" && i + 1 < tokens.length) {
            result.skip = parseInt(tokens[++i], 10);
          } else if (lower === "-first" && i + 1 < tokens.length) {
            result.first = parseInt(tokens[++i], 10);
          } else if (!tok.startsWith("-")) {
            positionals.push(tok);
          }
        }

        if (!result.path && positionals.length > 0) {
          result.path = this.normalizePath(positionals.shift());
        }

        if (!result.path) {
          result.errors.push("Usage: Get-Content [-Path] FILE [START END] [-Skip N] [-First M]");
          return result;
        }

        if (positionals.length >= 2 && result.skip === null && result.first === null) {
          result.startLine = parseInt(positionals[0], 10);
          result.endLine = parseInt(positionals[1], 10);
        }
      }

      // Validasi Line Range & Skip/First
      if (result.startLine !== null || result.endLine !== null) {
        if (
          isNaN(result.startLine) ||
          isNaN(result.endLine) ||
          result.startLine < 1 ||
          result.endLine < result.startLine
        ) {
          result.errors.push("Invalid line range. START must be >= 1 and END >= START.");
          return result;
        }
        result.mode = "range";
      } else if (result.skip !== null || result.first !== null) {
        if (result.skip !== null && (isNaN(result.skip) || result.skip < 0)) {
          result.errors.push("Invalid -Skip value. Must be >= 0.");
          return result;
        }
        if (result.first !== null && (isNaN(result.first) || result.first < 1)) {
          result.errors.push("Invalid -First value. Must be >= 1.");
          return result;
        }
        result.mode = "skipfirst";
        result.skip = result.skip !== null ? result.skip : 0;
      }

      return result;
    },

    /**
     * Parse & Validasi Sintaks Search (grep, Select-String)
     */
    parseSearch(tokens) {
      const result = {
        type: "search",
        command: tokens[0].toLowerCase(),
        patterns: [],
        paths: [],
        caseInsensitive: false,
        regex: false,
        filesOnly: false,
        combined: false,
        recursive: true,
        context: 0,
        warnings: [],
        errors: [],
        unsupportedOptions: []
      };

      const knownOptions = new Set([
        "-n", "--line-number",
        "-r", "-R", "--recursive",
        "-i", "--ignore-case",
        "-E",
        "-l", "-files", "--files-with-matches",
        "-C", "--context",
        "-e", "--regexp",
        "-regex", "--regex",
        "-c", "--combined",
        "-b", "-batch", "--batch"
      ]);

      const cmd = result.command;

      if (cmd === "select-string" || cmd === "selectstring") {
        result.caseInsensitive = true; // Default PowerShell Select-String
        for (let i = 1; i < tokens.length; i++) {
          const tok = tokens[i];
          const lower = tok.toLowerCase();

          if (lower === "-pattern" && i + 1 < tokens.length) {
            result.patterns.push(tokens[++i]);
          } else if (lower === "-path" && i + 1 < tokens.length) {
            result.paths.push(this.normalizePath(tokens[++i]));
          } else if (lower === "-casesensitive") {
            result.caseInsensitive = false;
          } else if (lower === "-simplematch") {
            result.regex = false;
          } else if (lower === "-context" && i + 1 < tokens.length) {
            const ctx = parseInt(tokens[++i], 10);
            if (!isNaN(ctx) && ctx >= 0) result.context = ctx;
          } else if (!tok.startsWith("-")) {
            if (!result.patterns.length) {
              result.patterns.push(tok);
            } else {
              result.paths.push(this.normalizePath(tok));
            }
          }
        }

        if (!result.patterns.length) {
          result.errors.push('Usage: Select-String -Pattern "pattern" [-Path FILE]');
        }
        return result;
      }

      // Grep parser family
      let startIdx = 1;

      // Handling grep batch variants
      if (tokens.length > 1) {
        const second = tokens[1].toLowerCase();
        if (second === "batch" || second === "-batch" || second === "--batch" || second === "-b") {
          startIdx = 2;
        }
      }

      for (let i = startIdx; i < tokens.length; i++) {
        const tok = tokens[i];

        if (tok === "-i" || tok === "--ignore-case") {
          result.caseInsensitive = true;
        } else if (tok === "-regex" || tok === "--regex") {
          result.regex = true;
        } else if (tok === "-E") {
          result.regex = true;
          if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
            result.patterns.push(tokens[++i]);
          }
        } else if (tok.startsWith("--regexp=")) {
          result.regex = true;
          result.patterns.push(tok.split("=")[1]);
        } else if (tok === "-e" || tok === "--regexp") {
          result.regex = true;
          if (i + 1 < tokens.length) {
            result.patterns.push(tokens[++i]);
          }
        } else if (tok === "-l" || tok === "-files" || tok === "--files-with-matches") {
          result.filesOnly = true;
        } else if (tok === "-c" || tok === "--combined") {
          result.combined = true;
        } else if (tok === "-r" || tok === "-R" || tok === "--recursive") {
          result.recursive = true;
        } else if (tok === "-C" || tok === "--context") {
          if (i + 1 < tokens.length && !isNaN(parseInt(tokens[i + 1], 10))) {
            result.context = parseInt(tokens[++i], 10);
          }
        } else if (tok === "-n" || tok === "--line-number") {
          continue; // Default behavior
        } else if (tok.startsWith("-") && tok.length > 1) {
          if (!knownOptions.has(tok)) {
            result.unsupportedOptions.push(tok);
          }
        } else {
          // Path / Pattern Separation
          if (
            result.patterns.length > 0 &&
            (tok.includes(".") || tok.includes("/") || tok === "*")
          ) {
            result.paths.push(this.normalizePath(tok));
          } else {
            if (tok.includes("|") && result.regex) {
              result.patterns.push(...tok.split("|"));
            } else {
              result.patterns.push(tok);
            }
          }
        }
      }

      if (result.unsupportedOptions.length > 0) {
        result.errors.push(`Unsupported option: ${result.unsupportedOptions.join(", ")}`);
        return result;
      }

      if (!result.patterns.length) {
        result.errors.push('Usage: grep [-i] [-E] [-regex] "pattern" [FILE/PATH]');
      }

      return result;
    }
  };

  /**
   * API Normalisasi Command Utama
   */
  window.PSWeb.normalizeCommand = function (command) {
    if (!command || typeof command !== "string" || !command.trim()) {
      return {
        type: "unknown",
        command: "",
        original: command || "",
        normalized: null,
        warnings: [],
        errors: ["Command is empty."]
      };
    }

    const trimmed = command.trim();
    const tokens = router.tokenize(trimmed);
    const firstToken = tokens[0].toLowerCase();

    let normalized = null;
    let type = "unknown";

    if (
      firstToken === "get-content" ||
      firstToken === "cat" ||
      firstToken === "select-object" ||
      firstToken === "selectobject"
    ) {
      type = "read";
      normalized = router.parseRead(tokens);
    } else if (
      firstToken === "grep" ||
      firstToken === "grep-batch" ||
      firstToken === "grep--batch" ||
      firstToken === "grep-b" ||
      firstToken === "select-string" ||
      firstToken === "selectstring"
    ) {
      type = "search";
      normalized = router.parseSearch(tokens);
    }

    return {
      type: type,
      command: firstToken,
      original: command,
      normalized: normalized,
      warnings: normalized ? normalized.warnings : [],
      errors: normalized ? normalized.errors : []
    };
  };

  /**
   * Router Dispatcher Utama Terminal PS Web
   */
  window.PSWeb.execute = async function (command, context = {}) {
    const outputFn = context.output || window.PSWeb.output || console.log;
    const normalizedReq = window.PSWeb.normalizeCommand(command);

    if (window.PSWeb.debug) {
      outputFn(`[DEBUG] ORIGINAL   : ${normalizedReq.original}`);
      outputFn(`[DEBUG] TYPE       : ${normalizedReq.type}`);
      outputFn(`[DEBUG] NORMALIZED : ${JSON.stringify(normalizedReq.normalized, null, 2)}`);
      outputFn(`[DEBUG] ROUTER     : ${normalizedReq.type === "read" ? "engine2" : normalizedReq.type === "search" ? "engine3" : "engine1 (legacy)"}`);
    }

    // 1. Tangani Error Parsing / Syntax / Unsupported
    if (normalizedReq.errors && normalizedReq.errors.length > 0) {
      const isUnsupported = normalizedReq.errors.some(e => e.includes("Unsupported option"));
      const structuredResult = {
        ok: false,
        kind: isUnsupported ? "unsupported" : "syntax-error",
        message: normalizedReq.errors.join("\n"),
        data: null
      };
      outputFn(structuredResult.message, "error");
      return structuredResult;
    }

    // 2. Dispatch Ke Engine 2 (Read Layer)
    if (normalizedReq.type === "read") {
      if (!window.PSWeb.readLayer) {
        const errResult = { ok: false, kind: "internal-error", message: "Engine2 (readLayer) is not registered.", data: null };
        outputFn(errResult.message, "error");
        return errResult;
      }

      // Resolusi Berkas di Level Engine 4 untuk Error Classification
      if (normalizedReq.normalized.path) {
        const fileObj = window.PSWeb.readLayer.resolveFile(normalizedReq.normalized.path);
        if (!fileObj) {
          const notFoundResult = {
            ok: false,
            kind: "file-not-found",
            message: `File not found: ${normalizedReq.normalized.path}`,
            data: null
          };
          outputFn(notFoundResult.message, "error");
          return notFoundResult;
        }
      }

      const handled = await window.PSWeb.readLayer.execute(command, context);
      return { ok: handled, kind: handled ? "match" : "internal-error", message: "Read operation completed.", data: null };
    }

    // 3. Dispatch Ke Engine 3 (Search Layer)
    if (normalizedReq.type === "search") {
      if (!window.PSWeb.searchLayer) {
        const errResult = { ok: false, kind: "internal-error", message: "Engine3 (searchLayer) is not registered.", data: null };
        outputFn(errResult.message, "error");
        return errResult;
      }

      const handled = await window.PSWeb.searchLayer.execute(command, context);
      return { ok: handled, kind: handled ? "match" : "no-match", message: "Search operation completed.", data: null };
    }

    // 4. Fallback Ke Engine 1 (Legacy Commands)
    if (typeof window.PSWeb.legacyExecute === "function") {
      const legacyResult = await window.PSWeb.legacyExecute(command, context);
      return { ok: true, kind: "match", message: "Legacy command executed.", data: legacyResult };
    }

    // Default Fallback Command
    outputFn(`Command not recognized: ${command}`, "error");
    return { ok: false, kind: "unsupported", message: `Command not recognized: ${command}`, data: null };
  };

  // Auto-Registration Layer ke System Loader
  if (typeof window.PSWeb.registerLayer === "function") {
    window.PSWeb.registerLayer("engine4", router);
  }
})();
