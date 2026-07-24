/**
 * viber3.js - Next-Gen Lossless Intermediate Representation (LIR) Compiler Frontend
 * Target: Go Template / Vanilla JS -> Lossless Semantic LIR
 * Version: 3.2.0-FINAL
 */

const fs = require('fs');
const path = require('path');

class Viber3Analyzer {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Main entry point to analyze HTML / Go Template source string
   */
  analyze(sourceCode) {
    const aliasMap = this.extractTemplateAliases(sourceCode);
    const functions = this.extractFunctionSemantics(sourceCode, aliasMap);
    const routesAndApis = this.extractRoutesAndApis(sourceCode);
    const resolvedTemplates = this.resolveTemplateExpressions(sourceCode);
    const domTree = this.buildCompactDOMTree(sourceCode);
    const dataBindings = this.extractDataBindings(sourceCode);
    const jsStatementMap = this.extractJSStatementResolutions(sourceCode);
    const renderDependencies = this.extractRenderDependencies(sourceCode, functions);
    const listRenderingSemantics = this.extractListRenderingSemantics(sourceCode);
    const conditionalRenderingSemantics = this.extractConditionalRenderingSemantics(sourceCode);
    const styleDependencies = this.extractStyleDependencies(sourceCode, functions);
    const layoutDependencies = this.extractLayoutDependencies(sourceCode);
    const componentBoundaries = this.extractComponentBoundaries(sourceCode);
    const possibleUiStates = this.extractPossibleUiStates(sourceCode, functions);

    return {
      version: "3.2.0-FINAL",
      target: "Go Template / HTML -> Lossless Semantic LIR",
      routesAndApis,
      templateAliases: aliasMap,
      dataBindings,
      functionSemantics: functions,
      resolvedTemplates,
      jsStatementResolutions: jsStatementMap,
      renderDependencies,
      listRenderingSemantics,
      conditionalRenderingSemantics,
      styleDependencies,
      layoutDependencies,
      componentBoundaries,
      possibleUiStates,
      domTree
    };
  }

