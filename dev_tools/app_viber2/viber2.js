/**
 * Viber2 LIR Extension Layer (Layer 2 Parser)
 * Extends viber.js AST and LIR generation without modifying or overriding original parser logic.
 * Focuses on semantic enrichment for deterministic Go Template -> Next.js App Router (TSX) transpilation.
 */

(function () {
    // 1. Guard check for viber.js
    if (typeof window.buildLIR !== 'function') {
        console.error("viber2.js loaded before viber.js or buildLIR is missing.");
        return;
    }

    // Preserve original buildLIR from viber.js (Layer 1)
    const baseBuildLIR = window.buildLIR;
    const baseBuildAST = window.buildAST;

    // Helper: Hex color ID sanitizer to prevent outputting color literals as DOM IDs
    function sanitizeCSSId(id) {
        if (!id) return null;
        const clean = id.replace(/^#/, '');
        if (/^[0-9a-fA-F]{3,8}$/.test(clean)) {
            return null; // Ignore invalid hex color IDs
        }
        return `#${clean}`;
    }

    // 2. Extend AST Builder without modifying base function
    window.buildAST = function (path, file, content) {
        const ast = baseBuildAST ? baseBuildAST(path, file, content) : {};
        
        // Enrich AST with Layer 2 Deep Parsers (Existing)
        ast.routes = parseRoutes(content);
        ast.dataBinding = parseDataBinding(content);
        ast.contextScope = parseContextScope(content, ast.dataBinding);
        ast.layout = parseLayout(content);
        ast.components = parseComponentCandidates(content);
        ast.state = parseState(content);
        ast.domMutations = parseDOMMutations(content);
        ast.eventFlow = parseEventFlow(content);
        ast.apiFlow = parseAPIFlow(content);
        ast.formsAdvanced = parseFormsAdvanced(content);
        ast.auth = parseAuthentication(content);
        ast.conditionalRendering = parseConditionalRendering(content);
        ast.loopSemantics = parseLoopSemantics(content);
        ast.tableSemantics = parseTableSemantics(content);
        ast.navigation = parseNavigation(content);
        ast.dependencySemantics = parseDependencySemantics(content, ast.dependencies);
        ast.ssrInfo = parseSSR(content, ast.projectInfo);
        ast.nextMigration = parseNextMigrationHints(ast.fileInfo, content);
        ast.htmlSemantics = parseHTMLSemantics(content);
        ast.callGraph = parseJSCallGraph(content);
        ast.variableAnalysis = parseVariableReadWrite(content);
        ast.browserAPIDetails = parseBrowserAPIDetails(content);
        ast.goTemplateSemantics = parseGoTemplateSemantics(content);
        ast.uiActions = parseUIActions(content, ast.eventFlow);
        ast.dataFlowGraph = parseDataFlowGraph(ast);
        ast.filePurpose = parseFilePurpose(ast);
        ast.migrationMetadata = parseMigrationMetadata(ast);

        // Enrich AST with Layer 2 Advanced Semantic Parsers (Updated & Expanded)
        ast.functionSemantics = parseFunctionSemantics(content);
        ast.domReadWriteMap = parseDOMReadWriteMap(content, ast.functionSemantics);
        ast.selectorSemantics = parseSelectorSemantics(content);
        ast.stateDependencyGraph = parseStateDependencyGraph(content, ast.functionSemantics);
        ast.inlineStyleMutations = parseInlineStyleMutations(content);
        ast.fetchFlowDetails = parseFetchFlowDetails(content);
        ast.browserAPISemantics = parseBrowserAPISemantics(content);
        ast.templateCollectionStructure = parseTemplateCollectionStructure(content);
        ast.templateAliasResolution = parseTemplateAliasResolution(content);
        ast.variableScopeAnalysis = parseVariableScopeAnalysis(content);
        ast.jsDependencyGraph = parseJSDependencyGraph(content, ast.functionSemantics);
        ast.exactDOMAnchors = parseExactDOMAnchors(content);
        ast.uiOwnershipAnalysis = parseUIOwnershipAnalysis(content);
        ast.reactMigrationMetadata = parseReactMigrationMetadata(content);
        ast.externalDependencyUsage = parseExternalDependencyUsage(content);
        ast.scriptBlockSemantics = parseScriptBlockSemantics(content);
        ast.dynamicAttributes = parseDynamicAttributes(content);
        ast.eventParameters = parseEventParameters(content);

        return ast;
    };

    // 3. Extend LIR Generator by wrapping baseBuildLIR
    window.buildLIR = function (ast) {
        // Execute Layer 1 LIR
        let lir = baseBuildLIR(ast);

        // Filter out Noise / Low-value counters from base LIR output string
        lir = lir.replace(/^.*(?:CSS Selectors Count|Table Elements Count|Form Elements Count|Media Assets Count|Script Blocks Count):.*$/gm, '');

        // Append Layer 2 Extended LIR
        lir += `\n\n=========================================\n`;
        lir += `=== LAYER 2: EXTENDED SEMANTIC ANALYSIS ===\n`;
        lir += `=========================================\n\n`;

        lir += `## 10. DETECTED ROUTES\n`;
        lir += renderList(ast.routes, 'Routes');

        lir += `\n## 11. DATA BINDING & HIERARCHY\n`;
        lir += renderList(ast.dataBinding.fields, 'Fields');
        lir += ` * Object Tree: ${ast.dataBinding.tree.length > 0 ? ast.dataBinding.tree.join(', ') : 'None'}\n`;

        lir += `\n## 12. CONTEXT SCOPE\n`;
        lir += ` * Scope Root: ${ast.contextScope.root}\n`;
        lir += renderList(ast.contextScope.variables, 'Context Members');

        lir += `\n## 13. LAYOUT STRUCTURE\n`;
        lir += ` * Structural Hints: ${ast.layout.length > 0 ? ast.layout.join(', ') : 'None'}\n`;

        lir += `\n## 14. COMPONENT CANDIDATES\n`;
        lir += renderList(ast.components, 'Candidates');

        lir += `\n## 15. STATE VARIABLES & MUTATION\n`;
        if (ast.state.length > 0) {
            ast.state.forEach(s => {
                lir += ` * [State] ${s.name} (Access: ${s.access}, Scope: ${s.scope})\n`;
            });
        } else {
            lir += ` * State: None\n`;
        }

        lir += `\n## 16. DOM MUTATIONS\n`;
        lir += renderList(ast.domMutations, 'Mutations');

        lir += `\n## 17. EVENT FLOW & PARAMETER ANALYSIS\n`;
        if (ast.eventParameters && ast.eventParameters.length > 0) {
            ast.eventParameters.forEach(ep => {
                lir += ` * Event: ${ep.event} -> Target: ${ep.target} | Parameter: ${ep.parameter} | Type: ${ep.resolvedType}${ep.templateSource ? ` (From Variable: ${ep.templateSource})` : ''}\n`;
            });
        } else {
            lir += renderList(ast.eventFlow, 'Flows');
        }

        lir += `\n## 18. ADVANCED API FLOW & CONTRACTS\n`;
        if (ast.fetchFlowDetails && ast.fetchFlowDetails.length > 0) {
            ast.fetchFlowDetails.forEach(ff => {
                lir += ` * Method: ${ff.method} | URL: ${ff.url}\n`;
                lir += `   Detected Parameters: ${ff.parameters.length > 0 ? ff.parameters.join(', ') : 'None'}\n`;
                lir += `   Return Type: ${ff.returnType}\n`;
                lir += `   Response Usage: ${ff.responseType}\n`;
            });
        } else {
            lir += renderList(ast.apiFlow, 'API Calls');
        }

        lir += `\n## 19. ADVANCED FORMS\n`;
        if (ast.formsAdvanced.length > 0) {
            ast.formsAdvanced.forEach(f => {
                lir += ` * [Form] Action: ${f.action}, Method: ${f.method}, Enctype: ${f.enctype}\n`;
            });
        } else {
            lir += ` * Forms: None\n`;
        }

        lir += `\n## 20. AUTHENTICATION & AUTHORIZATION\n`;
        lir += renderList(ast.auth, 'Tokens/Roles');

        lir += `\n## 21. CONDITIONAL RENDERING\n`;
        lir += renderList(ast.conditionalRendering, 'Render Rules');

        lir += `\n## 22. LOOP SEMANTICS\n`;
        lir += renderList(ast.loopSemantics, 'Loops');

        lir += `\n## 23. TABLE SEMANTICS\n`;
        lir += ` * Columns: ${ast.tableSemantics.columns.length > 0 ? ast.tableSemantics.columns.join(', ') : 'None'}\n`;
        lir += ` * Has Actions: ${ast.tableSemantics.hasActions}\n`;
        lir += ` * Has Status Column: ${ast.tableSemantics.hasStatus}\n`;

        lir += `\n## 24. NAVIGATION STRUCTURE\n`;
        lir += renderList(ast.navigation, 'Navigation Elements');

        lir += `\n## 25. DEPENDENCY SEMANTICS & USAGE\n`;
        lir += renderList(ast.dependencySemantics, 'Inferred Usages');

        lir += `\n## 26. SSR & HYDRATION PROFILE\n`;
        lir += ` * Mode: ${ast.ssrInfo.mode}\n`;
        lir += ` * Hydration Needed: ${ast.ssrInfo.hydrationNeeded}\n`;
        lir += ` * Client JS Required: ${ast.ssrInfo.clientJSRequired}\n`;

        lir += `\n## 27. NEXT.JS MIGRATION HINTS & JSX HELPERS\n`;
        lir += ` * Suggested Route File: ${ast.nextMigration.suggestedRoute}\n`;
        lir += ` * Suggested Layout File: ${ast.nextMigration.suggestedLayout}\n`;
        lir += ` * Component Mode: ${ast.nextMigration.componentType}\n`;
        if (ast.reactMigrationMetadata && ast.reactMigrationMetadata.length > 0) {
            ast.reactMigrationMetadata.forEach(rm => {
                lir += ` * Detected ${rm.label}: ${rm.value}\n`;
            });
        }

        lir += `\n## 28. HTML SEMANTIC SECTIONS & DYNAMIC ATTRIBUTES\n`;
        lir += renderList(ast.htmlSemantics, 'UI Sections');
        if (ast.dynamicAttributes && ast.dynamicAttributes.length > 0) {
            ast.dynamicAttributes.forEach(da => {
                lir += ` * Attribute: ${da.attribute}="${da.value}" | Type: ${da.type}\n`;
            });
        }

        lir += `\n## 29. JAVASCRIPT CALL GRAPH & DEPENDENCIES\n`;
        lir += renderList(ast.callGraph, 'Calls');

        lir += `\n## 30. VARIABLE READ / WRITE ANALYSIS\n`;
        if (ast.variableAnalysis.length > 0) {
            ast.variableAnalysis.forEach(v => {
                lir += ` * Var: ${v.name} | Read: ${v.read} | Written: ${v.written}\n`;
            });
        } else {
            lir += ` * Variables: None\n`;
        }

        lir += `\n## 31. BROWSER API USAGE DETAILS\n`;
        lir += renderList(ast.browserAPIDetails, 'Browser Calls');

        lir += `\n## 32. GO TEMPLATE ADVANCED SEMANTICS\n`;
        lir += renderList(ast.goTemplateSemantics, 'Semantics');

        lir += `\n## 33. USER ACTION FLOWS\n`;
        lir += renderList(ast.uiActions, 'Actions');

        lir += `\n## 34. DATA FLOW GRAPH\n`;
        lir += ` ${ast.dataFlowGraph}\n`;

        lir += `\n## 35. FILE PURPOSE ANALYZER\n`;
        lir += ` * Primary Responsibility: ${ast.filePurpose.primary}\n`;
        lir += ` * Business Purpose: ${ast.filePurpose.business}\n`;

        lir += `\n## 36. MIGRATION METADATA (DETERMINISTIC)\n`;
        lir += ` * Suggested Target Route: ${ast.migrationMetadata.suggestedTargetRoute}\n`;
        lir += ` * Required Props: ${ast.migrationMetadata.requiredProps.join(', ') || 'None'}\n`;
        lir += ` * Required Client State: ${ast.migrationMetadata.requiredClientState.join(', ') || 'None'}\n`;
        lir += ` * Required API Calls: ${ast.migrationMetadata.requiredAPICalls.join(', ') || 'None'}\n`;

        // ==========================================
        // LAYER 2 ADVANCED SEMANTIC ANALYSIS SECTIONS
        // ==========================================

        lir += `\n\n=========================================\n`;
        lir += `=== ADVANCED SEMANTIC ANALYZER LAYER ===\n`;
        lir += `=========================================\n\n`;

        lir += `## 37. FUNCTION SEMANTIC ANALYSIS & BUSINESS FLOWS\n`;
        if (ast.functionSemantics.length > 0) {
            ast.functionSemantics.forEach(f => {
                lir += `Function:\n${f.name}()\n\n`;
                lir += `Purpose:\n${f.purpose.map(p => `- ${p}`).join('\n')}\n\n`;
                if (f.businessFlow && f.businessFlow.length > 0) {
                    lir += `Business Flow:\n${f.businessFlow.join(' ↓ ')}\n\n`;
                }
                lir += `Reads:\n${f.reads.join('\n') || 'None'}\n\n`;
                lir += `Writes:\n${f.writes.join('\n') || 'None'}\n\n`;
                lir += `DOM Reads:\n${f.domReads.join('\n') || 'None'}\n\n`;
                lir += `DOM Writes:\n${f.domWrites.join('\n') || 'None'}\n\n`;
                lir += `Mutates:\n${f.mutates.join('\n') || 'None'}\n\n`;
                lir += `Calls:\n${f.calls.join('\n') || 'None'}\n\n`;
                lir += `Returns:\n${f.returns}\n\n---\n`;
            });
        } else {
            lir += ` * Functions: None\n`;
        }

        lir += `\n## 38. DOM READ / WRITE MAPPING\n`;
        if (ast.domReadWriteMap.length > 0) {
            ast.domReadWriteMap.forEach(d => {
                lir += `Function:\n${d.functionName}()\n\n`;
                lir += `Reads\n${d.reads.join('\n') || 'None'}\n\n`;
                lir += `Writes\n${d.writes.join('\n') || 'None'}\n\n`;
                lir += `---\n`;
            });
        } else {
            lir += ` * DOM Read/Write Maps: None\n`;
        }

        lir += `\n## 39. SELECTOR SEMANTIC MAP\n`;
        if (ast.selectorSemantics.length > 0) {
            ast.selectorSemantics.forEach(s => {
                lir += `Selector\n${s.selector}\n\n`;
                lir += `Purpose\n${s.purpose}\n\n`;
                lir += `Referenced By Function\n${s.referencedBy.join('\n') || 'Global Scope'}\n\n---\n`;
            });
        } else {
            lir += ` * Selectors: None\n`;
        }

        lir += `\n## 40. STATE DEPENDENCY GRAPH\n`;
        if (ast.stateDependencyGraph.length > 0) {
            ast.stateDependencyGraph.forEach(sd => {
                lir += `Variable:\n${sd.variable}\n\n`;
                lir += `Scope\n${sd.scope}\n\n`;
                lir += `Local / Global\n${sd.isGlobal ? 'Global' : 'Local'}\n\n`;
                lir += `Read By\n${sd.readBy.join('\n') || 'None'}\n\n`;
                lir += `Written By\n${sd.writtenBy.join('\n') || 'None'}\n\n`;
                lir += `Depends On\n${sd.dependsOn.join('\n') || 'None'}\n\n`;
                lir += `Updates DOM\n${sd.updatesDOM.join('\n') || 'None'}\n\n---\n`;
            });
        } else {
            lir += ` * State Dependencies: None\n`;
        }

        lir += `\n## 41. INLINE STYLE & CLASS MUTATIONS\n`;
        if (ast.inlineStyleMutations.length > 0) {
            ast.inlineStyleMutations.forEach(m => {
                lir += `Function: ${m.functionName}\n`;
                lir += `Target Element: ${m.targetElement}\n`;
                lir += `Mutation: ${m.mutation}\n`;
                lir += `Purpose: ${m.purpose}\n\n`;
            });
        } else {
            lir += ` * Inline Style Mutations: None\n`;
        }

        lir += `\n## 42. FETCH FLOW DETAILS\n`;
        if (ast.fetchFlowDetails.length > 0) {
            ast.fetchFlowDetails.forEach(ff => {
                lir += `Method:\n${ff.method}\n\n`;
                lir += `URL:\n${ff.url}\n\n`;
                lir += `Detected Parameters:\n${ff.parameters.join(', ') || 'None'}\n\n`;
                lir += `Headers:\n${ff.headers.join(', ') || 'None'}\n\n`;
                lir += `Body:\n${ff.body}\n\n`;
                lir += `Consumer Function:\n${ff.consumerFunction}\n\n`;
                lir += `Return Type:\n${ff.returnType}\n\n`;
                lir += `Response Usage:\n${ff.responseType}\n\n`;
                lir += `DOM Target:\n${ff.domTarget.join('\n') || 'None'}\n\n`;
                lir += `Error Flow:\n${ff.errorFlow}\n\n---\n`;
            });
        } else {
            lir += ` * Fetch Flows: None\n`;
        }

        lir += `\n## 43. BROWSER API SEMANTICS\n`;
        if (ast.browserAPISemantics.length > 0) {
            ast.browserAPISemantics.forEach(ba => {
                lir += `API: ${ba.api}\n`;
                lir += `Purpose: ${ba.purpose}\n`;
                lir += `Parameters: ${ba.parameters}\n`;
                lir += `Caller Function: ${ba.callerFunction}\n\n`;
            });
        } else {
            lir += ` * Browser API Usages: None\n`;
        }

        lir += `\n## 44. TEMPLATE COLLECTION STRUCTURE\n`;
        if (ast.templateCollectionStructure.length > 0) {
            ast.templateCollectionStructure.forEach(tc => {
                lir += `Collection:\n${tc.collection}\n\n`;
                lir += `Item:\n${tc.item}\n\n`;
                lir += `Fields:\n${tc.fields.join('\n') || 'None'}\n\n---\n`;
            });
        } else {
            lir += ` * Template Collections: None\n`;
        }

        lir += `\n## 45. TEMPLATE ALIAS RESOLUTION\n`;
        if (ast.templateAliasResolution.length > 0) {
            ast.templateAliasResolution.forEach(ta => {
                lir += `Alias:\n${ta.alias}\n\n`;
                lir += `Expression:\n${ta.expression}\n\n---\n`;
            });
        } else {
            lir += ` * Template Aliases: None\n`;
        }

        lir += `\n## 47. FULL JS DEPENDENCY & CALL GRAPH\n`;
        lir += renderList(ast.jsDependencyGraph, 'Dependency');

        lir += `\n## 48. EXACT DOM ANCHORS\n`;
        lir += renderList(ast.exactDOMAnchors, 'Anchors');

        lir += `\n## 49. UI OWNERSHIP ANALYSIS\n`;
        if (ast.uiOwnershipAnalysis.length > 0) {
            ast.uiOwnershipAnalysis.forEach(ui => {
                lir += `${ui.component}\ncontains\n${ui.contains.join('\n')}\n\n`;
            });
        } else {
            lir += ` * UI Components: None\n`;
        }

        lir += `\n## 51. EXTERNAL DEPENDENCY USAGE\n`;
        if (ast.externalDependencyUsage.length > 0) {
            ast.externalDependencyUsage.forEach(ed => {
                lir += `Dependency: ${ed.dependency}\n`;
                lir += `Purpose: ${ed.purpose}\n`;
                lir += `Imported By: ${ed.importedBy}\n`;
                lir += `Migration Hint: ${ed.migrationHint}\n\n`;
            });
        } else {
            lir += ` * External Dependencies: None\n`;
        }

        lir += `\n## 52. SCRIPT BLOCK SEMANTICS\n`;
        if (ast.scriptBlockSemantics.length > 0) {
            ast.scriptBlockSemantics.forEach((sb, idx) => {
                lir += `Script Block #${idx + 1}\n`;
                lir += `Functions: ${sb.functions.join(', ') || 'None'}\n`;
                lir += `Global Variables: ${sb.globalVariables.join(', ') || 'None'}\n`;
                lir += `Constants: ${sb.constants.join(', ') || 'None'}\n`;
                lir += `Fetch Calls: ${sb.fetchCalls.join(', ') || 'None'}\n`;
                lir += `DOM Ready Events: ${sb.domReadyEvents.join(', ') || 'None'}\n`;
                lir += `Exported Symbols: ${sb.exportedSymbols.join(', ') || 'None'}\n`;
                lir += `Window Globals: ${sb.windowGlobals.join(', ') || 'None'}\n\n`;
            });
        } else {
            lir += ` * Script Blocks: None\n`;
        }

        return lir;
    };

    // Helper Renderer
    function renderList(arr, label) {
        if (!arr || arr.length === 0) return ` * ${label}: None\n`;
        return arr.map(item => ` * [${label}] ${typeof item === 'object' ? JSON.stringify(item) : item}\n`).join('');
    }

    // ==========================================
    // LAYER 2 PARSER IMPLEMENTATIONS
    // ==========================================

    function parseRoutes(content) {
        const routes = new Set();
        const hrefRegex = /(?:href|action)\s*=\s*["']([^"']+)["']/g;
        const fetchRegex = /(?:fetch|axios(?:\.(?:get|post|put|delete))?)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
        const locationRegex = /(?:location\.href|history\.pushState)\s*=\s*[`'"]([^`'"]+)[`'"]/g;

        let match;
        while ((match = hrefRegex.exec(content)) !== null) if (!match[1].startsWith('#')) routes.add(`NAV -> ${match[1]}`);
        while ((match = fetchRegex.exec(content)) !== null) routes.add(`API -> ${match[1]}`);
        while ((match = locationRegex.exec(content)) !== null) routes.add(`CLIENT NAV -> ${match[1]}`);

        return Array.from(routes);
    }

    function parseDataBinding(content) {
        const bindings = new Set();
        const tree = new Set();
        const goTagRegex = /\{\{\s*([\s\S]*?)\s*\}\}/g;

        let match;
        while ((match = goTagRegex.exec(content)) !== null) {
            const tag = match[1].trim();
            const vars = tag.match(/\.([a-zA-Z0-9_.]+)/g);
            if (vars) {
                vars.forEach(v => {
                    bindings.add(v);
                    const parts = v.split('.');
                    if (parts.length > 2) tree.add(parts.slice(0, 2).join('.'));
                });
            }
        }
        return { fields: Array.from(bindings), tree: Array.from(tree) };
    }

    function parseContextScope(content, dataBinding) {
        const root = content.includes('.UserRole') || content.includes('.UserName') ? 'Page/Session Context' : 'Component Context';
        return { root, variables: dataBinding.fields };
    }

    function parseLayout(content) {
        const layoutHints = [];
        if (content.includes('sidebar') || content.includes('nav')) layoutHints.push('Sidebar Container');
        if (content.includes('header')) layoutHints.push('Header Topbar');
        if (content.includes('footer')) layoutHints.push('Footer Section');
        if (content.includes('modal') || content.includes('dialog')) layoutHints.push('Modal Overlay');
        return layoutHints;
    }

    function parseComponentCandidates(content) {
        const candidates = [];
        if (/<table[\s\S]*?<\/table>/i.test(content)) candidates.push('Table Component');
        if (/<form[\s\S]*?<\/form>/i.test(content)) candidates.push('Form Component');
        if (content.includes('card') || content.includes('box')) candidates.push('Card / Box Widget');
        if (content.includes('sidebar')) candidates.push('Sidebar Nav');
        return candidates;
    }

    function parseState(content) {
        const states = [];
        const varRegex = /(?:let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(.*?);/g;
        let match;
        while ((match = varRegex.exec(content)) !== null) {
            const name = match[1];
            const isWritten = content.includes(`${name} =`) || content.includes(`${name}++`);
            states.push({
                name,
                access: isWritten ? 'Read/Write' : 'Read-Only',
                scope: 'Local JS'
            });
        }
        return states;
    }

    function parseDOMMutations(content) {
        const mutations = [];
        const props = ['innerHTML', 'innerText', 'textContent', 'appendChild', 'removeChild', 'classList', 'style', 'value', 'checked'];
        props.forEach(p => {
            if (content.includes(`.${p}`)) mutations.push(`DOM Mutation: .${p}`);
        });
        return mutations;
    }

    function parseEventFlow(content) {
        const flows = [];
        const eventRegex = /on([a-z]+)\s*=\s*["']([^"']+)["']/gi;
        let match;
        while ((match = eventRegex.exec(content)) !== null) {
            flows.push(`Event: on${match[1]} -> Trigger Handler: ${match[2]}`);
        }
        return flows;
    }

    function parseAPIFlow(content) {
        const apiFlows = [];
        if (content.includes('fetch(')) apiFlows.push('Fetch API Flow Detected');
        if (content.includes('axios')) apiFlows.push('Axios HTTP Flow Detected');
        if (content.includes('FormData')) apiFlows.push('Multipart FormData Payload');
        if (content.includes('response.json()')) apiFlows.push('JSON Response Parsing');
        return apiFlows;
    }

    function parseFormsAdvanced(content) {
        const forms = [];
        const formRegex = /<form([^>]*)>/gi;
        let match;
        while ((match = formRegex.exec(content)) !== null) {
            const attrs = match[1];
            const action = (attrs.match(/action=["']([^"']+)["']/) || [])[1] || 'Self';
            const method = (attrs.match(/method=["']([^"']+)["']/) || [])[1] || 'GET';
            const enctype = (attrs.match(/enctype=["']([^"']+)["']/) || [])[1] || 'application/x-www-form-urlencoded';
            forms.push({ action, method, enctype });
        }
        return forms;
    }

    function parseAuthentication(content) {
        const tokens = [];
        if (content.includes('UserRole')) tokens.push('UserRole Checks');
        if (content.includes('Bearer')) tokens.push('Bearer Token Usage');
        if (content.includes('logout') || content.includes('/logout')) tokens.push('Logout Route/Action');
        return tokens;
    }

    function parseConditionalRendering(content) {
        const conditions = [];
        const ifRegex = /\{\{\s*if\s+([\s\S]*?)\s*\}\}/g;
        let match;
        while ((match = ifRegex.exec(content)) !== null) {
            conditions.push(`Render Condition: ${match[1].trim()}`);
        }
        return conditions;
    }

    function parseLoopSemantics(content) {
        const loops = [];
        const rangeRegex = /\{\{\s*range\s+([\s\S]*?)\s*\}\}/g;
        let match;
        while ((match = rangeRegex.exec(content)) !== null) {
            loops.push(`Loop Collection Target: ${match[1].trim()}`);
        }
        return loops;
    }

    function parseTableSemantics(content) {
        const columns = [];
        const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let match;
        while ((match = thRegex.exec(content)) !== null) {
            const cleanText = match[1].replace(/<[^>]+>/g, '').trim();
            if (cleanText) columns.push(cleanText);
        }
        return {
            columns,
            hasActions: columns.some(c => /aksi|action/i.test(c)),
            hasStatus: columns.some(c => /status/i.test(c))
        };
    }

    function parseNavigation(content) {
        const navs = [];
        const navItemRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = navItemRegex.exec(content)) !== null) {
            const label = match[2].replace(/<[^>]+>/g, '').trim();
            if (label) navs.push(`Nav Item: "${label}" -> Target: ${match[1]}`);
        }
        return navs;
    }

    function parseDependencySemantics(content, baseDeps) {
        const usages = [];
        if (baseDeps && baseDeps.includes('Tailwind CSS')) usages.push('Tailwind Utility Styling System');
        if (baseDeps && baseDeps.includes('FontAwesome')) usages.push('FontAwesome Icon Rendering System');
        return usages;
    }

    function parseSSR(content, projectInfo) {
        const isClientJS = content.includes('<script') || content.includes('addEventListener');
        const isTemplate = projectInfo && projectInfo.templateEngine !== 'None';
        return {
            mode: isTemplate && isClientJS ? 'Hybrid (SSR Template + Client JS)' : isTemplate ? 'SSR Only' : 'CSR Only',
            hydrationNeeded: isTemplate && isClientJS,
            clientJSRequired: isClientJS
        };
    }

    function parseNextMigrationHints(fileInfo, content) {
        const isClient = content.includes('document.') || content.includes('window.') || content.includes('addEventListener');
        const fileName = (fileInfo && fileInfo.name) ? fileInfo.name : 'index';
        return {
            suggestedRoute: `app/${fileName.replace(/\.[^/.]+$/, '')}/page.tsx`,
            suggestedLayout: `app/layout.tsx`,
            componentType: isClient ? "'use client' Client Component" : 'Server Component'
        };
    }

    function parseHTMLSemantics(content) {
        const sections = [];
        if (content.includes('search') || content.includes('filter')) sections.push('Search/Filter Bar');
        if (content.includes('<table')) sections.push('Data Table View');
        if (content.includes('sidebar')) sections.push('Sidebar Navigation');
        return sections;
    }

    function parseJSCallGraph(content) {
        const graph = [];
        const fnCallRegex = /function\s+([a-zA-Z0-9_$]+)[\s\S]*?\{([\s\S]*?)\}/g;
        let match;
        while ((match = fnCallRegex.exec(content)) !== null) {
            const caller = match[1];
            const body = match[2];
            const subCalls = body.match(/([a-zA-Z0-9_$]+)\s*\(/g);
            if (subCalls) {
                const callees = subCalls.map(c => c.replace('(', '').trim()).filter(c => c !== caller && c !== 'if' && c !== 'for');
                if (callees.length > 0) graph.push(`${caller}() -> Calls: [${Array.from(new Set(callees)).join(', ')}]`);
            }
        }
        return graph;
    }

    function parseVariableReadWrite(content) {
        const vars = [];
        const varRegex = /(?:let|var|const)\s+([a-zA-Z0-9_$]+)/g;
        let match;
        while ((match = varRegex.exec(content)) !== null) {
            const v = match[1];
            const readCount = content.split(v).length - 1;
            const written = content.includes(`${v} =`) || content.includes(`${v}++`);
            vars.push({ name: v, read: readCount > 1, written });
        }
        return vars;
    }

    function parseBrowserAPIDetails(content) {
        const apis = [];
        if (content.includes('localStorage')) apis.push('localStorage (Client Persistence)');
        if (content.includes('navigator.clipboard')) apis.push('Clipboard API (Copy Data)');
        if (content.includes('window.open')) apis.push('window.open (New Window/Tab Print/Export)');
        return apis;
    }

    function parseGoTemplateSemantics(content) {
        const semantics = [];
        if (content.includes('range')) semantics.push('Collection Iteration Pipeline');
        if (content.includes('|')) semantics.push('Data Pipeline / Formatter');
        if (content.includes('.UserRole')) semantics.push('Role-Based Access Control Scope');
        return semantics;
    }

    function parseUIActions(content, eventFlow) {
        const actions = [];
        if (eventFlow) {
            eventFlow.forEach(e => {
                actions.push(`User Interaction -> ${e}`);
            });
        }
        return actions;
    }

    function parseDataFlowGraph(ast) {
        const engine = (ast.projectInfo && ast.projectInfo.templateEngine) ? ast.projectInfo.templateEngine : 'Go Template';
        return `Server Context (${engine}) -> HTML View -> Client JS Events -> DOM Mutations / API Endpoint Call`;
    }

    function parseFilePurpose(ast) {
        const isFrontend = ast.projectInfo ? ast.projectInfo.isFrontend : true;
        const fileName = ast.fileInfo ? ast.fileInfo.name : 'file';
        return {
            primary: isFrontend ? 'User Interface Rendering' : 'Data Processing',
            business: `Handling UI/Data logic for ${fileName}`
        };
    }

    function parseMigrationMetadata(ast) {
        return {
            suggestedTargetRoute: ast.nextMigration ? ast.nextMigration.suggestedRoute : 'app/page.tsx',
            requiredProps: ast.dataBinding ? ast.dataBinding.fields.slice(0, 5) : [],
            requiredClientState: ast.state ? ast.state.map(s => s.name) : [],
            requiredAPICalls: ast.routes ? ast.routes.filter(r => r.startsWith('API')) : []
        };
    }

    // ==========================================
    // ENHANCED / NEW DETERMINISTIC PARSER EXTENSIONS
    // ==========================================

    function parseFunctionSemantics(content) {
        const functions = [];
        const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g;
        let match;

        while ((match = fnRegex.exec(content)) !== null) {
            const name = match[1];
            const params = match[2].trim();
            const body = match[3];

            const reads = [];
            const writes = [];
            const domReads = [];
            const domWrites = [];
            const mutates = [];
            const calls = [];
            const purpose = [];
            const businessFlow = [];

            // Detect DOM Reads
            const domReadRegex = /(?:document\.|window\.)?(?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)(?:\.([a-zA-Z0-9_$]+))?/g;
            let dMatch;
            while ((dMatch = domReadRegex.exec(body)) !== null) {
                let target = dMatch[1];
                if (target.startsWith('#')) {
                    const cleanId = sanitizeCSSId(target);
                    if (!cleanId) continue;
                    target = cleanId;
                }
                const prop = dMatch[2] ? `.${dMatch[2]}` : '';
                domReads.push(`${target}${prop}`);
            }

            // Detect DOM Writes
            const domWriteRegex = /([#\.][a-zA-Z0-9_-]+)\.(innerText|textContent|innerHTML|value|checked|style\.[a-zA-Z0-9_$]+|classList\.(?:add|remove|toggle))\s*=/g;
            let wMatch;
            while ((wMatch = domWriteRegex.exec(body)) !== null) {
                let target = wMatch[1];
                if (target.startsWith('#')) {
                    const cleanId = sanitizeCSSId(target);
                    if (!cleanId) continue;
                    target = cleanId;
                }
                domWrites.push(`${target}.${wMatch[2]}`);
            }

            // Detect Function Calls
            const callMatches = body.match(/([a-zA-Z0-9_$]+)\s*\(/g);
            if (callMatches) {
                callMatches.forEach(c => {
                    const cName = c.replace('(', '').trim();
                    if (cName !== name && !['if', 'for', 'while', 'switch', 'catch', 'console'].includes(cName)) {
                        calls.push(cName);
                    }
                });
            }

            // Detect Purpose & Business Flow steps deterministically from AST nodes
            if (body.includes('.value') || body.includes('value')) purpose.push('Reads search keyword or form inputs');
            if (body.includes('for') || body.includes('forEach')) {
                purpose.push('Iterates every table row or item list');
                businessFlow.push('Iterate items');
            }
            if (body.includes('toLowerCase') || body.includes('includes')) {
                purpose.push('Performs case-insensitive matching');
                businessFlow.push('Evaluate conditions');
            }
            if (body.includes('style.display = "none"') || body.includes("style.display = 'none'")) {
                purpose.push('Hides unmatched rows');
                businessFlow.push('Hide unmatched rows');
            }
            if (body.includes('style.display = ""') || body.includes('style.display = "block"')) {
                purpose.push('Shows matched rows');
                businessFlow.push('Show matched rows');
            }
            if (body.includes('fetch') || body.includes('axios')) {
                purpose.push('Executes remote API communication');
                businessFlow.push('Send API Request');
            }
            if (body.includes('window.open')) {
                purpose.push('Opens target URL in external window/tab');
                businessFlow.push('Open window');
            }

            if (purpose.length === 0) {
                purpose.push(`Executes deterministic logic for ${name}`);
            }

            // Return type
            const returnMatch = body.match(/return\s+(.*?);/);
            const returns = returnMatch ? returnMatch[1].trim() : 'void';

            functions.push({
                name,
                purpose,
                businessFlow,
                reads: Array.from(new Set(reads)),
                writes: Array.from(new Set(writes)),
                domReads: Array.from(new Set(domReads)),
                domWrites: Array.from(new Set(domWrites)),
                mutates: Array.from(new Set(mutates)),
                calls: Array.from(new Set(calls)),
                returns
            });
        }
        return functions;
    }

    function parseDOMReadWriteMap(content, functionSemantics) {
        return functionSemantics.map(f => ({
            functionName: f.name,
            reads: f.domReads,
            writes: f.domWrites
        }));
    }

    function parseSelectorSemantics(content) {
        const selectors = [];
        const selectorRegex = /(?:document\.|window\.)?(?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        let match;
        const seen = new Set();

        while ((match = selectorRegex.exec(content)) !== null) {
            let selector = match[1];
            if (selector.startsWith('#')) {
                const cleanId = sanitizeCSSId(selector);
                if (!cleanId) continue;
                selector = cleanId;
            }

            if (!seen.has(selector)) {
                seen.add(selector);

                const referencedBy = [];
                const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
                let fnMatch;
                while ((fnMatch = fnRegex.exec(content)) !== null) {
                    if (fnMatch[2].includes(selector)) {
                        referencedBy.push(fnMatch[1]);
                    }
                }

                let purpose = 'DOM Element Reference';
                if (selector.includes('Search') || selector.includes('filter')) purpose = 'Search/Filter Input Target';
                else if (selector.includes('Check') || selector.includes('select')) purpose = 'Checkbox / Selection Target';
                else if (selector.includes('Table') || selector.includes('tr')) purpose = 'Data Table Row / Container';
                else if (selector.includes('btn') || selector.includes('Btn')) purpose = 'Interactive Button Trigger';

                selectors.push({ selector, purpose, referencedBy });
            }
        }
        return selectors;
    }

    function parseStateDependencyGraph(content, functionSemantics) {
        const stateGraph = [];
        const varRegex = /(?:let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(.*?);/g;
        let match;

        while ((match = varRegex.exec(content)) !== null) {
            const variable = match[1];
            const initVal = match[2];

            const readBy = [];
            const writtenBy = [];
            const dependsOn = [];
            const updatesDOM = [];

            functionSemantics.forEach(f => {
                if (f.domReads.some(r => r.includes(variable)) || f.reads.includes(variable)) readBy.push(f.name);
                if (f.writes.includes(variable) || f.domWrites.some(w => w.includes(variable))) writtenBy.push(f.name);
                if (f.domWrites.length > 0) updatesDOM.push(...f.domWrites);
            });

            if (initVal.includes('document.') || initVal.includes('.checked') || initVal.includes('.value')) {
                dependsOn.push(initVal.trim());
            }

            stateGraph.push({
                variable,
                scope: 'Function / Local Scope',
                isGlobal: !content.includes(`function`) || content.indexOf(`var ${variable}`) < content.indexOf(`function`),
                readBy: Array.from(new Set(readBy)),
                writtenBy: Array.from(new Set(writtenBy)),
                dependsOn: Array.from(new Set(dependsOn)),
                updatesDOM: Array.from(new Set(updatesDOM))
            });
        }
        return stateGraph;
    }

    function parseInlineStyleMutations(content) {
        const mutations = [];
        const regex = /([#\.][a-zA-Z0-9_-]+)\.(style\.(?:display|visibility|color|background|width|height)|classList\.(?:add|remove|toggle))\s*=\s*['"`]?([^'"`;]+)['"`]?/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            let targetElement = match[1];
            if (targetElement.startsWith('#')) {
                const cleanId = sanitizeCSSId(targetElement);
                if (!cleanId) continue;
                targetElement = cleanId;
            }

            const mutation = `${match[2]} = ${match[3]}`;

            let functionName = 'Global Scope';
            const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
            let fnMatch;
            while ((fnMatch = fnRegex.exec(content)) !== null) {
                if (fnMatch[2].includes(match[0])) {
                    functionName = fnMatch[1];
                    break;
                }
            }

            let purpose = 'UI State Visibility / Styling Adjustment';
            if (mutation.includes('display') && mutation.includes('none')) purpose = 'Hide UI Element';
            else if (mutation.includes('display') && (mutation.includes('block') || mutation.includes('inline') || mutation.includes('flex'))) purpose = 'Show UI Element';

            mutations.push({ functionName, targetElement, mutation, purpose });
        }
        return mutations;
    }

    function parseFetchFlowDetails(content) {
        const flows = [];
        const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
        let match;

        while ((match = fetchRegex.exec(content)) !== null) {
            const url = match[1];
            const options = match[2] || '';

            const methodMatch = options.match(/method\s*:\s*['"`]([^'"`]+)['"`]/i);
            const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

            const parameters = [];
            const paramMatches = url.match(/\{([^}]+)\}/g);
            if (paramMatches) {
                paramMatches.forEach(p => parameters.push(p.replace(/[{}]/g, '')));
            }

            const headers = [];
            if (options.includes('Content-Type')) headers.push('Content-Type');
            if (options.includes('Authorization') || options.includes('Bearer')) headers.push('Authorization');

            const bodyMatch = options.match(/body\s*:\s*(.*?)(?:,|\}|$)/);
            const body = bodyMatch ? bodyMatch[1].trim() : 'None';

            let consumerFunction = 'DOMContentLoaded / Inline';
            const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
            let fnMatch;
            while ((fnMatch = fnRegex.exec(content)) !== null) {
                if (fnMatch[2].includes(match[0])) {
                    consumerFunction = fnMatch[1];
                    break;
                }
            }

            let responseType = 'Unknown';
            if (content.includes('textContent')) responseType = 'textContent';
            else if (content.includes('json()') || content.includes('JSON')) responseType = 'JSON';
            else if (content.includes('blob()')) responseType = 'blob';

            const domTarget = [];
            const writeMatch = content.match(/([#\.][a-zA-Z0-9_-]+)\.(?:innerText|textContent|innerHTML)\s*=/g);
            if (writeMatch) {
                writeMatch.forEach(w => {
                    let target = w.replace('=', '').trim();
                    if (target.startsWith('#')) {
                        const cleanId = sanitizeCSSId(target);
                        if (cleanId) domTarget.push(cleanId);
                    } else {
                        domTarget.push(target);
                    }
                });
            }

            flows.push({
                method,
                url,
                parameters,
                headers,
                body,
                consumerFunction,
                returnType: 'Unknown',
                responseType,
                domTarget: Array.from(new Set(domTarget)),
                errorFlow: content.includes('.catch') ? 'Catch Block Exception' : 'Standard Promise Error'
            });
        }
        return flows;
    }

    function parseBrowserAPISemantics(content) {
        const apis = [];
        const checks = [
            { name: 'window.open', regex: /window\.open\s*\(([^)]*)\)/, purpose: 'Open Popup Window / Report Export' },
            { name: 'history.pushState', regex: /history\.pushState\s*\(([^)]*)\)/, purpose: 'Client-side Navigation' },
            { name: 'localStorage.setItem', regex: /localStorage\.setItem\s*\(([^)]*)\)/, purpose: 'Persist state' },
            { name: 'localStorage.getItem', regex: /localStorage\.getItem\s*\(([^)]*)\)/, purpose: 'Read persisted state' }
        ];

        checks.forEach(c => {
            let match = c.regex.exec(content);
            if (match) {
                let callerFunction = 'Global Scope';
                const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
                let fnMatch;
                while ((fnMatch = fnRegex.exec(content)) !== null) {
                    if (fnMatch[2].includes(match[0])) {
                        callerFunction = fnMatch[1];
                        break;
                    }
                }
                apis.push({
                    api: c.name,
                    purpose: c.purpose,
                    parameters: match[1] || 'None',
                    callerFunction
                });
            }
        });
        return apis;
    }

    function parseTemplateCollectionStructure(content) {
        const collections = [];
        const rangeRegex = /\{\{\s*range\s+(\$[a-zA-Z0-9_]+)?\s*:?=\s*(\.[a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g;
        let match;

        while ((match = rangeRegex.exec(content)) !== null) {
            const item = match[1] || '$item';
            const collection = match[2];
            const body = match[3];

            const fields = new Set();
            const fieldMatches = body.match(/\.([a-zA-Z0-9_]+)/g);
            if (fieldMatches) {
                fieldMatches.forEach(f => fields.add(f.replace('.', '')));
            }

            collections.push({
                collection,
                item,
                fields: Array.from(fields)
            });
        }
        return collections;
    }

    function parseTemplateAliasResolution(content) {
        const aliases = [];
        const aliasRegex = /\{\{\s*(\$[a-zA-Z0-9_]+)\s*:=\s*([\s\S]*?)\s*\}\}/g;
        let match;

        while ((match = aliasRegex.exec(content)) !== null) {
            aliases.push({
                alias: match[1].trim(),
                expression: match[2].trim()
            });
        }
        return aliases;
    }

    function parseVariableScopeAnalysis(content) {
        const scopes = [];
        const globalCtx = [];
        const loopVars = [];
        const templateLocal = [];
        const jsLocal = [];

        // Global Context (Go Template globals)
        const globalMatches = content.match(/\{\{\s*\.([a-zA-Z0-9_]+)/g);
        if (globalMatches) {
            globalMatches.forEach(m => globalCtx.push(m.replace(/\{\{\s*/, '')));
        }

        // Loop Variables
        const loopMatches = content.match(/\{\{\s*range\s+(\$[a-zA-Z0-9_]+)/g);
        if (loopMatches) {
            loopMatches.forEach(m => loopVars.push(m.replace(/\{\{\s*range\s+/, '')));
        }

        // Template Local Variables
        const tplLocalMatches = content.match(/\{\{\s*(\$[a-zA-Z0-9_]+)\s*:=/g);
        if (tplLocalMatches) {
            tplLocalMatches.forEach(m => templateLocal.push(m.replace(/\{\{\s*/, '').replace(/\s*:=/, '')));
        }

        // JavaScript Local Variables
        const jsLocalMatches = content.match(/(?:let|var|const)\s+([a-zA-Z0-9_$]+)/g);
        if (jsLocalMatches) {
            jsLocalMatches.forEach(m => jsLocal.push(m.replace(/(?:let|var|const)\s+/, '')));
        }

        return {
            globalContext: Array.from(new Set(globalCtx)),
            loopVariables: Array.from(new Set(loopVars)),
            templateLocalVariables: Array.from(new Set(templateLocal)),
            javaScriptLocalVariables: Array.from(new Set(jsLocal))
        };
    }

    function parseJSDependencyGraph(content, functionSemantics) {
        const graph = [];

        functionSemantics.forEach(f => {
            if (f.domReads.length > 0 && f.domWrites.length > 0) {
                f.domReads.forEach(r => {
                    f.domWrites.forEach(w => {
                        graph.push(`${f.name}() depends on ${r} ↓ ${w}`);
                    });
                });
            } else if (f.calls.length > 0) {
                f.calls.forEach(c => {
                    graph.push(`${f.name}() depends on ${c}`);
                });
            }
        });

        return Array.from(new Set(graph));
    }

    function parseExactDOMAnchors(content) {
        const anchors = new Set();
        const regex = /([#\.][a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\.(innerText|textContent|innerHTML|value|checked|style\.[a-zA-Z0-9_$]+)/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            let anchor = match[1];
            if (anchor.startsWith('#')) {
                const cleanId = sanitizeCSSId(anchor);
                if (!cleanId) continue;
                anchor = cleanId;
            }
            anchors.add(`${anchor}.${match[2]}`);
        }
        return Array.from(anchors);
    }

    function parseUIOwnershipAnalysis(content) {
        const components = [];
        if (content.includes('<aside') || content.includes('sidebar')) {
            components.push({ component: 'Sidebar Component', contains: ['Navigation Links', 'User Info Widget'] });
        }
        if (content.includes('<main') || content.includes('content')) {
            components.push({ component: 'MainContent Component', contains: ['Page Header Topbar', 'Data Table View', 'Toolbar Actions'] });
        }
        return components;
    }

    function parseDynamicAttributes(content) {
        const dynAttrs = [];
        const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*["']([^"']*)["']/g;
        let match;

        while ((match = attrRegex.exec(content)) !== null) {
            const attribute = match[1];
            const value = match[2];
            const isDynamic = value.includes('{{') || value.includes('}}');

            dynAttrs.push({
                attribute,
                value,
                type: isDynamic ? 'Dynamic' : 'Static'
            });
        }
        return dynAttrs;
    }

    function parseEventParameters(content) {
        const events = [];
        const eventRegex = /on([a-z]+)\s*=\s*["']([a-zA-Z0-9_$]+)\(([^)]*)\)["']/gi;
        let match;

        while ((match = eventRegex.exec(content)) !== null) {
            const event = `on${match[1]}`;
            const param = match[3].trim();

            let resolvedType = 'Unknown';
            if (param === 'this') resolvedType = 'HTMLInputElement';
            else if (!isNaN(param)) resolvedType = 'Number';
            else if (param.startsWith("'") || param.startsWith('"')) resolvedType = 'String';

            let templateSource = null;
            if (param.includes('{{')) {
                templateSource = param.replace(/[\{\}\s]/g, '');
            }

            events.push({
                event,
                target: match[2],
                parameter: param || 'None',
                resolvedType,
                templateSource
            });
        }
        return events;
    }

    function parseReactMigrationMetadata(content) {
        const helpers = [];
        const keyMatch = content.match(/\{\{\s*range\s+.*\}\}[\s\S]*?\.([a-zA-Z0-9_]*ID)/);
        if (keyMatch) helpers.push({ label: 'Detected React Key Candidate', value: `.$val.${keyMatch[1]}` });

        const listMatch = content.match(/\{\{\s*range\s+([^\}]+)\s*\}\}/);
        if (listMatch) helpers.push({ label: 'Detected List Source', value: listMatch[1].trim() });

        const condMatch = content.match(/\{\{\s*if\s+([^\}]+)\s*\}\}/);
        if (condMatch) helpers.push({ label: 'Detected Conditional Rendering', value: condMatch[1].trim() });

        const inputMatch = content.match(/<input[^>]*id=["']([^"']+)["']/);
        if (inputMatch) helpers.push({ label: 'Detected Controlled Input', value: inputMatch[1] });

        if (content.includes('window') || content.includes('document') || content.includes('history')) {
            helpers.push({ label: 'Detected Client-only APIs', value: 'window, document, history' });
        }

        return helpers;
    }

    function parseExternalDependencyUsage(content) {
        const deps = [];
        if (content.includes('bootstrap') || content.includes('btn-primary')) {
            deps.push({ dependency: 'Bootstrap CSS Framework', purpose: 'UI Styling & Grid System', importedBy: '<link rel="stylesheet">', migrationHint: 'Replace with Tailwind CSS or CSS Modules' });
        }
        if (content.includes('fa-') || content.includes('fontawesome')) {
            deps.push({ dependency: 'FontAwesome Icons', purpose: 'Vector Icon Rendering', importedBy: '<script>/<link>', migrationHint: 'Migrate to react-icons or lucide-react' });
        }
        return deps;
    }

    function parseScriptBlockSemantics(content) {
        const blocks = [];
        const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let match;

        while ((match = scriptRegex.exec(content)) !== null) {
            const body = match[1];

            const functions = [];
            const fnMatches = body.match(/function\s+([a-zA-Z0-9_$]+)/g);
            if (fnMatches) fnMatches.forEach(f => functions.push(f.replace('function', '').trim()));

            const globalVariables = [];
            const varMatches = body.match(/(?:var|let)\s+([a-zA-Z0-9_$]+)/g);
            if (varMatches) varMatches.forEach(v => globalVariables.push(v.replace(/(?:var|let)/, '').trim()));

            const constants = [];
            const constMatches = body.match(/const\s+([a-zA-Z0-9_$]+)/g);
            if (constMatches) constMatches.forEach(c => constants.push(c.replace('const', '').trim()));

            const fetchCalls = [];
            const fetchMatches = body.match(/fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g);
            if (fetchMatches) fetchMatches.forEach(f => fetchCalls.push(f.replace(/fetch\s*\(\s*[`'"]/, '').replace(/[`'"]$/, '')));

            const domReadyEvents = [];
            if (body.includes('DOMContentLoaded')) domReadyEvents.push('DOMContentLoaded Listener');

            blocks.push({
                functions,
                globalVariables,
                constants,
                fetchCalls,
                domReadyEvents,
                exportedSymbols: functions,
                windowGlobals: globalVariables
            });
        }
        return blocks;
    }

})();
