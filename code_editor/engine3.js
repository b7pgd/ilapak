/* ==========================================================================
   DEVELOPER WORKSPACE - POWERSHELL COMPATIBILITY & SEARCH LAYER (engine3.js)
   ========================================================================== */

(function () {
  'use strict';

  // Ensure SearchAPI boundary exists from engine2.js
  if (typeof window === 'undefined' || !window.SearchAPI) {
    console.error("engine3.js error: SearchAPI core is missing. Ensure engine2.js is loaded first.");
    return;
  }

  const coreApi = window.SearchAPI;

  /* ==========================================================================
     PROPERTY & VALUE RESOLVER
     ========================================================================== */

  /**
   * Safe property access with case-insensitivity and PowerShell aliases.
   * Supports: Path, FullName, Name, Extension, LineNumber, Line, $_.Path, etc.
   */
  function getPropertyValue(item, propName) {
    if (item === null || item === undefined || !propName) {
      return undefined;
    }

    let cleanProp = String(propName).trim()
      .replace(/^\$_\./, '')
      .replace(/^\./, '');

    const lowerProp = cleanProp.toLowerCase();

    // Direct object property lookup
    if (typeof item === 'object') {
      for (const key of Object.keys(item)) {
        if (key.toLowerCase() === lowerProp) {
          const value = item[key];

          if (
            (lowerProp === 'extension' || lowerProp === 'ext') &&
            value !== undefined &&
            value !== null
          ) {
            const text = String(value);
            return text
              ? (text.startsWith('.') ? text : `.${text}`)
              : '';
          }

          return value;
        }
      }
    }

    // File object / nested file object lookup
    const fileObj = item.file || (item.handle ? item : null);
    if (fileObj) {
      const fullPath = fileObj.path || "";
      const name = fileObj.name || (fullPath ? fullPath.split('/').pop() : "");
      let ext = fileObj.extension !== undefined ? fileObj.extension : "";

      if (!ext && name.includes('.')) {
        ext = name.substring(name.lastIndexOf('.'));
      }

      switch (lowerProp) {
        case 'path':
        case 'fullname':
          return fullPath;
        case 'name':
          return name;
        case 'extension':
        case 'ext':
          return ext ? (String(ext).startsWith('.') ? ext : `.${ext}`) : "";
        case 'length':
        case 'size':
          return item.content !== undefined ? String(item.content).length : (fileObj.size || 0);
      }
    }

    // Select-String synthetic properties lookup
    if (item.Path !== undefined) {
      switch (lowerProp) {
        case 'path':
        case 'fullname':
          return item.Path;
        case 'linenumber':
          return item.LineNumber;
        case 'line':
          return item.Line;
      }
    }

    return undefined;
  }

  /* ==========================================================================
     EXPRESSION EVALUATOR
     ========================================================================== */

  function parseInValues(value) {
    if (Array.isArray(value)) {
      return value;
    }

    const text = String(value ?? '').trim();

    if (!text) {
      return [];
    }

    return text
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        if (
          (value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))
        ) {
          return value.slice(1, -1);
        }

        return value;
      });
  }

  function evaluateCondition(item, leftExpr, operator, rightExpr) {
    let leftVal;
    const normalizedLeft = String(leftExpr).trim();

    if (/^\$_\./i.test(normalizedLeft)) {
      leftVal = getPropertyValue(item, normalizedLeft);
    } else {
      leftVal = getPropertyValue(item, normalizedLeft);
      if (leftVal === undefined) {
        leftVal = normalizedLeft;
      }
    }

    let rightVal = rightExpr;
    if (typeof rightVal === 'string') {
      const trimmed = rightVal.trim();
      if (trimmed === '$true') {
        rightVal = true;
      } else if (trimmed === '$false') {
        rightVal = false;
      } else if (trimmed === '$null') {
        rightVal = null;
      } else if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ) {
        rightVal = trimmed.slice(1, -1);
      }
    }

    const op = String(operator).trim().toLowerCase();
    const strLeft = leftVal !== null && leftVal !== undefined ? String(leftVal) : "";
    const strRight = rightVal !== null && rightVal !== undefined ? String(rightVal) : "";

    switch (op) {
      case '-eq':
        return typeof leftVal === 'boolean' ? leftVal === rightVal : strLeft.toLowerCase() === strRight.toLowerCase();
      case '-ne':
        return typeof leftVal === 'boolean' ? leftVal !== rightVal : strLeft.toLowerCase() !== strRight.toLowerCase();
      case '-like': {
        const pattern = "^" + strRight.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
        return new RegExp(pattern, "i").test(strLeft);
      }
      case '-notlike': {
        const pattern = "^" + strRight.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
        return !new RegExp(pattern, "i").test(strLeft);
      }
      case '-match':
        try {
          return new RegExp(strRight, "i").test(strLeft);
        } catch (err) {
          throw new Error(`Invalid regex in -match: ${strRight}`);
        }
      case '-notmatch':
        try {
          return !new RegExp(strRight, "i").test(strLeft);
        } catch (err) {
          throw new Error(`Invalid regex in -notmatch: ${strRight}`);
        }
      case '-contains':
        return strLeft.toLowerCase().includes(strRight.toLowerCase());
      case '-notcontains':
        return !strLeft.toLowerCase().includes(strRight.toLowerCase());
      case '-in': {
        const values = parseInValues(rightExpr);

        return values.some(value =>
          String(leftVal).toLowerCase() ===
          String(value).toLowerCase()
        );
      }
      case '-notin': {
        const values = parseInValues(rightExpr);

        return !values.some(value =>
          String(leftVal).toLowerCase() ===
          String(value).toLowerCase()
        );
      }
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
  }

  /* ==========================================================================
     SCRIPT BLOCK PARSER
     ========================================================================== */

  function evaluateScriptBlock(item, scriptBlock) {
    let clean = String(scriptBlock || '').trim();

    if (clean.startsWith('{') && clean.endsWith('}')) {
      clean = clean.slice(1, -1).trim();
    }

    if (!clean) return true;
    if (/^\$true$/i.test(clean)) return true;
    if (/^\$false$/i.test(clean)) return false;

    // Logical OR
    if (/\s+-or\s+/i.test(clean)) {
      const parts = clean.split(/\s+-or\s+/i);
      return parts.some(part => evaluateScriptBlock(item, part));
    }

    // Logical AND
    if (/\s+-and\s+/i.test(clean)) {
      const parts = clean.split(/\s+-and\s+/i);
      return parts.every(part => evaluateScriptBlock(item, part));
    }

    // Binary comparison
    const match = clean.match(/^(\$_\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+)\s+(-[a-zA-Z]+)\s+(.+)$/);
    if (match) {
      const [, left, operator, right] = match;
      return evaluateCondition(item, left, operator, right);
    }

    // Single property truthiness / direct value return
    const singleVal = getPropertyValue(item, clean);

    if (singleVal !== undefined) {
      return singleVal;
    }

    return Boolean(clean);
  }

  /* ==========================================================================
     AUGMENTED WHERE-OBJECT
     ========================================================================== */

  function augmentedWhereObject(inputData, args = {}, op = {}) {
    if (!Array.isArray(inputData)) {
      return inputData;
    }

    const positional = Array.isArray(args.positional)
      ? args.positional
      : [];

    const flags = args.flags || {};

    /* ------------------------------------------------------------------------
       SCRIPTBLOCK

       Parser representation:

         Where-Object { $_.Path -eq 'engine.js' }

       becomes:

         positional: ["{", "$_.Path", "}"]
         flags: {
           eq: "engine.js"
         }

       Reconstruct the expression before evaluation.
       ------------------------------------------------------------------------ */

    const hasScriptBlock =
      positional.length >= 3 &&
      positional[0] === "{" &&
      positional[positional.length - 1] === "}";

    if (hasScriptBlock) {
      const propertyExpression =
        positional
          .slice(1, -1)
          .join(" ")
          .trim();

      const operatorKey = Object.keys(flags).find(
        key =>
          [
            'eq',
            'ne',
            'like',
            'notlike',
            'match',
            'notmatch',
            'contains',
            'notcontains',
            'in',
            'notin'
          ].includes(key.toLowerCase())
      );

      if (operatorKey) {
        const operator =
          `-${operatorKey}`;

        const expected =
          flags[operatorKey];

        const reconstructed =
          `{ ${propertyExpression} ${operator} ${expected} }`;

        return inputData.filter(item => {
          try {
            return evaluateScriptBlock(
              item,
              reconstructed
            );
          } catch (err) {
            console.warn(
              "Where-Object scriptblock evaluation failed:",
              err
            );

            return false;
          }
        });
      }

      /*
       * Scriptblock without a recognized operator.
       */
      return inputData.filter(item => {
        try {
          return evaluateScriptBlock(
            item,
            `{ ${propertyExpression} }`
          );
        } catch (err) {
          console.warn(
            "Where-Object scriptblock evaluation failed:",
            err
          );

          return false;
        }
      });
    }

    /* ------------------------------------------------------------------------
       STANDARD CONDITION

       Example:

         Where-Object Path -eq engine.js

       Parser representation:

         positional: ["Path"]
         flags: {
           eq: "engine.js"
         }
       ------------------------------------------------------------------------ */

    if (positional.length >= 1) {
      const property = positional[0];

      const operatorKey = Object.keys(flags).find(
        key =>
          [
            'eq',
            'ne',
            'like',
            'notlike',
            'match',
            'notmatch',
            'contains',
            'notcontains',
            'in',
            'notin'
          ].includes(key.toLowerCase())
      );

      if (operatorKey) {
        const operator =
          `-${operatorKey}`;

        const expected =
          flags[operatorKey];

        return inputData.filter(item => {
          try {
            return evaluateCondition(
              item,
              property,
              operator,
              expected
            );
          } catch (err) {
            console.warn(
              "Where-Object condition failed:",
              err
            );

            return false;
          }
        });
      }
    }

    /* ------------------------------------------------------------------------
       FALLBACK
       ------------------------------------------------------------------------ */

    if (
      typeof coreApi.whereObject === 'function'
    ) {
      return coreApi.whereObject(
        inputData,
        args
      );
    }

    return inputData;
  }

  /* ==========================================================================
     AUGMENTED GET-CHILDITEM
     ========================================================================== */

  async function augmentedGetChildItem(inputData, args = {}, op = {}) {
    const positional = Array.isArray(args.positional) ? args.positional : [];
    const flags = args.flags || {};
    const targetPath = positional[0] || ".";

    let matchedFiles = await coreApi.getChildItems(targetPath, args);
    if (!Array.isArray(matchedFiles)) {
      return matchedFiles;
    }

    // -File
    if (flags.file === true || flags.f === true) {
      matchedFiles = matchedFiles.filter(item => item && !item.isFolder);
    }

    // -Directory
    if (flags.directory === true || flags.d === true) {
      matchedFiles = matchedFiles.filter(item => item && item.isFolder);
    }

    // -Filter
    const filterPattern = flags.filter;
    if (filterPattern && typeof filterPattern === 'string') {
      const regexStr =
        "^" +
        filterPattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$";

      const filterRegex = new RegExp(regexStr, "i");

      matchedFiles = matchedFiles.filter(file => {
        const fileName = file.name || "";
        return filterRegex.test(fileName);
      });
    }

    // -Include
    const includePattern = flags.include;
    if (includePattern && typeof includePattern === 'string') {
      const patterns = includePattern.split(',').map(p => p.trim()).filter(Boolean);

      matchedFiles = matchedFiles.filter(file => {
        const fileName = file.name || "";
        return patterns.some(pattern => {
          const regexStr = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
          return new RegExp(regexStr, "i").test(fileName);
        });
      });
    }

    // Deterministic ordering
    matchedFiles.sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));

    return matchedFiles;
  }

  /* ==========================================================================
     AUGMENTED GET-CONTENT
     ========================================================================== */

  const MAX_FILE_SIZE = 2 * 1024 * 1024;

  async function augmentedGetContent(inputData, args = {}, op = {}) {
    const positional = Array.isArray(args.positional) ? args.positional : [];
    const targetPaths = positional;

    const rawResults = await coreApi.getContent(targetPaths, inputData);
    if (!Array.isArray(rawResults)) {
      return rawResults;
    }

    const uniqueResults = [];
    const seenPaths = new Set();

    for (const item of rawResults) {
      if (!item) continue;

      const filePath = getPropertyValue(item, 'Path');
      if (filePath) {
        if (seenPaths.has(filePath)) continue;
        seenPaths.add(filePath);
      }

      if (typeof item.content === 'string' && item.content.length > MAX_FILE_SIZE) {
        item.content = `/* [SKIPPED LARGE FILE: ${filePath || 'unknown'} (${item.content.length} bytes)] */`;
      }

      uniqueResults.push(item);
    }

    return uniqueResults;
  }

  /* ==========================================================================
     AUGMENTED SELECT-OBJECT
     ========================================================================== */

  function augmentedSelectObject(inputData, args = {}, op = {}) {
    if (!Array.isArray(inputData)) {
      return inputData;
    }

    const positional = Array.isArray(args.positional) ? args.positional : [];
    const flags = args.flags || {};

    let properties = [];
    if (positional.length > 0) {
      properties = positional
        .flatMap(p => String(p).split(','))
        .map(p => p.trim())
        .filter(Boolean);
    }

    if (properties.length === 0) {
      if (typeof coreApi.selectObject === 'function') {
        return coreApi.selectObject(inputData, args);
      }
      return inputData;
    }

    let data = inputData.slice();
    const firstValue = flags.first !== undefined ? Number(flags.first) : null;
    const lastValue = flags.last !== undefined ? Number(flags.last) : null;

    if (Number.isFinite(firstValue) && firstValue >= 0) {
      data = data.slice(0, firstValue);
    } else if (Number.isFinite(lastValue) && lastValue >= 0) {
      data = data.slice(Math.max(0, data.length - lastValue));
    }

    return data.map(item => {
      const projected = {};
      for (const property of properties) {
        const value = getPropertyValue(item, property);
        projected[property] = value !== undefined ? value : null;
      }
      return projected;
    });
  }

  /* ==========================================================================
     REGISTER HOOKS
     ========================================================================== */

  if (typeof coreApi.registerSearchCommand === 'function') {
    coreApi.registerSearchCommand("where-object", augmentedWhereObject);
    coreApi.registerSearchCommand("where", augmentedWhereObject);

    coreApi.registerSearchCommand("get-childitem", augmentedGetChildItem);
    coreApi.registerSearchCommand("ls", augmentedGetChildItem);
    coreApi.registerSearchCommand("dir", augmentedGetChildItem);

    coreApi.registerSearchCommand("get-content", augmentedGetContent);
    coreApi.registerSearchCommand("cat", augmentedGetContent);
    coreApi.registerSearchCommand("type", augmentedGetContent);

    coreApi.registerSearchCommand("select-object", augmentedSelectObject);
  }

  /* ==========================================================================
     PUBLIC COMPATIBILITY LAYER
     ========================================================================== */

  window.PowerShellCompat = {
    getPropertyValue,
    evaluateCondition,
    evaluateScriptBlock,
    augmentedWhereObject,
    augmentedGetChildItem,
    augmentedGetContent,
    augmentedSelectObject
  };

})();