  /**
   * 1. Template Alias Resolver Layer
   */
  extractTemplateAliases(source) {
    const aliases = {};
    const regex = /\{\{\s*(\$[a-zA-Z0-9_]+)\s*:=\s*(.*?)\s*\}\}/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
      const alias = match[1];
      const rawExpr = match[2];
      aliases[alias] = this.cleanGoExpression(rawExpr);
    }
    return aliases;
  }

  /**
   * 2. Template Resolver Layer
   */
  resolveTemplateExpressions(source) {
    const expressions = [];
    const regex = /\{\{\s*(.*?)\s*\}\}/g;
    let match;

    while ((match = regex.exec(source)) !== null) {
      const raw = match[1].trim();
      if (raw.startsWith('$') && raw.includes(':=')) continue; // Skip assignment aliases

      let type = "Expression";
      let resolved = raw;

      if (/^(else\s+)?if\b/.test(raw)) {
        type = "Condition";
        resolved = this.translateGoCondition(raw.replace(/^(else\s+)?if\s+/, ''));
      } else if (raw.startsWith("range ")) {
        type = "Loop";
        resolved = raw.replace(/^range\s+/, '').trim();
      } else if (raw.startsWith("with ")) {
        type = "Scope Context";
        resolved = this.cleanGoExpression(raw.replace(/^with\s+/, ''));
      } else {
        resolved = this.cleanGoExpression(raw);
      }

      expressions.push({ raw: `{{ ${raw} }}`, type, resolved });
    }

    return expressions;
  }

  /**
   * 3. Function Semantics Layer (Fact-Based)
   */
  extractFunctionSemantics(source, aliasMap) {
    const functions = [];
    const fnRegex = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g;
    let match;

    while ((match = fnRegex.exec(source)) !== null) {
      const name = match[1];
      const params = match[2].split(',').map(p => p.trim()).filter(Boolean);
      const body = match[3];

      const trigger = this.inferTrigger(name, source);
      const returnValue = this.extractReturnValue(body);
      const apiCalls = this.extractAPICallsFromFn(body);
      const navigation = this.extractNavigationFromFn(body);
      const validation = this.extractValidationFromFn(body);
      const sideEffects = this.extractSideEffectsFromFn(body);
      const dependencies = this.extractDependenciesFromFn(body);

      const reads = this.extractRichDOMReads(body);
      const writes = this.extractRichDOMWrites(body);
      const businessFlow = this.extractDeepBusinessFlow(body, trigger);

      functions.push({
        function: name,
        purpose: this.inferPurpose(name, body),
        trigger,
        params,
        returnValue,
        businessFlow,
        domReads: reads,
        domWrites: writes,
        apiCalls,
        navigation,
        validation,
        sideEffects,
        dependencies
      });
    }

    return functions;
  }

  /**
   * 4. Route Analyzer Layer
   */
  extractRoutesAndApis(source) {
    const staticRoutes = new Set();
    const dynamicRoutes = [];
    const apiRoutes = [];

    const hrefRegex = /(?:href|action)=["']([^"']+)["']/g;
    let match;
    while ((match = hrefRegex.exec(source)) !== null) {
      const url = match[1];
      if (url.startsWith('#') || url.startsWith('javascript:')) continue;

      if (url.includes('{{') || url.includes('${') || url.includes(':')) {
        dynamicRoutes.push({
          type: "Dynamic Route",
          rawPattern: url,
          resolvedPattern: this.cleanGoExpression(url)
        });
      } else {
        staticRoutes.add(url);
      }
    }

    const fetchRegex = /fetch\(["']([^"']+)["'](?:\s*,\s*\{([^}]*)\})?/g;
    while ((match = fetchRegex.exec(source)) !== null) {
      const url = match[1];
      const options = match[2] || "";
      const methodMatch = options.match(/method:\s*["']([^"']+)["']/i);
      apiRoutes.push({
        type: "API Route",
        endpoint: url,
        method: methodMatch ? methodMatch[1].toUpperCase() : "GET"
      });
    }

    const winOpenRegex = /window\.open\(["']([^"']+)["']/g;
    while ((match = winOpenRegex.exec(source)) !== null) {
      const url = match[1];
      apiRoutes.push({
        type: "Navigation Window",
        endpoint: url,
        method: "GET"
      });
    }

    return {
      staticRoutes: Array.from(staticRoutes),
      dynamicRoutes,
      apiRoutes
    };
  }

  /**
   * 5. Data Binding Layer
   */
  extractDataBindings(source) {
    const bindings = [];
    const attrRegex = /\b(id|class|style|title|src|href|value|checked|selected|placeholder|data-[a-z-]+|aria-[a-z-]+)=["']([^"']*\{\{[\s\S]*?\}\}[^"']*)["']/gi;
    let match;

    while ((match = attrRegex.exec(source)) !== null) {
      bindings.push({
        attribute: match[1].toLowerCase(),
        rawTemplate: match[2],
        boundExpression: this.cleanGoExpression(match[2].replace(/\{\{\s*|\s*\}\}/g, ''))
      });
    }

    const textRegex = />([^<]*\{\{[\s\S]*?\}\}[^<]*)</g;
    while ((match = textRegex.exec(source)) !== null) {
      const content = match[1].trim();
      if (content) {
        bindings.push({
          attribute: "textContent",
          rawTemplate: content,
          boundExpression: this.cleanGoExpression(content.replace(/\{\{\s*|\s*\}\}/g, ''))
        });
      }
    }

    return bindings;
  }

  /**
   * 6. JS Statement Resolver Layer
   */
  extractJSStatementResolutions(source) {
    const resolutions = [];
    const statementMap = [
      { pattern: /Array\.from\(/g, semantic: "Convert NodeList into Array" },
      { pattern: /\.join\(["'](.*?)["']\)/g, semantic: "Create Delimited String" },
      { pattern: /encodeURIComponent\(/g, semantic: "Encode URL Parameter" },
      { pattern: /fetch\(/g, semantic: "HTTP Request" },
      { pattern: /window\.open\(/g, semantic: "Open New Browser Window" },
      { pattern: /confirm\(/g, semantic: "Confirmation Dialog" },
      { pattern: /querySelectorAll\(/g, semantic: "Select Multiple DOM Nodes" },
      { pattern: /getElementById\(/g, semantic: "Lookup DOM Element" },
      { pattern: /getElementsByClassName\(/g, semantic: "Select Elements by Class" }
    ];

    statementMap.forEach(({ pattern, semantic }) => {
      if (pattern.test(source)) {
        resolutions.push({ operation: pattern.source.replace(/\\/g, ''), semantic });
      }
    });

    return resolutions;
  }

  /**
   * 7. Render Dependency Layer
   */
  extractRenderDependencies(source, functions) {
    const deps = [];
    const nodeToFunctions = {};

    functions.forEach(fn => {
      fn.domWrites.forEach(w => {
        if (!nodeToFunctions[w.target]) {
          nodeToFunctions[w.target] = { functions: new Set(), mutations: new Set() };
        }
        nodeToFunctions[w.target].functions.add(fn.function);
        nodeToFunctions[w.target].mutations.add(w.mutation);
      });
    });

    Object.entries(nodeToFunctions).forEach(([node, data]) => {
      deps.push({
        node,
        visibilityControlledByFunctions: Array.from(data.functions),
        observedMutation: Array.from(data.mutations).join(', ')
      });
    });

    return deps;
  }

  /**
   * 8. List Rendering Semantic Layer
   */
  extractListRenderingSemantics(source) {
    const listSemantics = [];
    const rangeRegex = /\{\{\s*range\s+(?:(\$[a-zA-Z0-9_]+),\s*(\$[a-zA-Z0-9_]+)\s*:=\s*)?(\.?[a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g;
    let match;

    while ((match = rangeRegex.exec(source)) !== null) {
      const indexVar = match[1] ? match[1].replace('$', '') : 'index';
      const itemVar = match[2] ? match[2].replace('$', '') : (match[1] ? match[1].replace('$', '') : 'item');
      const sourceCollection = this.cleanVar(match[3]);
      const body = match[4];

      const nodeMatch = body.match(/<([a-zA-Z0-9-]+)/);
      const renderedNode = nodeMatch ? `<${nodeMatch[1]}>` : "Text/DOM Fragment";

      listSemantics.push({
        loopSource: sourceCollection,
        iterator: itemVar,
        index: indexVar,
        renderedNode,
        loopPurpose: `Iterate and render items from ${sourceCollection}`
      });
    }

    return listSemantics;
  }

  /**
   * 9. Conditional Rendering Semantic Layer
   */
  extractConditionalRenderingSemantics(source) {
    const conditionalSemantics = [];
    const ifRegex = /\{\{\s*if\s+(.*?)\s*\}\}([\s\S]*?)(?:\{\{\s*else\s*\}\}([\s\S]*?))?\{\{\s*end\s*\}\}/g;
    let match;

    while ((match = ifRegex.exec(source)) !== null) {
      const rawCondition = match[1];
      const trueBranch = match[2];
      const falseBranch = match[3] || null;

      const cleanedCond = this.translateGoCondition(rawCondition);

      const targetMatch = trueBranch.match(/id=["']([^"']+)["']/) || trueBranch.match(/<([a-zA-Z0-9-]+)/);
      const affectedNode = targetMatch ? (targetMatch[1] ? `#${targetMatch[1]}` : `<${targetMatch[0]}>`) : "DOM Node Fragment";

      conditionalSemantics.push({
        condition: cleanedCond,
        affectedNode,
        observedBehavior: falseBranch 
          ? "Rendered True Branch when Condition Is True, False Branch when False" 
          : "Rendered Only When Condition Is True"
      });
    }

    return conditionalSemantics;
  }

  /**
   * 10. Style Dependency Layer
   */
  extractStyleDependencies(source, functions) {
    const dependencies = [];

    const classRegex = /class=["']([^"']*\{\{[\s\S]*?\}\}[^"']*)["']/gi;
    let match;
    while ((match = classRegex.exec(source)) !== null) {
      const rawClass = match[1];
      const condMatch = rawClass.match(/\{\{\s*if\s+(.*?)\s*\}\}(.*?)(?:\{\{\s*else\s*\}\}(.*?))?\{\{\s*end\s*\}\}/);
      if (condMatch) {
        dependencies.push({
          element: "Dynamic Class Element",
          triggerCondition: this.cleanGoExpression(condMatch[1]),
          appliedClass: condMatch[2].trim(),
          removedClass: condMatch[3] ? condMatch[3].trim() : "None",
          inlineStyleMutation: "None"
        });
      }
    }

    functions.forEach(fn => {
      fn.domWrites.forEach(w => {
        if (w.mutation.includes('style.')) {
          dependencies.push({
            element: w.target,
            triggerCondition: `Execution of ${fn.function}()`,
            appliedClass: "N/A",
            removedClass: "N/A",
            inlineStyleMutation: w.mutation
          });
        }
      });
    });

    return dependencies;
  }

  /**
   * 11. Layout Dependency Layer
   */
  extractLayoutDependencies(source) {
    const layouts = [];

    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(source)) !== null) {
      const tableContent = tableMatch[1];

      const colWidths = [];
      const colRegex = /<th[^>]*style=["'][^"']*width:\s*([^"';]+)[^"']*["'][^>]*>/gi;
      let colMatch;
      while ((colMatch = colRegex.exec(tableContent)) !== null) {
        colWidths.push(colMatch[1].trim());
      }

      const thCount = (tableContent.match(/<th\b/gi) || []).length;
      const hasHeader = /<thead/i.test(tableContent) || thCount > 0;
      const hasBody = /<tbody/i.test(tableContent) || /<tr/i.test(tableContent);
      const hasFooter = /<tfoot/i.test(tableContent);

      layouts.push({
        tableColumnCount: thCount,
        columnWidths: colWidths.length > 0 ? colWidths : ["auto"],
        stickyHeader: /sticky/i.test(source),
        overflow: /overflow-x|table-responsive/i.test(source) ? "Horizontal Scroll" : "Standard",
        containerHierarchy: {
          hasHeader,
          hasBody,
          hasFooter
        },
        nestedLayout: false,
        responsiveWrapper: /table-responsive/i.test(source)
      });
    }

    return layouts;
  }

  /**
   * 12. Component Boundary Layer
   */
  extractComponentBoundaries(source) {
    const boundaries = [];

    const regions = [
      { name: "Sidebar", regex: /<(?:aside|div)[^>]*id=["']sidebar["'][^>]*>([\s\S]*?)<\/(?:aside|div)>/i, contains: "Navigation Links, User Profile" },
      { name: "Header", regex: /<(?:header|div)[^>]*id=["']header["'][^>]*>([\s\S]*?)<\/(?:header|div)>/i, contains: "Search Bar, User Actions" },
      { name: "Toolbar", regex: /<(?:div)[^>]*class=["'][^"']*toolbar[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, contains: "Action Buttons, Batch Controls" },
      { name: "Table", regex: /<table[^>]*>([\s\S]*?)<\/table>/i, contains: "Header, Data Body Rows, Action Cell" }
    ];

    regions.forEach(r => {
      if (r.regex.test(source)) {
        boundaries.push({
          component: r.name,
          contains: r.contains
        });
      }
    });

    if (boundaries.length === 0) {
      boundaries.push({
        component: "MainContainer",
        contains: "Full View Structure"
      });
    }

    return boundaries;
  }

  /**
   * 13. Possible UI States Layer (Fact-Based)
   */
  extractPossibleUiStates(source, functions) {
    const states = [];

    let hasDisplayMutations = false;
    let hasCheckboxMutations = false;

    functions.forEach(fn => {
      fn.domWrites.forEach(w => {
        if (w.mutation.includes('style.display')) hasDisplayMutations = true;
        if (w.mutation.includes('checked')) hasCheckboxMutations = true;
      });
    });

    if (hasDisplayMutations) {
      states.push({
        possibleUiState: "Boolean Visibility Controller",
        evidence: "style.display toggled on DOM element(s)"
      });
    }

    if (hasCheckboxMutations || /type=["']checkbox["']/i.test(source)) {
      states.push({
        possibleUiState: "Selection / Checked State",
        evidence: "checkbox input or checked property mutation observed in source"
      });
    }

    return states;
  }

  /**
   * 14. Compact DOM Tree Layer
   */
  buildCompactDOMTree(source) {
    const cleanSource = source.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>/g;
    const tree = [];
    let match;

    while ((match = tagRegex.exec(cleanSource)) !== null) {
      const tagName = match[1];
      const attrs = match[2];

      const idMatch = attrs.match(/id=["']([^"']+)["']/);
      const classMatch = attrs.match(/class=["']([^"']+)["']/);
      const eventMatch = attrs.match(/(on[a-z]+)=["']([^"']+)["']/g);

      if (idMatch || eventMatch || tagName === 'form' || tagName === 'table') {
        const node = { tag: tagName };
        if (idMatch) node.id = idMatch[1];
        if (classMatch) node.className = classMatch[1];
        if (eventMatch) {
          node.events = eventMatch.map(e => {
            const [evt, handler] = e.split('=');
            return { event: evt, handler: handler.replace(/["']/g, '') };
          });
        }
        tree.push(node);
      }
    }

    return tree;
  }

  /* --- Helper Methods --- */

  cleanVar(str) {
    if (!str) return '';
    return str.replace(/^\./, '').replace(/^\$/, '');
  }

  cleanGoExpression(expr) {
    let clean = expr.trim();
    if (clean.startsWith('.')) clean = clean.substring(1);
    clean = clean.replace(/eq\s+([^\s]+)\s+["']([^"']+)["']/g, '$1 === "$2"');
    clean = clean.replace(/ne\s+([^\s]+)\s+["']([^"']+)["']/g, '$1 !== "$2"');
    clean = clean.replace(/gt\s+([^\s]+)\s+([^\s]+)/g, '$1 > $2');
    clean = clean.replace(/lt\s+([^\s]+)\s+([^\s]+)/g, '$1 < $2');
    clean = clean.replace(/ge\s+([^\s]+)\s+([^\s]+)/g, '$1 >= $2');
    clean = clean.replace(/le\s+([^\s]+)\s+([^\s]+)/g, '$1 <= $2');
    clean = clean.replace(/not\s+([^\s]+)/g, '!$1');
    return clean;
  }

  translateGoCondition(cond) {
    let result = cond.trim();
    result = result.replace(/or\s+\((.*?)\)\s+\((.*?)\)/g, '($1) || ($2)');
    result = result.replace(/and\s+\((.*?)\)\s+\((.*?)\)/g, '($1) && ($2)');
    result = result.replace(/or\s+([^\s()]+)\s+([^\s()]+)/g, '$1 || $2');
    result = result.replace(/and\s+([^\s()]+)\s+([^\s()]+)/g, '$1 && $2');
    return this.cleanGoExpression(result);
  }

  inferTrigger(fnName, source) {
    const regex = new RegExp(`(onclick|onchange|onsubmit)=["'][^"']*${fnName}\\([^"']*["']`, 'i');
    const match = source.match(regex);
    if (match) {
      return `User ${match[1].replace('on', '').toUpperCase()} Event`;
    }
    return "Explicit / Inverted Function Call";
  }

  extractReturnValue(body) {
    const retMatch = body.match(/return\s+([^;]+);/);
    return retMatch ? retMatch[1].trim() : "Void";
  }

  extractAPICallsFromFn(body) {
    const calls = [];
    const fetchMatch = body.match(/fetch\(["']([^"']+)["']/);
    if (fetchMatch) calls.push(`fetch("${fetchMatch[1]}")`);
    return calls.length > 0 ? calls : ["None"];
  }

  extractNavigationFromFn(body) {
    const navs = [];
    if (body.includes('window.open')) navs.push("window.open()");
    if (body.includes('window.location')) navs.push("window.location redirect");
    return navs.length > 0 ? navs : ["None"];
  }

  extractValidationFromFn(body) {
    const vals = [];
    const ifConds = body.match(/if\s*\((.*?)\)/g);
    if (ifConds) {
      ifConds.forEach(c => vals.push(`Check condition: ${c.replace(/^if\s*\(/, '').replace(/\)$/, '')}`));
    }
    return vals.length > 0 ? vals : ["None"];
  }

  extractSideEffectsFromFn(body) {
    const effects = [];
    if (body.includes('alert(')) effects.push("Trigger Browser Alert Dialog");
    if (body.includes('confirm(')) effects.push("Trigger Confirmation Modal");
    if (body.includes('.focus()')) effects.push("Focus DOM Input Control");
    return effects.length > 0 ? effects : ["DOM Mutation"];
  }

  extractDependenciesFromFn(body) {
    const deps = new Set();
    const matches = body.match(/(?:[a-zA-Z0-9_]+)\.(length|value|checked)/g);
    if (matches) {
      matches.forEach(m => deps.add(m.split('.')[0]));
    }
    return Array.from(deps).length > 0 ? Array.from(deps) : ["None"];
  }

  extractRichDOMReads(body) {
    const reads = [];
    const regex = /(?:document\.(?:getElementById|querySelector(?:All)?)\(["']([^"']+)["']\)|([a-zA-Z0-9_]+))\.(value|checked|innerText|innerHTML)/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      const target = match[1] || match[2];
      const prop = match[3];
      if (!['document', 'window'].includes(target)) {
        reads.push({
          target: `#${target}`,
          property: prop,
          semanticMeaning: `Read current ${prop} from #${target}`
        });
      }
    }
    return reads;
  }

  extractRichDOMWrites(body) {
    const writes = [];
    const regex = /(?:document\.(?:getElementById|querySelector(?:All)?)\(["']([^"']+)["']\)|([a-zA-Z0-9_]+))\.(style\.display|innerText|innerHTML|value|checked)\s*=\s*(["'][^"']*["']|[^;]+)/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      const target = match[1] || match[2];
      const prop = match[3];
      const val = match[4].replace(/["']/g, '').trim();
      if (!['document', 'window'].includes(target)) {
        writes.push({
          target: `#${target}`,
          mutation: `${prop} = ${val}`,
          result: prop === 'style.display' && val === 'none' ? 'Element Hidden' : (prop === 'style.display' ? 'Element Displayed' : `Property ${prop} Set`),
          semantic: `Update #${target} representation`
        });
      }
    }
    return writes;
  }

  extractDeepBusinessFlow(body, trigger) {
    const flow = [];
    flow.push(trigger);

    if (body.includes('.value') || body.includes('.checked') || body.includes('getElementById')) {
      flow.push("Read DOM State");
    }

    if (body.includes('if')) {
      flow.push("Validation / Condition Evaluation");
    }

    if (body.includes('.style.') || body.includes('.innerText') || body.includes('.innerHTML')) {
      flow.push("DOM Mutation");
    }

    if (body.includes('fetch')) {
      flow.push("Execute API Call");
    }

    if (body.includes('window.open') || body.includes('window.location')) {
      flow.push("Execute Navigation");
    }

    return flow;
  }

  inferPurpose(fnName, body) {
    if (body.includes('window.open')) return "Open Print/Navigation Window";
    if (body.includes('fetch')) return "Fetch Data From External Endpoint";
    if (body.includes('display')) return "Toggle Element Display/Visibility";
    return `Execute ${fnName} operation`;
  }
}

// Format output renderer for CLI or Module export
function generateLIRReport(sourceCode) {
  const analyzer = new Viber3Analyzer();
  const lir = analyzer.analyze(sourceCode);

  let output = `# Viber3 Lossless Intermediate Representation (LIR)\n`;
  output += `Target: ${lir.target}\n\n`;

  output += `## 1. Function Semantics & Business Flow\n`;
  lir.functionSemantics.forEach(fn => {
    output += `Function: ${fn.function}\n`;
    output += `Purpose: ${fn.purpose}\n`;
    output += `Trigger: ${fn.trigger}\n`;
    output += `Parameters: ${fn.params.join(', ') || 'None'}\n`;
    output += `Return Value: ${fn.returnValue}\n`;
    output += `API Calls: ${fn.apiCalls.join(', ')}\n`;
    output += `Navigation: ${fn.navigation.join(', ')}\n`;
    output += `Validation: ${fn.validation.join(', ')}\n`;
    output += `Side Effects: ${fn.sideEffects.join(', ')}\n`;
    output += `Dependencies: ${fn.dependencies.join(', ')}\n\n`;

    output += `DOM READ:\n`;
    fn.domReads.forEach(r => {
      output += `  - Target: ${r.target} | Property: ${r.property} | Semantic Meaning: ${r.semanticMeaning}\n`;
    });

    output += `DOM WRITE:\n`;
    fn.domWrites.forEach(w => {
      output += `  - Target: ${w.target} | Mutation: ${w.mutation} | Result: ${w.result} | Semantic: ${w.semantic}\n`;
    });

    output += `\nBusiness Flow:\n  ${fn.businessFlow.join(' ↓ ')}\n\n`;
  });
  output += `--------------------------------------------------\n\n`;

  output += `## 2. Render Dependencies\n`;
  lir.renderDependencies.forEach(rd => {
    output += `Node: ${rd.node} | Visibility Controlled By: ${rd.visibilityControlledByFunctions.join(', ')} | Observed Mutation: ${rd.observedMutation}\n`;
  });
  output += `\n--------------------------------------------------\n\n`;

  output += `## 3. List Rendering Semantics\n`;
  lir.listRenderingSemantics.forEach(lr => {
    output += `Loop Source: ${lr.loopSource} | Iterator: ${lr.iterator} | Index: ${lr.index} | Rendered Node: ${lr.renderedNode}\n`;
  });
  output += `\n--------------------------------------------------\n\n`;

  output += `## 4. Conditional Rendering\n`;
  lir.conditionalRenderingSemantics.forEach(cr => {
    output += `Condition: ${cr.condition} | Affected Node: ${cr.affectedNode} | Observed Behavior: ${cr.observedBehavior}\n`;
  });
  output += `\n--------------------------------------------------\n\n`;

  output += `## 5. Style Dependencies\n`;
  lir.styleDependencies.forEach(sd => {
    output += `Element: ${sd.element} | Trigger: ${sd.triggerCondition} | Applied Class: ${sd.appliedClass} | Removed Class: ${sd.removedClass} | Style Mutation: ${sd.inlineStyleMutation}\n`;
  });
  output += `\n--------------------------------------------------\n\n`;

  output += `## 6. Layout Dependencies\n`;
  lir.layoutDependencies.forEach(ld => {
    output += `Table Columns: ${ld.tableColumnCount} | Column Widths: ${ld.columnWidths.join(', ')} | Sticky Header: ${ld.stickyHeader} | Overflow: ${ld.overflow}\n`;
  });
  output += `\n--------------------------------------------------\n\n`;

  output += `## 7. Possible UI States\n`;
  lir.possibleUiStates.forEach(ps => {
    output += `Possible State: ${ps.possibleUiState} | Evidence: ${ps.evidence}\n`;
  });

  return output;
}

module.exports = {
  Viber3Analyzer,
  generateLIRReport
};
