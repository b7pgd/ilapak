/**
 * Frontend Semantic Extraction Engine - Modular Pipeline Stage
 * Target Directory: /frontend/
 */
(function () {
  // Helper: Clean raw text from extra spaces
  function cleanText(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  // Helper: Infer human-readable intent from DOM element characteristics
  function inferElementSemantic(node) {
    const tag = (node.name || '').toLowerCase();
    const role = (node.role || '').toLowerCase();
    const cls = (node.className || '').toLowerCase();
    const id = (node.id || '').toLowerCase();
    const text = node.text ? cleanText(node.text) : '';

    // Score-based semantic inference instead of hardcoded keywords
    if (tag === 'aside' || role === 'navigation' || role === 'complementary') return 'Sidebar';
    if (tag === 'header' || role === 'banner') return 'Header';
    if (tag === 'main' || role === 'main') return 'Main Content';
    if (tag === 'nav') return 'Navigation';
    if (tag === 'form') return 'Form Container';
    if (tag === 'table' || role === 'grid' || role === 'table') return 'Data Table';

    // Heuristics derived from structural layout & attributes
    if (tag === 'section' || tag === 'div' || tag === 'article') {
      const children = node.children || [];
      const hasTable = children.some(c => {
        const cTag = (c.name || '').toLowerCase();
        const cRole = (c.role || '').toLowerCase();
        return cTag === 'table' || cRole === 'grid' || cRole === 'table';
      });
      if (hasTable) return 'Table Section';

      const hasInput = children.some(c => (c.name || '').toLowerCase() === 'input');
      const hasBtn = children.some(c => (c.name || '').toLowerCase() === 'button' || (c.role || '').toLowerCase() === 'button');
      if (hasInput && hasBtn) return 'Action Group';
    }

    if (tag === 'input') {
      const typeM = node.attrs ? node.attrs.match(/type=["']([^"']+)["']/i) : null;
      const type = typeM ? typeM[1].toLowerCase() : 'text';
      return `${type.charAt(0).toUpperCase() + type.slice(1)} Input`;
    }

    if (tag === 'button' || role === 'button') {
      if (text) return `${text} Button`;
      if (node.action) return `Action (${node.action}) Button`;
      return 'Action Button';
    }

    if (tag === 'a' && node.route) {
      if (text) return `${text} Link`;
      return 'Navigation Link';
    }

    if (text) return text;
    if (node.id) return `#${node.id}`;
    if (node.className) {
      const cleanCls = node.className.replace(/\{\{[\s\S]*?\}\}/g, '').trim();
      if (cleanCls) return `.${cleanCls.split(' ')[0]}`;
    }
    return tag.toUpperCase();
  }

  // Helper: Summarize JavaScript function behavior into operation statements
  function summarizeFunctionBehavior(body) {
    const operations = [];

    // Generic State & Style Mutations (Extract dynamic Property-Value updates)
    const styleMatches = body.matchAll(/(?:document\.getElementById|querySelector|querySelectorAll)\(['"]#?([a-zA-Z0-9_-]+)['"]\)\.style\.([a-zA-Z0-9_]+)\s*=\s*['"](.*?)['"]/g);
    const styleMap = {};
    for (const m of styleMatches) {
      const [, target, prop, val] = m;
      if (!styleMap[prop]) styleMap[prop] = [];
      styleMap[prop].push(`#${target} -> ${val}`);
    }
    for (const prop in styleMap) {
      operations.push(`${prop} update:\n  ${styleMap[prop].join(', ')}`);
    }

    const classToggles = [];
    const toggleMatches = body.matchAll(/(?:([a-zA-Z0-9_-]+)\.)?classList\.(toggle|add|remove)\(['"]([^"']+)['"]\)/g);
    for (const m of toggleMatches) {
      classToggles.push(`${m[1] ? m[1] + '.' : ''}${m[2]}(${m[3]})`);
    }
    if (classToggles.length > 0) {
      operations.push(`class mutation:\n  ${classToggles.join(', ')}`);
    }

    // Generic Dynamic DOM Node / Content Updates
    const domMutations = [];
    const domMatches = body.matchAll(/([a-zA-Z0-9_.-]+)\.(innerText|textContent|innerHTML|value|checked)\s*=/g);
    for (const m of domMatches) {
      domMutations.push(`${m[1]}.${m[2]}`);
    }
    if (domMutations.length > 0) {
      operations.push(`DOM updates:\n  modify ${domMutations.join(', ')}`);
    }

    // Generic Method Calls / API Invocation Triggers
    const methodCalls = [];
    const methodMatches = body.matchAll(/([a-zA-Z0-9_.-]+)\.([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g);
    for (const m of methodMatches) {
      const [, obj, method] = m;
      if (!['querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'match', 'test', 'replace', 'push', 'includes'].includes(method)) {
        methodCalls.push(`${obj}.${method}()`);
      }
    }
    if (methodCalls.length > 0) {
      // Deduplicate method calls
      const uniqueCalls = [...new Set(methodCalls)];
      operations.push(`method execution:\n  ${uniqueCalls.join(', ')}`);
    }

    return operations.length > 0 ? operations.join('\n') : null;
  }

  // Helper: Extract nested block contents considering balanced braces
  function extractBalancedBlock(text, startPos) {
    let depth = 0;
    let started = false;
    let endPos = -1;

    for (let i = startPos; i < text.length; i++) {
      if (text[i] === '{') {
        depth++;
        started = true;
      } else if (text[i] === '}') {
        depth--;
        if (started && depth === 0) {
          endPos = i;
          break;
        }
      }
    }
    return endPos !== -1 ? text.substring(startPos, endPos + 1) : null;
  }

  // Stage 1: AST Parser & Dynamic Semantic Analysis
  function parseFrontendAST(content, fileName, ext) {
    const ast = {
      metadata: { fileName, ext, title: '' },
      imports: [],
      css: { variables: [], classes: [], mediaQueries: [] },
      scripts: [],
      goTemplates: [],
      roles: new Set(),
      apiCalls: [],
      clientBehaviors: [],
      dataModel: {
        contexts: new Set(),
        collections: new Map() // Collection Name -> Set of Entity Fields
      }
    };

    // Extract Title
    const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      ast.metadata.title = cleanText(titleMatch[1]);
    }

    // Extract External Dependencies dynamically from src/href without hardcoded whitelists
    const depRegex = /<(?:link|script)[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi;
    let depMatch;
    while ((depMatch = depRegex.exec(content)) !== null) {
      const src = depMatch[1];
      if (!src || src.startsWith('#') || src.startsWith('data:')) continue;
      const cleanSrc = src.split('?')[0].split('#')[0];
      const parts = cleanSrc.split('/');
      const fileNameDep = parts[parts.length - 1];
      if (fileNameDep && !ast.imports.includes(fileNameDep)) {
        ast.imports.push(fileNameDep);
      }
    }

    // Parse CSS Styles
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;
    let cssText = "";
    while ((styleMatch = styleRegex.exec(content)) !== null) {
      cssText += styleMatch[1] + "\n";
    }

    const varRegex = /--[a-zA-Z0-9_-]+/g;
    let vMatch;
    while ((vMatch = varRegex.exec(cssText)) !== null) {
      if (!ast.css.variables.includes(vMatch[0])) ast.css.variables.push(vMatch[0]);
    }

    const classRegex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
    let cMatch;
    while ((cMatch = classRegex.exec(cssText)) !== null) {
      const clsName = '.' + cMatch[1];
      if (!ast.css.classes.includes(clsName)) ast.css.classes.push(clsName);
    }

    const mediaStartRegex = /@media[^{]+\{/g;
    let mStartMatch;
    while ((mStartMatch = mediaStartRegex.exec(cssText)) !== null) {
      const startIndex = mStartMatch.index + mStartMatch[0].length - 1;
      const fullBlock = extractBalancedBlock(cssText, startIndex);

      if (fullBlock) {
        const mediaHeader = mStartMatch[0].replace('{', '').replace('@media', '').trim();
        const mediaBody = fullBlock.slice(1, -1);

        // Dynamically extract rules inside media query block
        const ruleMatches = mediaBody.matchAll(/([.#a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g);
        const behaviors = [];
        for (const rMatch of ruleMatches) {
          const selector = rMatch[1];
          const declarations = rMatch[2].split(';').map(d => d.trim()).filter(Boolean);
          if (declarations.length > 0) {
            behaviors.push(`${selector} (${declarations.join(', ')})`);
          }
        }

        ast.css.mediaQueries.push({
          query: mediaHeader,
          behavior: behaviors.length > 0 ? behaviors.join('; ') : null
        });

        mediaStartRegex.lastIndex = startIndex + fullBlock.length;
      }
    }

    // Extract Go Template Syntaxes, Variables, and Hierarchical Data Models
    const goTagRegex = /{{[\s\S]*?}}/g;
    let goMatch;
    let currentRangeCollection = null;

    while ((goMatch = goTagRegex.exec(content)) !== null) {
      const raw = goMatch[0];
      ast.goTemplates.push(raw);

      // Detect Loop Range Collection {{ range .Labels }} or {{- range .Labels }}
      const rangeMatch = raw.match(/{{-?\s*range\s+(?:\$[a-zA-Z0-9_]+,\s*\$[a-zA-Z0-9_]+\s*:=\s*)?\.([a-zA-Z0-9_]+)/);
      if (rangeMatch) {
        currentRangeCollection = rangeMatch[1];
        if (!ast.dataModel.collections.has(currentRangeCollection)) {
          ast.dataModel.collections.set(currentRangeCollection, new Set());
        }
      }

      if (/{{-?\s*end\s*}}/.test(raw)) {
        currentRangeCollection = null;
      }

      // Detect Dot Variables / Fields with Built-in & Standard Library Filtering
      const fieldMatches = raw.match(/\.([a-zA-Z0-9_]+)/g);
      if (fieldMatches) {
        fieldMatches.forEach(v => {
          const cleanVar = v.replace('.', '');
          const isStandardGoKeyword = /^(if|else|end|range|with|gt|lt|eq|ne|or|and|not|index|len|slice|printf|print|println|Now|Unix|Format|String|Time)$/i.test(cleanVar);
          if (cleanVar && !isStandardGoKeyword) {
            if (currentRangeCollection) {
              if (cleanVar !== currentRangeCollection) {
                ast.dataModel.collections.get(currentRangeCollection).add(cleanVar);
              }
            } else {
              if (!ast.dataModel.collections.has(cleanVar)) {
                ast.dataModel.contexts.add(cleanVar);
              }
            }
          }
        });
      }

      // Extract User Roles
      const roleMatch = raw.match(/(?:hasRole|role)\s+([^}]+)/i) || raw.match(/role\s*==\s*["']([^"']+)["']/i);
      if (roleMatch) {
        const roleString = roleMatch[1].replace(/[()"']/g, '');
        roleString.split(',').forEach(r => {
          const cleanRole = r.trim();
          if (cleanRole) ast.roles.add(cleanRole);
        });
      }
    }

    // Extract Scripts, API Calls, and Detailed Client Behaviors
    const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let scMatch;
    while ((scMatch = scriptRegex.exec(content)) !== null) {
      const scriptBody = scMatch[2];
      ast.scripts.push({ attrs: scMatch[1], body: scriptBody });

      // Extract API Contract Calls (fetch, axios, XMLHttpRequest)
      const fetchRegex = /(?:fetch|axios(?:\.(get|post|put|delete))?)\s*\(\s*["']([^"']+)["']/gi;
      let apiMatch;
      while ((apiMatch = fetchRegex.exec(scriptBody)) !== null) {
        const detectedMethod = apiMatch[1] ? apiMatch[1].toUpperCase() : null;
        const url = apiMatch[2];
        let method = detectedMethod || 'GET';
        const scope = scriptBody.substring(Math.max(0, apiMatch.index - 50), Math.min(scriptBody.length, apiMatch.index + 150));

        if (!detectedMethod) {
          if (/method\s*:\s*["']POST["']/i.test(scope) || /POST/i.test(scope)) method = 'POST';
          else if (/method\s*:\s*["']PUT["']/i.test(scope) || /PUT/i.test(scope)) method = 'PUT';
          else if (/method\s*:\s*["']DELETE["']/i.test(scope) || /DELETE/i.test(scope)) method = 'DELETE';
        }

        // Infer Dynamic Parameters from URL
        const dynParams = [];
        const paramMatches = url.match(/(:[a-zA-Z0-9_]+|\{[a-zA-Z0-9_]+\})/g);
        if (paramMatches) {
          paramMatches.forEach(p => dynParams.push(p));
        }

        ast.apiCalls.push({
          method,
          url,
          dynamicParameters: dynParams.length > 0 ? dynParams.join(', ') : null,
          trigger: 'script'
        });
      }

      const xhrRegex = /\.open\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/gi;
      let xhrMatch;
      while ((xhrMatch = xhrRegex.exec(scriptBody)) !== null) {
        ast.apiCalls.push({
          method: xhrMatch[1].toUpperCase(),
          url: xhrMatch[2],
          trigger: 'XMLHttpRequest'
        });
      }

      // Extract Client Behaviors from Event Listeners
      const eventRegex = /\.addEventListener\s*\(\s*["']([^"']+)["']\s*,\s*(?:function\s*\([^)]*\)|.*?=>)?\s*\{/g;
      let evtMatch;
      while ((evtMatch = eventRegex.exec(scriptBody)) !== null) {
        const evtType = evtMatch[1];
        const blockStart = evtMatch.index + evtMatch[0].length - 1;
        const fullBlock = extractBalancedBlock(scriptBody, blockStart);

        if (fullBlock) {
          const evtBody = fullBlock.slice(1, -1);
          const summary = summarizeFunctionBehavior(evtBody);
          if (summary) {
            ast.clientBehaviors.push({
              name: `on(${evtType})`,
              summary: summary
            });
          }
          eventRegex.lastIndex = blockStart + fullBlock.length;
        }
      }

      // Extract Client Behaviors from Functions
      const funcStartRegex = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{/g;
      let fnMatch;
      while ((fnMatch = funcStartRegex.exec(scriptBody)) !== null) {
        const fnName = fnMatch[1];
        const fnParams = fnMatch[2];
        const blockStart = fnMatch.index + fnMatch[0].length - 1;
        const fullBlock = extractBalancedBlock(scriptBody, blockStart);

        if (fullBlock) {
          const fnBody = fullBlock.slice(1, -1);
          const summary = summarizeFunctionBehavior(fnBody);
          if (summary) {
            ast.clientBehaviors.push({
              name: `${fnName}(${fnParams})`,
              summary: summary
            });
          }
          funcStartRegex.lastIndex = blockStart + fullBlock.length;
        }
      }
    }

    return ast;
  }

  // Stage 2: Robust Stack-based HTML Parser
  function parseHTMLTree(htmlContent) {
    const cleanHtml = htmlContent
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '');

    const tokenRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?>|([^<]+)/g;

    const root = { name: 'Root', children: [] };
    const stack = [root];
    let match;

    while ((match = tokenRegex.exec(cleanHtml)) !== null) {
      const isComment = match[0].startsWith('<!--');
      const isClose = match[1] === '/';
      const tagName = match[2];
      const attrString = match[3];
      const isSelfClosingSlash = match[4] === '/';
      const textContent = match[5];

      if (isComment) continue;

      if (textContent) {
        const text = cleanText(textContent);
        if (text && stack.length > 0) {
          const current = stack[stack.length - 1];
          if (!current.text) current.text = text;
        }
        continue;
      }

      if (!tagName) continue;

      const isSelfClosing = isSelfClosingSlash || /^(img|input|br|hr|meta|link|area|base|col|embed|param|source|track|wbr)$/i.test(tagName);

      if (isClose) {
        if (stack.length > 1) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].name.toLowerCase() === tagName.toLowerCase()) {
              stack.length = i;
              break;
            }
          }
        }
      } else {
        const node = { name: tagName, attrs: attrString || '', children: [] };
        if (attrString) {
          const idM = attrString.match(/id=["']([^"']+)["']/i);
          if (idM) node.id = idM[1];

          const classM = attrString.match(/class=["']([^"']+)["']/i);
          if (classM) node.className = classM[1];

          // Generic Route / URL Attribute Detector with Complete Go Template & Unquoted Matching
          const routeM = attrString.match(/(?:href|action|data-url|hx-[a-z]+)=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
          if (routeM) {
            const rawRoute = routeM[1] || routeM[2] || routeM[3];
            if (rawRoute && rawRoute !== '#') {
              node.route = rawRoute;
            }
          }

          if (attrString.includes('action=')) {
            const methodM = attrString.match(/method=["']([^"']+)["']/i);
            node.httpMethod = methodM ? methodM[1].toUpperCase() : 'POST';
          }

          const onclickM = attrString.match(/onclick=["']([^"']+)["']/i);
          if (onclickM) node.action = onclickM[1];

          const roleM = attrString.match(/(?:data-role|role)=["']([^"']+)["']/i);
          if (roleM) node.role = roleM[1];
        }

        const parent = stack[stack.length - 1];
        parent.children.push(node);

        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    }

    return root;
  }

  // Dynamic Semantic Model Extractor
  function extractSemanticKnowledge(ast, content) {
    const domTree = parseHTMLTree(content);

    const semantic = {
      fileName: ast.metadata.fileName,
      type: ast.goTemplates.length > 0 ? 'Go HTML Template' : 'HTML Frontend Component',
      purpose: ast.metadata.title || ast.metadata.fileName,
      pageStructure: [],
      dataModel: ast.dataModel,
      tableSemantic: null,
      actionRoutes: [],
      clientBehavior: ast.clientBehaviors,
      apiContract: ast.apiCalls,
      styleMap: {
        variables: ast.css.variables,
        classes: ast.css.classes,
        responsive: ast.css.mediaQueries
      },
      dependencies: ast.imports,
      migrationEssentials: {
        preserve: [],
        ignore: [
          'raw HTML syntax',
          'inline DOM manipulation details',
          'duplicated styling declarations'
        ]
      }
    };

    // Reconstruct Page Structure dynamically from DOM Tree
    function convertDOMToStructure(node) {
      const semanticLabel = inferElementSemantic(node);
      const structNode = {
        name: semanticLabel
      };

      if (node.id) structNode.id = node.id;
      if (node.route) structNode.route = node.route;
      if (node.action) structNode.action = node.action;
      if (node.role) structNode.role = node.role;

      const validChildren = (node.children || [])
        .filter(c => !['script', 'style', 'head', 'meta', 'link'].includes((c.name || '').toLowerCase()))
        .map(convertDOMToStructure);

      if (validChildren.length > 0) {
        structNode.children = validChildren;
      }

      return structNode;
    }

    let mainNode = (domTree.children || []).find(c => (c.name || '').toLowerCase() === 'body') || domTree;
    semantic.pageStructure = (mainNode.children || [])
      .filter(c => !['script', 'style'].includes((c.name || '').toLowerCase()))
      .map(convertDOMToStructure);

    // Dynamically extract Action Routes & Form Submissions
    function extractRoutesFromNode(node) {
      if (node.route) {
        const isExternal = /^(?:https?:)?\/\//i.test(node.route);
        if (!isExternal) {
          const routeObj = {
            name: node.text || node.id || inferElementSemantic(node),
            route: node.route,
            httpMethod: node.httpMethod || ((node.name || '').toLowerCase() === 'a' ? 'GET' : 'POST')
          };

          if (node.role) routeObj.allowed = node.role;

          // Extract Dynamic Parameters from Route
          const dynParams = [];
          const paramMatches = node.route.match(/\{\{.*?\}\}|:[a-zA-Z0-9_]+/g);
          if (paramMatches) {
            paramMatches.forEach(p => dynParams.push(p));
          }
          if (dynParams.length > 0) routeObj.dynamicParameters = dynParams.join(', ');

          semantic.actionRoutes.push(routeObj);
        }
      }

      if (node.children) {
        node.children.forEach(extractRoutesFromNode);
      }
    }

    extractRoutesFromNode(mainNode);

    // Extract Rich Table Semantics
    function findTables(node) {
      if ((node.name || '').toLowerCase() === 'table') {
        const cols = [];

        function extractCols(n) {
          if (['th', 'td'].includes((n.name || '').toLowerCase()) && n.text) {
            // Filter out template syntax from column names
            const cleanColText = n.text.replace(/\{\{[\s\S]*?\}\}/g, '').trim();
            if (cleanColText) cols.push(cleanColText);
          }
          if (n.children) n.children.forEach(extractCols);
        }

        extractCols(node);

        const detectedLoops = [];
        ast.goTemplates.forEach(gt => {
          if (gt.includes('range')) {
            const m = gt.match(/range\s+(?:\$[a-zA-Z0-9_]+,\s*\$[a-zA-Z0-9_]+\s*:=\s*)?\.([a-zA-Z0-9_]+)/);
            if (m) detectedLoops.push(`${m[1]}.map()`);
          }
        });

        // Categorize Conditional Expressions into Semantic Intents
        const conditionalRows = [];
        const computedValues = [];

        ast.goTemplates.forEach(gt => {
          if (gt.includes('if')) {
            const condMatch = gt.match(/if\s+([^}]+)/);
            if (condMatch) {
              const expr = condMatch[1].trim();
              if (/role|hasRole/i.test(expr)) {
                conditionalRows.push(`Role visibility (${expr})`);
              } else if (/expired|expiry|time|date/i.test(expr)) {
                computedValues.push(`Expired status (${expr})`);
              } else if (/dirty|modified|changed/i.test(expr)) {
                computedValues.push(`Dirty status (${expr})`);
              } else if (/status|class|active/i.test(expr)) {
                conditionalRows.push(`if ${expr}`);
              } else {
                computedValues.push(expr);
              }
            }
          }
        });

        semantic.tableSemantic = {
          loop: detectedLoops.length > 0 ? detectedLoops.join(', ') : null,
          computed: computedValues.length > 0 ? computedValues : null,
          rowCondition: conditionalRows.length > 0 ? conditionalRows.join('; ') : null,
          columns: cols.length > 0 ? cols : []
        };
      }

      if (node.children) {
        node.children.forEach(findTables);
      }
    }

    findTables(mainNode);

    // Reconstruct Migration Essentials dynamically from AST and DOM Graph evidence
    if (semantic.pageStructure.length > 0) semantic.migrationEssentials.preserve.push('layout hierarchy');
    if (ast.roles.size > 0) semantic.migrationEssentials.preserve.push('role conditions');
    if (semantic.tableSemantic) semantic.migrationEssentials.preserve.push('table mapping');
    if (semantic.actionRoutes.length > 0) semantic.migrationEssentials.preserve.push('routes');
    if (semantic.apiContract.length > 0) semantic.migrationEssentials.preserve.push('API interaction');
    if (ast.clientBehaviors.length > 0) semantic.migrationEssentials.preserve.push('state flow');
    if (ast.css.classes.length > 0 || ast.css.variables.length > 0) semantic.migrationEssentials.preserve.push('CSS appearance');

    return semantic;
  }

  // Stage 3: Clean Semantic LIR Formatting Engine
  function formatSemanticLIR(semantic) {
    let output = "==================================================\n";
    output += "SEMANTIC LIR COMPRESSED\n";
    output += `FILE: ${semantic.fileName}\n`;
    output += `TYPE: ${semantic.type}\n`;
    output += `PURPOSE: ${semantic.purpose}\n`;
    output += "==================================================\n\n";

    // PAGE STRUCTURE
    if (semantic.pageStructure && semantic.pageStructure.length > 0) {
      output += "[PAGE STRUCTURE]\n";

      function renderNode(node, prefix = '', marker = '') {
        let res = '';
        if (typeof node === 'string') {
          return `${prefix}${marker}${node}\n`;
        }

        res += `${prefix}${marker}${node.name}\n`;
        const childIndent = prefix + (marker ? (marker.startsWith('└──') ? '    ' : '│   ') : '');
        if (node.id) res += `${childIndent}│   id: ${node.id}\n`;
        if (node.action) res += `${childIndent}│   action: ${node.action}\n`;
        if (node.route) res += `${childIndent}│   route: ${node.route}\n`;
        if (node.role) res += `${childIndent}│   role: ${node.role}\n`;

        if (node.children && node.children.length > 0) {
          node.children.forEach((child, index) => {
            const isLast = index === node.children.length - 1;
            const childMarker = isLast ? '└── ' : '├── ';
            res += renderNode(child, childIndent, childMarker);
          });
        }
        return res;
      }

      semantic.pageStructure.forEach(root => {
        output += renderNode(root);
      });
      output += "==================================================\n\n";
    }

    // DATA MODEL
    const dm = semantic.dataModel;
    const hasContexts = dm && dm.contexts && dm.contexts.size > 0;
    const hasCollections = dm && dm.collections && dm.collections.size > 0;

    if (hasContexts || hasCollections) {
      output += "DATA MODEL\n";
      output += "==================================================\n";
      if (hasContexts) {
        output += `Context:\n${Array.from(dm.contexts).join('\n')}\n\n`;
      }
      if (hasCollections) {
        dm.collections.forEach((fields, colName) => {
          output += `Collection:\n${colName}[]\n\n`;
          if (fields.size > 0) {
            output += `Entity:\n${Array.from(fields).join('\n')}\n\n`;
          }
        });
      }
      output += "==================================================\n\n";
    }

    // TABLE SEMANTIC
    if (semantic.tableSemantic) {
      output += "TABLE SEMANTIC\n";
      output += "==================================================\n";
      if (semantic.tableSemantic.loop) {
        output += `Loop:\n${semantic.tableSemantic.loop}\n\n`;
      }
      if (semantic.tableSemantic.computed) {
        output += `Computed:\n${semantic.tableSemantic.computed}\n\n`;
      }
      if (semantic.tableSemantic.rowCondition) {
        output += `Row:\n${semantic.tableSemantic.rowCondition}\n\n`;
      }
      if (semantic.tableSemantic.columns.length > 0) {
        output += `Columns:\n${semantic.tableSemantic.columns.join('\n')}\n`;
      }
      output += "==================================================\n\n";
    }

    // ACTION ROUTES
    if (semantic.actionRoutes && semantic.actionRoutes.length > 0) {
      output += "ACTION ROUTES\n";
      output += "==================================================\n";
      semantic.actionRoutes.forEach(ar => {
        output += `Method: ${ar.httpMethod}\n`;
        output += `Route: ${ar.route}\n`;
        output += `Target: ${ar.name}\n`;
        if (ar.allowed) output += `Allowed: ${ar.allowed}\n`;
        if (ar.dynamicParameters) output += `Dynamic Parameters: ${ar.dynamicParameters}\n`;
        output += "--------------------------------------------------\n";
      });
      output += "==================================================\n\n";
    }

    // CLIENT BEHAVIOR
    if (semantic.clientBehaviors && semantic.clientBehaviors.length > 0) {
      output += "CLIENT BEHAVIOR\n";
      output += "==================================================\n";
      semantic.clientBehaviors.forEach((cb, idx) => {
        output += `${cb.name}:\n${cb.summary}\n`;
        if (idx < semantic.clientBehaviors.length - 1) {
          output += "--------------------------------------------------\n";
        }
      });
      output += "==================================================\n\n";
    }

    // API CONTRACT
    if (semantic.apiContract && semantic.apiContract.length > 0) {
      output += "API CONTRACT\n";
      output += "==================================================\n";
      semantic.apiContract.forEach(api => {
        output += `Method: ${api.method}\n`;
        output += `Route: ${api.url}\n`;
        if (api.trigger) output += `Trigger: ${api.trigger}\n`;
        if (api.dynamicParameters) output += `Parameters: ${api.dynamicParameters}\n`;
        output += "--------------------------------------------------\n";
      });
      output += "==================================================\n\n";
    }

    // STYLE MAP
    if (semantic.styleMap) {
      const hasVars = semantic.styleMap.variables.length > 0;
      const hasClasses = semantic.styleMap.classes.length > 0;
      const hasResp = semantic.styleMap.responsive.length > 0;

      if (hasVars || hasClasses || hasResp) {
        output += "STYLE MAP\n";
        output += "==================================================\n";
        if (hasVars) output += `CSS Variables: ${semantic.styleMap.variables.join(', ')}\n`;
        if (hasClasses) output += `Main Classes: ${semantic.styleMap.classes.join(', ')}\n`;
        if (hasResp) {
          output += "Responsive:\n";
          semantic.styleMap.responsive.forEach(r => {
            output += `  ${r.query}\n`;
            if (r.behavior) output += `    Behavior: ${r.behavior}\n`;
          });
        }
        output += "==================================================\n\n";
      }
    }

    // DEPENDENCIES
    if (semantic.dependencies && semantic.dependencies.length > 0) {
      output += "DEPENDENCIES\n";
      output += "==================================================\n";
      output += `External: ${semantic.dependencies.join(', ')}\n`;
      output += "==================================================\n\n";
    }

    // MIGRATION ESSENTIALS
    if (semantic.migrationEssentials && (semantic.migrationEssentials.preserve.length > 0 || semantic.migrationEssentials.ignore.length > 0)) {
      output += "MIGRATION ESSENTIALS\n";
      output += "==================================================\n";
      if (semantic.migrationEssentials.preserve.length > 0) output += `Preserve: - ${semantic.migrationEssentials.preserve.join(', ')}\n`;
      if (semantic.migrationEssentials.ignore.length > 0) output += `Ignore: - ${semantic.migrationEssentials.ignore.join(', ')}\n`;
      output += "==================================================";
    }

    return output;
  }

  // Pipeline Engine Entrypoint Stage
  async function frontendSemanticStage(context) {
    const { projectFiles, selectedFiles, pipelineContext } = context;
    let outputs = [];

    for (const fileKey of selectedFiles) {
      const file = projectFiles[fileKey];
      if (!file) continue;

      const content = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsText(file);
      });

      const fileName = file.name;
      const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';

      // 1. AST Parsing
      const ast = parseFrontendAST(content, fileName, ext);

      // 2. Generic Semantic Analysis
      const semantic = extractSemanticKnowledge(ast, content);

      // 3. Format to Clean Semantic LIR Output
      const lirOutput = formatSemanticLIR(semantic);
      outputs.push(lirOutput);
    }

    const finalOutput = outputs.join('\n\n=========================================\n\n');

    return {
      pipelineContext: {
        ...pipelineContext,
        frontendSemanticExtracted: true
      },
      finalOutput: finalOutput
    };
  }

  // Automatic Pipeline Stage Registration
if (typeof window !== 'undefined' && window.LirEngineRegistry) {
    window.LirEngineRegistry.registerStage(
        'frontend',
        frontendSemanticStage
    );
}
  
})();
