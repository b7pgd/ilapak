/*
 * PS Web - Search Compatibility Engine (Engine 3)
 */

"use strict";

(function () {
  window.PSWeb = window.PSWeb || {};

  const searchLayer = {
    name: "engine3",

    /**
     * Mengecek apakah layer ini dapat menangani command pencarian.
     */
    canHandle(command) {
      if (!command || typeof command !== "string") return false;
      const raw = command.trim();
      if (!raw) return false;

      const firstSpace = raw.search(/\s/);
      const firstToken = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();

      return (
        firstToken === "grep" ||
        firstToken === "grep-batch" ||
        firstToken === "grep--batch" ||
        firstToken === "grep-b" ||
        firstToken === "select-string" ||
        firstToken === "selectstring"
      );
    },

    /**
     * Tokenizer quote-aware sederhana.
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

  // Pertahankan escape sequence regex seperti \(, \), \., \[, \s, dll.
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
     * Menyelesaikan filter berkas berdasarkan wildcard sederhana (*.py, path exact, dsb)
     */
    resolveSearchPaths(pathSpecs) {
      if (!window.PSWeb.state || !window.PSWeb.state.fileMap) {
        return { matchedFiles: [], missingPath: null };
      }

      const fileMap = window.PSWeb.state.fileMap;
      const allPaths = Array.from(fileMap.keys());
      const matchedSet = new Set();

      for (const spec of pathSpecs) {
        let cleanSpec = spec.replace(/^["']|["']$/g, "").trim();
        cleanSpec = cleanSpec.replace(/\\/g, "/");

        if (cleanSpec.startsWith("./")) cleanSpec = cleanSpec.slice(2);
        if (cleanSpec === "." || cleanSpec === "./" || cleanSpec === "*") {
          allPaths.forEach(p => matchedSet.add(p));
          continue;
        }

        // Wildcard extension check (*.py, frontend/*.tsx)
        if (cleanSpec.includes("*")) {
          const regexStr = "^" + cleanSpec.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
          const globRegex = new RegExp(regexStr, "i");
          let matchCount = 0;

          for (const path of allPaths) {
            if (globRegex.test(path)) {
              matchedSet.add(path);
              matchCount++;
            }
          }

          if (matchCount === 0) {
            return { matchedFiles: [], missingPath: spec };
          }
          continue;
        }

        // Exact path matching
        let resolvedItem = fileMap.get(cleanSpec);
        if (!resolvedItem) {
          for (const [key, item] of fileMap.entries()) {
            if (key.toLowerCase() === cleanSpec.toLowerCase()) {
              resolvedItem = item;
              break;
            }
          }
        }

        if (resolvedItem) {
          matchedSet.add(resolvedItem.path);
        } else {
          return { matchedFiles: [], missingPath: spec };
        }
      }

      return {
        matchedFiles: Array.from(matchedSet).map(p => fileMap.get(p)).filter(Boolean),
        missingPath: null
      };
    },

    /**
     * Normalisasi variasi command Grep & Batch Grep
     */
    normalizeGrep(tokens) {
      const request = {
        type: "search",
        patterns: [],
        paths: [],
        caseInsensitive: false,
        regex: false,
        filesOnly: false,
        combined: false,
        recursive: true,
        context: 0,
        error: null
      };

      let i = 1;
      const knownFlags = new Set([
        "-i", "--ignore-case",
        "-regex", "--regex", "-E",
        "-l", "-files", "--files-with-matches",
        "-c", "--combined",
        "-r", "-R", "--recursive",
        "-n", "--line-number",
        "-b", "-batch", "--batch"
      ]);

      // Handle sub-command: grep batch, grep-batch, grep -b
      if (tokens.length > 1) {
        const second = tokens[1].toLowerCase();
        if (second === "batch" || second === "-batch" || second === "--batch" || second === "-b") {
          i = 2;
        }
      }

      for (; i < tokens.length; i++) {
        const tok = tokens[i];
        const lowerTok = tok.toLowerCase();

        if (lowerTok === "-i" || lowerTok === "--ignore-case") {
          request.caseInsensitive = true;
        } else if (lowerTok === "-regex" || lowerTok === "--regex") {
          request.regex = true;
        } else if (tok === "-E") {
          request.regex = true;
          if (i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
            request.patterns.push(tokens[++i]);
          }
        } else if (lowerTok.startsWith("--regexp=")) {
          request.regex = true;
          request.patterns.push(tok.split("=")[1]);
        } else if (lowerTok === "-e" || lowerTok === "--regexp") {
          request.regex = true;
          if (i + 1 < tokens.length) {
            request.patterns.push(tokens[++i]);
          }
        } else if (lowerTok === "-l" || lowerTok === "-files" || lowerTok === "--files-with-matches") {
          request.filesOnly = true;
        } else if (lowerTok === "-c" || lowerTok === "--combined") {
          request.combined = true;
        } else if (lowerTok === "-r" || lowerTok === "-R" || lowerTok === "--recursive") {
          request.recursive = true;
        } else if (lowerTok === "-C" || lowerTok === "--context") {
          if (i + 1 < tokens.length && !isNaN(parseInt(tokens[i + 1], 10))) {
            request.context = parseInt(tokens[++i], 10);
          }
        } else if (lowerTok === "-n" || lowerTok === "--line-number") {
          // Default behavior in PS Web, safe to ignore
          continue;
        } else if (tok.startsWith("-") && tok.length > 1 && !knownFlags.has(lowerTok)) {
          // Unsupported options guard
          request.error = `Unsupported option: ${tok}`;
          return request;
        } else {
          /*
           * ATURAN EKSPLISIT PEMISAHAN PATTERN VS PATH:
           * 1. Jika token adalah argumen pertama non-flag, maka SELALU menjadi PATTERN.
           * 2. Argumen selanjutnya HANYA diuji sebagai FILE PATH jika:
           *    - Bukan dalam mode regex yang mengandung wildcard/karakter regex biasa (*, .*, |)
           *    - SECARA EKSPLISIT merujuk ke direktori/pola file (dimulai ./, ../, atau mengandung /)
           */
          const isRegexPatternCandidate = request.regex || tok.includes(".*") || tok.includes("|");
          const isExplicitPath = tok.startsWith("./") || tok.startsWith("../") || tok.startsWith(".\\") || tok.includes("/");

          if (request.patterns.length > 0 && isExplicitPath && !isRegexPatternCandidate) {
            request.paths.push(tok);
          } else {
            if (tok.includes("|") && request.regex) {
              request.patterns.push(...tok.split("|"));
            } else {
              request.patterns.push(tok);
            }
          }
        }
      }

      if (!request.patterns.length && !request.error) {
        request.error = 'Usage: grep [-i] [-E] [-regex] "pattern" [FILE/PATH]';
      }

      return request;
    },

    /**
     * Normalisasi variasi command Select-String
     */
    normalizeSelectString(tokens) {
      const request = {
        type: "search",
        patterns: [],
        paths: [],
        caseInsensitive: true, // Default PowerShell Select-String is case-insensitive
        regex: false,
        filesOnly: false,
        combined: false,
        recursive: true,
        context: 0,
        error: null
      };

      for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i];
        const lowerTok = tok.toLowerCase();

        if (lowerTok === "-pattern") {
          if (i + 1 < tokens.length) {
            request.patterns.push(tokens[++i]);
          }
        } else if (lowerTok === "-path") {
          if (i + 1 < tokens.length) {
            request.paths.push(tokens[++i]);
          }
        } else if (lowerTok === "-casesensitive") {
          request.caseInsensitive = false;
        } else if (lowerTok === "-simplematch") {
          request.regex = false;
        } else if (lowerTok === "-notmatch") {
          request.regex = true;
        } else if (lowerTok === "-context") {
          if (i + 1 < tokens.length && !isNaN(parseInt(tokens[i + 1], 10))) {
            request.context = parseInt(tokens[++i], 10);
          }
        } else if (tok.startsWith("-")) {
          continue;
        } else {
          if (!request.patterns.length) {
            request.patterns.push(tok);
          } else if (!request.paths.length) {
            request.paths.push(tok);
          }
        }
      }

      if (!request.patterns.length) {
        request.error = 'Usage: Select-String -Pattern "pattern" [-Path FILE]';
      }

      return request;
    },

    /**
     * Melakukan validasi & transformasi token command ke Normalized Search Request Internal Representation
     */
    normalize(command) {
      const tokens = this.tokenize(command.trim());
      if (!tokens.length) return null;

      const cmd = tokens[0].toLowerCase();

      if (
        cmd === "grep" ||
        cmd === "grep-batch" ||
        cmd === "grep--batch" ||
        cmd === "grep-b"
      ) {
        return this.normalizeGrep(tokens);
      }

      if (cmd === "select-string" || cmd === "selectstring") {
        return this.normalizeSelectString(tokens);
      }

      return null;
    },

    /**
     * Eksekutor Search Request menggunakan Search Engine API Baseline `engine1.js`
     */
    async executeSearch(request, outputFn) {
      if (request.error) {
        outputFn(request.error, "error");
        return true;
      }

      // Validasi Sintaks Regex sebelum mengeksekusi
      if (request.regex) {
        for (const p of request.patterns) {
          try {
            new RegExp(p);
          } catch (err) {
            outputFn(`Regex error: ${err.message}`, "error");
            return true;
          }
        }
      }

      const state = window.PSWeb.state;
      if (!state || !state.directoryHandle) {
        outputFn("ERROR: Open a folder first.", "error");
        return true;
      }

      // Backup daftar berkas asli di state
      const originalFiles = state.files;

      // Filter berkas jika ada spesifikasi path khusus
      if (request.paths.length > 0) {
        const { matchedFiles, missingPath } = this.resolveSearchPaths(request.paths);

        if (missingPath) {
          outputFn(`File not found: ${missingPath}`, "error");
          return true;
        }

        if (!matchedFiles.length) {
          outputFn("No matching files found for path specified.", "error");
          return true;
        }

        state.files = matchedFiles;
      }

      try {
        outputFn(`Searching ${state.files.length} files...\n`);

        const grepFilesFn = window.PSWeb.grepFiles;
        const grepBatchFilesFn = window.PSWeb.grepBatchFiles;

        if (request.patterns.length === 1 && typeof grepFilesFn === "function") {
          const pattern = request.patterns[0];
          // Menggunakan search engine API baseline
          const results = await grepFilesFn(pattern, {
            caseInsensitive: request.caseInsensitive,
            regex: request.regex,
            filesOnly: request.filesOnly,
            context: request.context
          });

          if (!results || !results.length) {
            outputFn([
              "===== SEARCH RESULT =====",
              `Pattern: ${pattern}`,
              "",
              "No matches found.",
              "===== 0 MATCHES ====="
            ].join("\n"));
          } else {
            const lines = ["===== SEARCH RESULT =====", `Pattern: ${pattern}`, ""];
            for (const res of results) {
              if (request.filesOnly) {
                lines.push(res.path);
              } else {
                lines.push(`${res.path}:${res.lineNumber}: ${res.line}`);
              }
            }
            lines.push("", `===== ${results.length} MATCHES =====`);
            outputFn(lines.join("\n"), "success");
          }
        } else if (typeof grepBatchFilesFn === "function") {
          // Batch search via API baseline
          const { patternResults, combinedMatches } = await grepBatchFilesFn(request.patterns, {
            caseInsensitive: request.caseInsensitive,
            regex: request.regex,
            filesOnly: request.filesOnly,
            combined: request.combined,
            context: request.context
          });

          const lines = ["===== BATCH SEARCH RESULT =====", ""];
          let totalMatches = 0;
          const allUniqueFiles = new Set();

          if (request.combined) {
            for (const m of combinedMatches) {
              totalMatches++;
              allUniqueFiles.add(m.path);
              const patLabel = `[${m.matchedPatterns.join(", ")}]`;
              if (request.filesOnly) {
                lines.push(`${m.path} ${patLabel}`);
              } else {
                lines.push(`${m.path}:${m.lineNumber}: ${patLabel} ${m.line}`);
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

              if (!pRes.matches || pRes.matches.length === 0) {
                lines.push("No matches.", "");
                continue;
              }

              for (const m of pRes.matches) {
                totalMatches++;
                allUniqueFiles.add(m.path);
                if (request.filesOnly) {
                  lines.push(m.path);
                } else {
                  lines.push(`${m.path}:${m.lineNumber}: ${m.line}`);
                }
              }
              lines.push("");
            }
          }

          lines.push("===== BATCH SUMMARY =====");
          lines.push(`Patterns : ${request.patterns.length}`);
          lines.push(`Matches  : ${totalMatches}`);
          lines.push(`Files    : ${allUniqueFiles.size}`);
          lines.push("");

          for (const pRes of patternResults) {
            if (pRes.error) {
              lines.push(`${pRes.pattern} : Error (${pRes.error})`);
            } else {
              lines.push(`${pRes.pattern} : ${pRes.matches ? pRes.matches.length : 0} matches`);
            }
          }

          outputFn(lines.join("\n"), "success");
        } else {
          outputFn("SEARCH ERROR: Grep API function is not available.", "error");
        }
      } catch (err) {
        outputFn(`SEARCH ERROR: ${err.message}`, "error");
      } finally {
        // Kembalikan daftar berkas di state ke semula
        state.files = originalFiles;
      }

      return true;
    },

    /**
     * Single Entry-point Eksekusi Command Search
     */
    async execute(command, context = {}) {
      if (!this.canHandle(command)) return false;

      const outputFn = context.output || window.PSWeb.output || console.log;
      const normalizedReq = this.normalize(command);

      if (!normalizedReq) return false;

      return await this.executeSearch(normalizedReq, outputFn);
    }
  };

  // Pendaftaran Namespace API Engine 3
  window.PSWeb.searchLayer = searchLayer;

  // Pendaftaran Layer ke Subsystem Loader
  if (typeof window.PSWeb.registerLayer === "function") {
    window.PSWeb.registerLayer("engine3", searchLayer);
  }
})();
