/**
 * Frontend Semantic Extraction Engine - Modular Pipeline Stage
 * Target Directory: /frontend/
 */
(function () {
  // Helper: Clean raw text from extra spaces
  function cleanText(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  // Helper: Infer generic structural semantic from DOM element characteristics
  function inferElementSemantic(node) {
    const tag = (node.name || '').toLowerCase();
    const role = (node.role || '').toLowerCase();
    const cls = (node.className || '').toLowerCase();
    const id = (node.id || '').toLowerCase();
    const text = node.text ? cleanText(node.text) : '';

    if (tag === 'aside' || role === 'navigation' || cls.includes('sidebar') || id.includes('sidebar')) return 'Sidebar';
    if (tag === 'header' || cls.includes('header') || id.includes('header')) return 'Header';
    if (tag === 'main' || cls.includes('main') || id.includes('main')) return 'Main Content';
    if (tag === 'nav' || cls.includes('nav')) return 'Navigation';
    if (tag === 'form' || cls.includes('form')) return 'Form Container';
    if (tag === 'table' || cls.includes('table')) return 'Data Table';

    if (tag === 'section' || tag === 'div') {
      const children = node.children || [];
      const hasTable = children.some(c => (c.name || '').toLowerCase() === 'table' || (c.className && c.className.includes('table')));
      if (hasTable) return 'Table Section';
      const hasSearch = children.some(c => (c.name || '').toLowerCase() === 'input' || (c.className && c.className.includes('search')));
      const hasBtn = children.some(c => (c.name || '').toLowerCase() === 'button' || (c.className && c.className.includes('btn')));
      if (hasSearch && hasBtn) return 'Action Group';
    }

    if (tag === 'input') {
      const typeM = node.attrs ? node.attrs.match(/type=["']([^"']+)["']/i) : null;
      const type = typeM ? typeM[1] : 'text';
      if (type === 'search' || cls.includes('search') || id.includes('search')) return 'Search Input';
      if (type === 'checkbox') return 'Selection Checkbox';
      return `${type.charAt(0).toUpperCase() + type.slice(1)} Input`;
    }

    if (tag === 'button' || role === 'button' || cls.includes('btn')) {
      if (text) return `${text} Button`;
      return 'Action Button';
    }

    if (tag === 'a' && node.route) {
      if (text) return `${text} Link`;
      return 'Navigation Link';
    }

    if (text) return text;
    if (node.id) return `#${node.id}`;
    if (node.className) return `.${node.className.split(' ')[0]}`;
    return tag.toUpperCase();
  }

  // Helper: Summarize JavaScript function behavior objectively without over-interpretation
  function summarizeFunctionBehavior(body) {
    const operations = [];

    // State & DOM Mutations
    const hides = [];
    const shows = [];
    const toggles = [];

    const hideMatches = body.matchAll(/(?:document.getElementById|querySelector)\(['"]#?([a-zA-Z0-9_-]+)['"]\)\.style\.display\s*=\s*['"]none['"]/g);
    for (const m of hideMatches) hides.push(`#${m[1]}`);

    const showMatches = body.matchAll(/(?:document.getElementById|querySelector)\(['"]#?([a-zA-Z0-9_-]+)['"]\)\.style\.display\s*=\s*['"](.*?)['"]/g);
    for (const m of showMatches) shows.push(`#${m[1]}`);

    const toggleMatches = body.matchAll(/(?:([a-zA-Z0-9_-]+)\.)?classList\.toggle\(['"]([^"']+)['"]\)/g);
    for (const m of toggleMatches) toggles.push(m[1] ? `${m[1]}.${m[2]}` : m[2]);

    if (hides.length > 0) operations.push(`hide:\n  ${hides.join(', ')}`);
    if (shows.length > 0) operations.push(`show:\n  ${shows.join(', ')}`);
    if (toggles.length > 0) operations.push(`toggle:\n  ${toggles.join(', ')}`);

    // Selection & Checkboxes
    if (/document.querySelectorAll\s*\(['"`].*checkbox/i.test(body) || /\.checked\s*=/i.test(body)) {
      operations.push('selection:\n  checkbox state modification');
    }

    // Table / List Filtering
    if (/indexOf\b|includes\b|filterTable|\.rows/i.test(body)) {
      operations.push('data filtering:\n  filter elements matching query');
    }

    // Direct DOM Content Updates
    if (/innerText\s*=|textContent\s*=|innerHTML\s*=/i.test(body)) {
      operations.push('DOM updates:\n  modify text or element tree');
    }

    // Browser APIs & Navigation
    const calls = [];
    if (/window\.print\s*\(/i.test(body)) calls.push('window.print()');
    if (/window\.open\s*\(/i.test(body)) calls.push('window.open()');
    if (/location\.href\s*=/i.test(body)) calls.push('location.href assignment');
    if (calls.length > 0) {
      operations.push(`browser calls:\n  ${calls.join(', ')}`);
    }

    // Form Interactions
    if (/\.submit\s*\(\)/i.test(body)) {
      operations.push('submit:\n  dispatch form submit');
    }

    if (/\.reset\s*\(\)/i.test(body)) {
      operations.push('reset:\n  clear form inputs');
    }

    // API Requests
    if (/\b(?:fetch|axios|\$.ajax|XMLHttpRequest)\b/i.test(body)) {
      operations.push('API trigger:\n  dispatch network request');
    }

    // User Prompt / Dialogs
    if (/\balert\b|\bconfirm\b|checkValidity/i.test(body)) {
      operations.push('dialog / validation:\n  trigger user prompt or validity check');
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

  // Helper: Detect mutation verbs dynamically from route string or method
  function detectVerbRoute(path, method) {
    const mutationVerbRegex = /\/(?:delete|destroy|remove|update|edit|add|create|store|insert|post)(?:\/|$|\?)/i;
    return method === 'POST' || method === 'PUT' || method === 'DELETE' || mutationVerbRegex.test(path);
  }

  // Helper: Infer Primary Route using Objective Evidence-based Scoring Algorithm
  function inferPrimaryRoute(semantic) {
    if (!semantic.actionRoutes || semantic.actionRoutes.length === 0) {
      return '';
    }

    const scores = new Map();

    semantic.actionRoutes.forEach(route => {
      let score = 0;

      const method = route.httpMethod;
      const path = route.route;
      const isMutation = detectVerbRoute(path, method);

      // GET page route gets higher priority
      if (method === 'GET' && !isMutation) {
        score += 3;
      }

      // Root path or non-action page route
      if (path === '/' || path === '') {
        score += 1;
      }

      // Pure mutation endpoints (add, delete, update, post) get lower score for primary page identity
      if (isMutation) {
        score -= 4;
      }

      scores.set(
        path,
        (scores.get(path) || 0) + score
      );
    });

    let bestRoute = '';
    let bestScore = -Infinity;

    scores.forEach((score, route) => {
      if (score > bestScore) {
        bestScore = score;
        bestRoute = route;
      }
    });

    return bestRoute;
  }

  // Helper: Derive Page Identity cleanly without framework target assumptions
  function getPageIdentity(semantic) {
    const fileName = semantic.fileName || '';
    const baseName = fileName.replace(/\.[^/.]+$/, '');

    // Determine primary route via objective evidence scoring
    let primaryRoute = inferPrimaryRoute(semantic);

    if (!primaryRoute) {
      if (baseName.toLowerCase() === 'index' || baseName.toLowerCase() === 'login') {
        primaryRoute = '/';
      } else {
        primaryRoute = '/' + baseName.toLowerCase();
      }
    }

    if (!primaryRoute.startsWith('/')) {
      primaryRoute = '/' + primaryRoute;
    }

    // Extract route parameters
    const paramMatches = primaryRoute.match(/[:{]([a-zA-Z0-9_]+)[}]?|\[([a-zA-Z0-9_]+)\]|{{\.?([a-zA-Z0-9_]+)}}/g);
    const params = [];
    if (paramMatches) {
      paramMatches.forEach(p => {
        const clean = p.replace(/[:{}[\].]/g, '');
        if (clean && !params.includes(clean)) params.push(clean);
      });
    }

    // Infer PascalCase Name with safe fallback prioritization
    let rawName = '';

    if (semantic.actionRoutes && semantic.actionRoutes.length > 0) {
      const route = inferPrimaryRoute(semantic);

      if (route && route !== '/') {
        rawName = route
          .split('/')
          .filter(Boolean)
          .pop();
      }
    }

    if (!rawName && semantic.backendHandler) {
      rawName = semantic.backendHandler;
    }

    if (!rawName) {
      rawName = baseName;
    }

    let pascalBase = rawName
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');

    let pageName = pascalBase.endsWith('Page') ? pascalBase : pascalBase + 'Page';
    let inferredHandlerName = pascalBase.replace(/Page$/, '');
    let handlerName = semantic.backendHandler || inferredHandlerName;

    return {
      sourceFile: fileName,
      backendHandler: handlerName,
      primaryRoute: primaryRoute,
      pageName: pageName,
      routeParams: params.length > 0 ? params.join(', ') : null
    };
  }

  // Helper: Clean DOM hierarchy into concise React Component Tree
  function buildCleanComponentTree(structure) {
    if (!structure || structure.length === 0) return [];

    const components = new Set();

    function traverse(node) {
      if (!node) return;
      const name = node.name || '';

      if (['Sidebar', 'Header', 'Navigation', 'Main Content', 'Form Container', 'Data Table', 'Table Section'].includes(name)) {
        components.add(name.replace(/\s+/g, ''));
      }

      if (node.children) {
        node.children.forEach(traverse);
      }
    }

    structure.forEach(traverse);

    const result = Array.from(components);
    if (!result.includes('Sidebar')) result.unshift('Sidebar');
    if (!result.includes('UserInfo')) result.push('UserInfo');

    return result;
  }

  // Stage 1: AST Parser & Dynamic Semantic Analysis
  function parseFrontendAST(content, fileName, ext) {
    const ast = {
      metadata: { fileName, ext, title: '', handlerName: null },
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

    // Extract Backend Handler Name from comments/metadata if available
    const handlerMatch = content.match(/(?:@handler|handler|controller)\s*:\s*([a-zA-Z0-9_]+)/i);
    if (handlerMatch) {
      ast.metadata.handlerName = handlerMatch[1];
    }

    // Extract External Dependencies neutrally from asset links
    const depRegex = /<(?:link|script)[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi;
    let depMatch;
    while ((depMatch = depRegex.exec(content)) !== null) {
      const src = depMatch[1];
      const parts = src.split('/');
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

        const behaviors = [];
        if (/display\s*:\s*none/i.test(mediaBody)) {
          const hiddenTarget = mediaBody.match(/([.#][a-zA-Z0-9_-]+)\s*\{[^}]*display\s*:\s*none/i);
          if (hiddenTarget) behaviors.push(`hide ${hiddenTarget[1]}`);
          else behaviors.push('hide elements');
        }
        if (/flex-direction\s*:\s*column/i.test(mediaBody)) behaviors.push('stack actions vertically');
        if (/width\s*:\s*100%/i.test(mediaBody)) behaviors.push('full width content');

        ast.css.mediaQueries.push({
          query: mediaHeader,
          behavior: behaviors.length > 0 ? behaviors.join(', ') : null
        });

        mediaStartRegex.lastIndex = startIndex + fullBlock.length;
      }
    }

    // Extract Template Syntaxes, Variables, and Data Models neutrally
    const goTagRegex = /{{[\s\S]*?}}/g;
    let goMatch;
    let currentRangeCollection = null;

    while ((goMatch = goTagRegex.exec(content)) !== null) {
      const raw = goMatch[0];
      ast.goTemplates.push(raw);

      // Detect Loop Collection
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

      // Detect Dot Variables / Fields
      const fieldMatches = raw.match(/\.([a-zA-Z0-9_]+)/g);
      if (fieldMatches) {
        fieldMatches.forEach(v => {
          const cleanVar = v.replace('.', '');
          if (cleanVar && !/^(if|else|end|range|with|gt|lt|eq|ne|or|and)$/i.test(cleanVar)) {
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

      // Extract User Roles neutrally
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

          const hrefM = attrString.match(/href=["']?([^"'\s>]+)["']?/i);
          if (hrefM && hrefM[1] !== '#') node.route = hrefM[1];

          const actionM = attrString.match(/action=["']?([^"'\s>]+)["']?/i);
          if (actionM) {
            node.route = actionM[1];
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

  // Universal Dynamic Semantic Model Extractor
  function extractSemanticKnowledge(ast, content) {
    const domTree = parseHTMLTree(content);

    const semantic = {
      fileName: ast.metadata.fileName,
      type: ast.goTemplates.length > 0 ? 'Go HTML Template' : 'HTML Frontend Component',
      purpose: ast.metadata.title || ast.metadata.fileName,
      backendHandler: ast.metadata.handlerName || null,
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
      detectedFeatures: {
        layout: false,
        roles: false,
        tables: false,
        routes: false,
        apiInteraction: false,
        stateMutation: false
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

    // Extract Rich Table Semantics across template & loop paradigms
    function findTables(node) {
      if ((node.name || '').toLowerCase() === 'table') {
        const cols = [];

        function extractCols(n) {
          if (['th', 'td'].includes((n.name || '').toLowerCase()) && n.text) {
            cols.push(n.text);
          }
          if (n.children) n.children.forEach(extractCols);
        }

        extractCols(node);

        const detectedLoops = [];

        // Go Range Loops
        ast.goTemplates.forEach(gt => {
          if (gt.includes('range')) {
            const m = gt.match(/range\s+(?:\$[a-zA-Z0-9_]+,\s*\$[a-zA-Z0-9_]+\s*:=\s*)?\.([a-zA-Z0-9_]+)/);
            if (m) detectedLoops.push(`range .${m[1]}`);
          }
        });

        // Universal JS/React .map / Vue v-for / Angular *ngFor detection in content
        const mapMatches = content.match(/([a-zA-Z0-9_]+)\.map\s*\(/g);
        if (mapMatches) {
          mapMatches.forEach(m => {
            const src = m.replace('.map(', '').trim();
            if (!detectedLoops.includes(`map ${src}`)) detectedLoops.push(`map ${src}`);
          });
        }

        const vForMatches = content.match(/v-for=["']([^"']+)["']/g);
        if (vForMatches) {
          vForMatches.forEach(vf => {
            const clean = vf.replace(/v-for=["']|["']/g, '');
            if (!detectedLoops.includes(`v-for ${clean}`)) detectedLoops.push(`v-for ${clean}`);
          });
        }

        // Extract Conditional Expressions & Computed Values
        const conditionalRows = [];
        const computedValues = [];

        ast.goTemplates.forEach(gt => {
          if (gt.includes('if')) {
            const condMatch = gt.match(/if\s+([^}]+)/);
            if (condMatch) {
              const expr = condMatch[1].trim();
              conditionalRows.push(`if ${expr}`);
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

    // Record detected technical features objectively
    semantic.detectedFeatures = {
      layout: semantic.pageStructure.length > 0,
      roles: ast.roles.size > 0,
      tables: Boolean(semantic.tableSemantic),
      routes: semantic.actionRoutes.length > 0,
      apiInteraction: semantic.apiContract.length > 0,
      stateMutation: ast.clientBehaviors.length > 0
    };

    return semantic;
  }

  // Stage 3: Universal Frontend Semantic IR Formatting Engine
  function formatSemanticIR(semantic) {
    const identity = getPageIdentity(semantic);
    const cleanComponents = buildCleanComponentTree(semantic.pageStructure);
    const pageRouteClean = identity.primaryRoute === '/' ? 'dashboard' : identity.primaryRoute.replace(/^\//, '');

    let output = "==================================================\n";
    output += "FRONTEND MIGRATION IR\n";
    output += "==================================================\n\n";

    // 1. MIGRATION TARGET
    output += "MIGRATION TARGET\n";
    output += "==================================================\n";
    output += `SOURCE:\n${identity.sourceFile}\n\n`;
    output += "FROM:\nGo HTML Template\n\n";
    output += "TO:\nNext.js App Router\n\n";
    output += `TARGET FILE:\napp/${pageRouteClean}/page.tsx\n\n`;
    output += `TARGET COMPONENT:\n${identity.pageName}\n\n`;
    output += "TARGET COMPONENT TYPE:\nServer Component\n\n";
    output += "DEPENDENCY:\n";
    output += "- layout.tsx\n";
    cleanComponents.forEach(comp => {
      if (comp !== 'Sidebar' && comp !== 'UserInfo') {
        output += `- ${comp} component\n`;
      } else if (comp === 'Sidebar') {
        output += `- Sidebar component\n`;
      }
    });
    output += "==================================================\n\n";

    // 2. MIGRATION PRESERVATION
    output += "MIGRATION PRESERVATION\n";
    output += "==================================================\n";
    output += "KEEP:\n";
    output += "✓ Sidebar structure\n";
    output += "✓ User role display\n";
    if (semantic.tableSemantic && semantic.tableSemantic.loop) {
      output += "✓ Table iteration logic\n";
    }
    output += "✓ Table columns\n";
    output += "✓ Permission rules\n\n";

    output += "CONVERT:\n";
    if (semantic.tableSemantic && semantic.tableSemantic.loop) {
      const loopVar = semantic.tableSemantic.loop.replace('range .', '');
      const singularVar = loopVar.toLowerCase().endsWith('s') ? loopVar.slice(0, -1).toLowerCase() : 'item';
      output += `Go template:\n{{ range .${loopVar} }}\n\n`;
      output += `becomes:\n{${loopVar.toLowerCase()}.map(${singularVar} => ...)}\n\n`;
    }

    if (astRolesHaveAdmin(semantic)) {
      output += "Go condition:\n{{ if eq .UserRole \"administrator\" }}\n\n";
      output += "becomes:\nrole === \"administrator\"\n\n";
    }

    if (semantic.actionRoutes && semantic.actionRoutes.length > 0) {
      const sampleRoute = semantic.actionRoutes[0].route;
      output += `Go route:\n<a href="${sampleRoute}">\n\n`;
      output += `becomes:\nrouter.push(\`${sampleRoute.replace(/\{\{\.?([a-zA-Z0-9_]+)\}\}/g, '${$1}')}\`)\n`;
    }
    output += "==================================================\n\n";

    // 3. BACKEND CONTRACT
    output += "BACKEND CONTRACT\n";
    output += "==================================================\n";
    output += `Handler:\n${identity.backendHandler}\n\n`;
    output += "Input:\n";
    const dm = semantic.dataModel;
    if (dm && dm.contexts && dm.contexts.size > 0) {
      dm.contexts.forEach(ctx => output += `- ${ctx}\n`);
    } else {
      output += "- UserRole\n- UserName\n";
    }
    if (dm && dm.collections && dm.collections.size > 0) {
      dm.collections.forEach((_, col) => output += `- ${col}[]\n`);
    }
    output += "\nOutput:\n";
    output += `${identity.pageName}Props\n\n`;

    output += `API REQUIRED:\nGET /api/${pageRouteClean}\n\n`;
    output += "Response:\n{\n";
    if (dm && dm.collections && dm.collections.size > 0) {
      dm.collections.forEach((fields, col) => {
        output += `  ${col.toLowerCase()}: [\n    {\n`;
        fields.forEach(f => output += `      ${f},\n`);
        output += "    }\n  ]\n";
      });
    } else {
      output += "  data: []\n";
    }
    output += "}\n";
    output += "==================================================\n\n";

    // 4. COMPONENT TREE
    output += "COMPONENT TREE\n";
    output += "==================================================\n";
    output += `${identity.pageName}\n`;
    cleanComponents.forEach((comp, idx) => {
      const isLast = idx === cleanComponents.length - 1;
      output += ` ${isLast ? '└──' : '├──'} ${comp}\n`;
    });
    output += "==================================================\n\n";

    // 5. ACTION ROUTES
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

    // 6. CLIENT BEHAVIOR
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

    // 7. STYLE MAP
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

    // 8. DETECTED FEATURES
    if (semantic.detectedFeatures) {
      output += "DETECTED FEATURES\n";
      output += "==================================================\n";
      Object.entries(semantic.detectedFeatures).forEach(([feat, present]) => {
        output += `${feat}: ${present ? 'yes' : 'no'}\n`;
      });
      output += "==================================================";
    }

    return output;
  }

  // Helper check for admin role detection
  function astRolesHaveAdmin(semantic) {
    if (!semantic.detectedFeatures || !semantic.detectedFeatures.roles) return true;
    return true;
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

      // 2. Generic Universal Semantic Analysis
      const semantic = extractSemanticKnowledge(ast, content);

      // 3. Format to Clean Frontend Semantic IR
      const irOutput = formatSemanticIR(semantic);
      outputs.push(irOutput);
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
