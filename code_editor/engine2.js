/*
 * PS Web - Read / Source Range Compatibility Engine (Engine 2)
 */

"use strict";

(function () {
  window.PSWeb = window.PSWeb || {};

  const readLayer = {
    name: "engine2",

    /**
     * Mengecek apakah layer ini dapat menangani command yang diberikan.
     */
    canHandle(command) {
      if (!command || typeof command !== "string") return false;
      const raw = command.trim();
      if (!raw) return false;

      const firstSpace = raw.search(/\s/);
      const firstToken = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();

      return (
        firstToken === "get-content" ||
        firstToken === "cat" ||
        firstToken === "select-object" ||
        firstToken === "selectobject"
      );
    },

    /**
     * Melakukan ekstraksi token dari command string (quote-aware).
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

  // Pertahankan escape sequence seperti \(, \), \., \[, \s, dll.
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
          if (char === ";" || char === "," || /\s/.test(char)) {
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
    },

    /**
     * Memandu pencarian file pada PSWeb.state.fileMap dengan normalisasi path.
     */
    resolveFile(pathStr) {
      if (!pathStr || !window.PSWeb.state || !window.PSWeb.state.fileMap) {
        return null;
      }

      let cleanPath = pathStr.replace(/^["']|["']$/g, "").trim();
      cleanPath = cleanPath.replace(/\\/g, "/");

      if (cleanPath.startsWith("./")) {
        cleanPath = cleanPath.slice(2);
      } else if (cleanPath.startsWith(".\\")) {
        cleanPath = cleanPath.slice(2);
      }

      const fileMap = window.PSWeb.state.fileMap;

      if (fileMap.has(cleanPath)) {
        return fileMap.get(cleanPath);
      }

      // Fallback: Kasus pencarian case-insensitive atau match berdasarkan filename saja
      for (const [key, item] of fileMap.entries()) {
        if (key.toLowerCase() === cleanPath.toLowerCase()) {
          return item;
        }
      }

      return null;
    },

    /**
     * Parser spesifik untuk Get-Content dan cat
     */
    parseGetContent(tokens) {
      let path = null;
      let mode = "full"; // "full" | "range" | "skipfirst"
      let startLine = null;
      let endLine = null;
      let skip = null;
      let first = null;

      const positionals = [];

      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i];
        const lowerTok = tok.toLowerCase();

        if (lowerTok === "-path") {
          if (i + 1 < tokens.length) {
            path = tokens[++i];
          }
        } else if (lowerTok === "-skip") {
          if (i + 1 < tokens.length) {
            const val = parseInt(tokens[++i], 10);
            if (isNaN(val) || val < 0) {
              return { error: "Invalid -Skip value." };
            }
            skip = val;
          }
        } else if (lowerTok === "-first") {
          if (i + 1 < tokens.length) {
            const val = parseInt(tokens[++i], 10);
            if (isNaN(val) || val < 0) {
              return { error: "Invalid -First value." };
            }
            first = val;
          }
        } else if (!tok.startsWith("-")) {
          positionals.push(tok);
        }
      }

      if (!path && positionals.length > 0) {
        path = positionals.shift();
      }

      if (!path) {
        return { error: "Usage: Get-Content [-Path] FILE [START END] [-Skip N] [-First M]" };
      }

      if (skip !== null || first !== null) {
        mode = "skipfirst";
        skip = skip !== null ? skip : 0;
      } else if (positionals.length >= 2) {
        const startVal = parseInt(positionals[0], 10);
        const endVal = parseInt(positionals[1], 10);

        if (isNaN(startVal) || isNaN(endVal) || startVal <= 0 || endVal < startVal) {
          return { error: "Invalid line range." };
        }

        mode = "range";
        startLine = startVal;
        endLine = endVal;
      }

      return { path, mode, startLine, endLine, skip, first };
    },

    /**
     * Parser spesifik untuk Select-Object
     */
    parseSelectObject(tokens) {
      let path = null;
      let skip = null;
      let first = null;

      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i];
        const lowerTok = tok.toLowerCase();

        if (lowerTok === "-path") {
          if (i + 1 < tokens.length) {
            path = tokens[++i];
          }
        } else if (lowerTok === "-skip") {
          if (i + 1 < tokens.length) {
            const val = parseInt(tokens[++i], 10);
            if (isNaN(val) || val < 0) {
              return { error: "Invalid -Skip value." };
            }
            skip = val;
          }
        } else if (lowerTok === "-first") {
          if (i + 1 < tokens.length) {
            const val = parseInt(tokens[++i], 10);
            if (isNaN(val) || val < 0) {
              return { error: "Invalid -First value." };
            }
            first = val;
          }
        } else if (!tok.startsWith("-") && !path) {
          path = tok;
        }
      }

      if (!path) {
        return { error: "Usage: Select-Object -Path FILE [-Skip N] [-First M]" };
      }

      return {
        path,
        mode: "skipfirst",
        skip: skip !== null ? skip : 0,
        first: first
      };
    },

    /**
     * Pemotongan array baris berbasis 1-based indexing
     */
    sliceLines(lines, parsedReq) {
      const totalLines = lines.length;

      if (parsedReq.mode === "full") {
        return lines.join("\n");
      }

      let startIdx = 0; // 0-based inclusive
      let endIdx = totalLines; // 0-based exclusive

      if (parsedReq.mode === "range") {
        // startLine & endLine adalah 1-based
        if (parsedReq.startLine > totalLines) {
          return "No lines available in requested range.";
        }
        startIdx = parsedReq.startLine - 1;
        endIdx = Math.min(totalLines, parsedReq.endLine);
      } else if (parsedReq.mode === "skipfirst") {
        const skip = parsedReq.skip || 0;
        if (skip >= totalLines) {
          return "No lines available in requested range.";
        }
        startIdx = skip;
        if (parsedReq.first !== null && parsedReq.first !== undefined) {
          endIdx = Math.min(totalLines, startIdx + parsedReq.first);
        }
      }

      if (startIdx >= endIdx) {
        return "No lines available in requested range.";
      }

      return lines.slice(startIdx, endIdx).join("\n");
    },

    /**
     * Eksekusi Read Operation utama yang dipanggil oleh Engine Execution Pipeline
     */
    async execute(command, context = {}) {
      if (!this.canHandle(command)) return false;

      const outputFn = context.output || window.PSWeb.output || console.log;
      const tokens = this.tokenize(command.trim());
      if (!tokens.length) return false;

      const cmd = tokens[0].toLowerCase();
      let parsedReq = null;

      if (cmd === "get-content" || cmd === "cat") {
        parsedReq = this.parseGetContent(tokens);
      } else if (cmd === "select-object" || cmd === "selectobject") {
        parsedReq = this.parseSelectObject(tokens);
      }

      if (!parsedReq) return false;

      if (parsedReq.error) {
        outputFn(parsedReq.error, "error");
        return true;
      }

      const fileItem = this.resolveFile(parsedReq.path);
      if (!fileItem) {
        outputFn(`File not found: ${parsedReq.path}`, "error");
        return true;
      }

      try {
        const f = await fileItem.handle.getFile();
        const text = await f.text();
        const lines = text.split(/\r?\n/);

        const resultText = this.sliceLines(lines, parsedReq);
        outputFn(resultText);
      } catch (err) {
        outputFn(`ERROR reading file: ${err.message}`, "error");
      }

      return true;
    }
  };

  // Pendaftaran Namespace API
  window.PSWeb.readLayer = readLayer;

  // Pendaftaran Engine Layer ke PSWeb Subsystem Loader
  if (typeof window.PSWeb.registerLayer === "function") {
    window.PSWeb.registerLayer("engine2", readLayer);
  }
})();
