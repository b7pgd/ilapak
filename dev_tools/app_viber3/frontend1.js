/**
 * DEBUG LIR ENGINE - HTML / GO TEMPLATE & VANILLA JS EXTRACTOR
 * Static analysis engine for HTML, Go HTML Templates, and Vanilla JS parsing.
 */

(function () {
    'use strict';

    window.LirEngineRegistry = window.LirEngineRegistry || {
        registerStage(targetEngine, stageFn) {
            if (!this[targetEngine]) {
                this[targetEngine] = [];
            }
            if (!this[targetEngine].includes(stageFn)) {
                this[targetEngine].push(stageFn);
            }
        }
    };

    class HtmlGoTemplateDebugLirExtractor {
        constructor() {
            this.fileContexts = [];
        }

        async processFiles(projectFiles, selectedFiles) {
            if (!selectedFiles || selectedFiles.length === 0) {
                return {
                    finalOutput: "NO FILE SELECTED"
                };
            }

            const results = [];
            for (const path of selectedFiles) {
                const ext = this.getFileExtension(path);

                if (!['html', 'htm', 'tmpl', 'gohtml', 'js'].includes(ext)) {
                    continue;
                }

                const fileObj = projectFiles[path];
                if (!fileObj) continue;

                let content = '';
                try {
                    content = await fileObj.text();
                } catch (e) {
                    content = '';
                }

                // Filtering: skip React/JSX files
                if (/\bimport\s+React\b|from\s+['"]react['"]|<[A-Z][a-zA-Z0-9]*\b/g.test(content) || ['jsx', 'tsx', 'ts'].includes(ext)) {
                    continue;
                }

                const lirData = this.analyzeSingleFile(path, content);
                results.push(this.formatDebugLir(lirData));
            }

            return {
                finalOutput: results.join('\n\n')
            };
        }

        analyzeSingleFile(filePath, code) {
            const ext = this.getFileExtension(filePath);
            const fileType = this.detectFileType(filePath, code, ext);
            const framework = this.detectFramework(filePath, code, ext);
            const purpose = this.inferPurpose(filePath, code, fileType);

            // Stage 1: Build Symbol Table for HTML & Go Template
            const symbolModel = this.buildSymbolModel(code, filePath, fileType);

            // Stage 2: Semantic Extraction
            const entryPoints = this.extractEntryPoints(code, symbolModel, fileType, filePath);
            const executionFlow = this.extractExecutionFlow(code, symbolModel, fileType, filePath);
            const stateFlow = this.extractStateFlow(code, symbolModel);
            const reads = this.extractReads(code, symbolModel);
            const writes = this.extractWrites(code, symbolModel);
            const http = this.extractHttpCalls(code, symbolModel);
            const dependencies = this.extractDependencies(code, symbolModel, framework);
            const failurePoints = this.extractFailurePoints(code, symbolModel, fileType);
            const exitPaths = this.extractExitPaths(code, symbolModel, fileType);

            return {
                filePath,
                fileType,
                framework,
                purpose,
                symbolModel,
                entryPoints,
                executionFlow,
                stateFlow,
                reads,
                writes,
                http,
                dependencies,
                failurePoints,
                exitPaths
            };
        }

        getFileExtension(filePath) {
            const cleanPath = filePath.split('?')[0];
            const parts = cleanPath.split('.');
            return parts.length > 1 ? parts.pop().toLowerCase().trim() : '';
        }

        detectFileType(path, code, ext) {
            const p = path.toLowerCase();
            const hasGoSyntax = /\{\{\s*(?:if|range|template|define|block|with|\.)/g.test(code);

            if (ext === 'html' || ext === 'htm' || ext === 'tmpl' || ext === 'gohtml') {
                if (hasGoSyntax) return 'Go HTML Template (SSR)';
                return 'Static HTML Document';
            }
            if (ext === 'js') return 'Vanilla JavaScript File';

            return 'HTML / SSR Template Module';
        }

        detectFramework(path, code, ext) {
            const detected = [];
            
            if (/\{\{\s*(?:if|range|template|define|block|with|\.)/g.test(code) || ext === 'gohtml' || ext === 'tmpl') {
                detected.push('Go HTML Template');
            }
            if (/\bhtx-|\bhx-[a-z-]+\s*=/i.test(code)) {
                detected.push('HTMX');
            }
            if (/\bx-data\b|\bx-init\b|\bx-on:\b|\bx-bind:\b/i.test(code)) {
                detected.push('Alpine.js');
            }
            if (/\$\(|jQuery\b/g.test(code) || /jquery(?:\.min)?\.js/i.test(code)) {
                detected.push('jQuery');
            }
            if (/bootstrap(?:\.min)?\.(?:css|js)/i.test(code) || /\bclass=["'][^"']*\b(container|row|col-[a-z0-9-]+|btn|card|modal|navbar|table)\b/i.test(code)) {
                detected.push('Bootstrap');
            }
            if (/adminlte(?:\.min)?\.(?:css|js)/i.test(code) || /\bclass=["'][^"']*\b(main-sidebar|content-wrapper|card-primary)\b/i.test(code)) {
                detected.push('AdminLTE');
            }

            if (detected.length === 0) {
                if (ext === 'js') return 'Vanilla JavaScript';
                return 'Static HTML';
            }

            return detected.join(' + ');
        }

        inferPurpose(path, code, fileType) {
            const p = path.toLowerCase();
            if (p.includes('login')) return 'User Authentication & Login View (Go SSR / HTML)';
            if (p.includes('dashboard')) return 'Main User Dashboard & Summary Metrics (Go SSR / HTML)';
            if (p.includes('profile')) return 'User Profile & Account Settings Management (Go SSR / HTML)';
            if (p.includes('label')) return 'Label Management & Batch Operations (Go SSR / HTML)';

            const lines = code.split('\n');
            let docComment = '';
            for (let i = 0; i < Math.min(lines.length, 15); i++) {
                const line = lines[i].trim();
                if (line.startsWith('<!--') || line.startsWith('//') || line.startsWith('/*')) {
                    docComment += line.replace(/<!--|-->|\/\*|\*\/|\/\//g, '').trim() + ' ';
                }
            }
            if (docComment.trim().length > 5) {
                return docComment.trim();
            }

            const fileName = path.split('/').pop();
            return `Provides ${fileType} layout, Go template rendering logic, and client-side DOM events within ${fileName}.`;
        }

        buildSymbolModel(code, filePath, fileType) {
            const goVars = new Set();
            const goFunctions = new Set();
            const goBlocks = [];
            const templateIncludes = new Set();
            const forms = [];
            const inlineEvents = [];
            const jsFunctions = {};
            const domManipulations = [];
            const apiEndpoints = new Set();
            const navigationLinks = new Set();
            const domSelectors = new Set();
            const storageReads = new Set();
            const cookieReads = new Set();
            const sideEffects = new Set();
            const jsxStructure = [];
            const domDependencies = [];
            const templateDataMap = [];
            let handlerName = 'Unknown\n  (inferred from template only)';

            // Extract Handler Name from Go comments or code metadata
            const handlerMatch = code.match(/(?:handler|controller)\s*:\s*([a-zA-Z0-9_]+)/i) || code.match(/func\s+([a-zA-Z0-9_]+Handler)/);
            if (handlerMatch) {
                handlerName = handlerMatch[1];
            }

            // Built-in Go template keywords and standard helpers
            const goBuiltins = ['if', 'else', 'end', 'range', 'template', 'define', 'block', 'with', 'and', 'or', 'not', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'len', 'index', 'slice', 'printf', 'urlquery', 'js', 'html'];

            // Extract Go Template Tokens
            const goVarMatches = code.matchAll(/\{\{\s*(\$?[a-zA-Z0-9_$.]+)/g);
            for (const m of goVarMatches) {
                const token = m[1].trim();
                if (goBuiltins.includes(token)) {
                    if (!['if', 'else', 'end', 'range', 'template', 'define', 'block', 'with'].includes(token)) {
                        goFunctions.add(token);
                    }
                } else if (token.startsWith('.') || token.startsWith('$')) {
                    goVars.add(token);
                } else {
                    goFunctions.add(token);
                }
            }

            // Extract Template Data Map (.Variable -> Specific HTML Element Tag/Class/ID)
            const templateDataMatches = code.matchAll(/(<([a-zA-Z0-9-]+)[^>]*?(?:id=["']([^"']*)["'])?[^>]*?(?:class=["']([^"']*)["'])?[^>]*?>)([\s\S]*?)\{\{\s*(\$?[a-zA-Z0-9_$.]+)\s*\}\}/g);
            for (const m of templateDataMatches) {
                const tag = m[2];
                const idAttr = m[3] ? `#${m[3].trim().split(/\s+/)[0]}` : '';
                const classAttr = m[4] ? `.${m[4].trim().split(/\s+/)[0]}` : '';
                const varName = m[6];

                let elementTarget = tag;
                if (idAttr) {
                    elementTarget = `${tag}${idAttr}`;
                } else if (classAttr) {
                    elementTarget = `${tag}${classAttr}`;
                } else {
                    elementTarget = `<${tag}>`;
                }

                if (!goBuiltins.includes(varName) && (varName.startsWith('.') || varName.startsWith('$'))) {
                    templateDataMap.push(`${varName}\n  ↓\n  ${elementTarget}`);
                }
            }

            // Extract Go Template Control Blocks with structured breakdown
            const goBlockMatches = code.matchAll(/\{\{\s*(if|range|define|block|template|with)\s+([^}]+)\}\}/g);
            for (const m of goBlockMatches) {
                const type = m[1];
                const expr = m[2].trim();
                const deps = Array.from(expr.matchAll(/(\$?[a-zA-Z0-9_$.]+)/g))
                    .map(d => d[1])
                    .filter(d => !goBuiltins.includes(d));

                goBlocks.push({
                    type,
                    expression: expr,
                    depends: Array.from(new Set(deps))
                });
            }

            // Extract Go Template Includes: {{template "header.html" .}}
            const templateMatches = code.matchAll(/\{\{\s*template\s+["']([^"']+)["']/g);
            for (const m of templateMatches) {
                templateIncludes.add(m[1]);
            }

            // Extract Forms & Actions
            const formMatches = code.matchAll(/<form\b([^>]*?)>([\s\S]*?)<\/form>/gi);
            for (const m of formMatches) {
                const attrs = m[1];
                const formBody = m[2];
                const actionMatch = attrs.match(/action=["']([^"']+)["']/i);
                const methodMatch = attrs.match(/method=["']([^"']+)["']/i);
                const idMatch = attrs.match(/id=["']([^"']+)["']/i);
                const onsubmitMatch = attrs.match(/onsubmit=["']([^"']+)["']/i);

                const fields = [];
                const fieldMatches = formBody.matchAll(/<(?:input|select|textarea)\b[^>]*?name=["']([^"']+)["']/gi);
                for (const fm of fieldMatches) {
                    fields.push(fm[1]);
                }

                forms.push({
                    id: idMatch ? idMatch[1] : null,
                    action: actionMatch ? actionMatch[1] : 'current URL',
                    method: methodMatch ? methodMatch[1].toUpperCase() : 'GET',
                    onsubmit: onsubmitMatch ? onsubmitMatch[1] : null,
                    boundHandler: onsubmitMatch ? onsubmitMatch[1] : null,
                    fields: fields
                });
            }

            // Extract Inline DOM Events (onclick, onchange, onsubmit, etc.)
            const inlineEventMatches = code.matchAll(/(on[a-z]+)=["']([^"']+)["']/gi);
            for (const m of inlineEventMatches) {
                inlineEvents.push({
                    event: m[1],
                    handler: m[2],
                    target: 'Inline HTML Target'
                });
            }

            // Extract addEventListener calls from JavaScript (Fixed Callback Detection)
            const addListenerMatches = code.matchAll(/(?:document|window|\$|\b[a-zA-Z0-9_$]+\b)\s*(?:\.\s*querySelector\s*\(\s*["']([^"']+)["']\s*\))?\s*\.\s*addEventListener\s*\(\s*["']([^"']+)["']\s*,\s*([^,\n\)]+)/g);
            for (const m of addListenerMatches) {
                const selector = m[1] || 'Target Element';
                const eventName = 'on' + m[2];
                let rawHandler = m[3].trim();

                let handlerName = rawHandler;
                if (/^(?:async\s*)?(?:\(\s*\)|[a-zA-Z0-9_$]+|\([^)]+\))\s*=>|function/i.test(rawHandler) || rawHandler.startsWith('(')) {
                    handlerName = 'anonymous callback';
                }

                inlineEvents.push({
                    event: eventName,
                    handler: handlerName,
                    target: selector
                });

                // Link form event listeners if matching form ID
                if (m[2] === 'submit') {
                    forms.forEach(f => {
                        if (f.id && selector.includes(f.id)) {
                            f.boundHandler = handlerName;
                        }
                    });
                }
            }

            // Extract jQuery / Event handler bindings (e.g. $('#id').on('click', fn))
            const jqEventMatches = code.matchAll(/\$\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*(?:on\s*\(\s*["']([^"']+)["']\s*,\s*([^,\s\)]+)|(click|change|submit)\s*\(\s*([^)]+)\))/g);
            for (const m of jqEventMatches) {
                const selector = m[1];
                const eventName = 'on' + (m[2] || m[4]);
                const rawHandler = (m[3] || m[5] || '').trim();
                let handler = rawHandler;

                if (/^(?:async\s*)?(?:\(\s*\)|[a-zA-Z0-9_$]+|\([^)]+\))\s*=>|function/i.test(rawHandler) || rawHandler.startsWith('(')) {
                    handler = 'anonymous callback';
                }

                if (handler) {
                    inlineEvents.push({
                        event: eventName,
                        handler: handler,
                        target: selector
                    });
                }
            }

            // Extract Specific DOM Elements / Selectors (Filtering out Go Template expression noise)
            const selectorMatches = code.matchAll(/(?:document\s*\.\s*(?:getElementById|querySelector|querySelectorAll|getElementsByClassName|getElementsByTagName)\s*\(\s*["']([^"']+)["']\s*\)|\$\s*\(\s*["']([^"']+)["']\s*\)|id=["']([^"']+)["'])/g);
            for (const sm of selectorMatches) {
                const sel = sm[1] || sm[2] || (`#` + sm[3]);
                if (sel && !sel.includes('{{')) {
                    domSelectors.add(sel);
                }
            }

            // Extract Storage and Cookie Reads
            const storageMatches = code.matchAll(/(?:localStorage|sessionStorage)\.getItem\s*\(\s*["']([^"']+)["']\s*\)/g);
            for (const st of storageMatches) {
                storageReads.add(st[1]);
            }
            if (code.includes('document.cookie')) {
                cookieReads.add('document.cookie');
            }

            // Extract Vanilla JS Functions and DOM Listeners / Manipulations
            const fnRegex = /(?:function\s+([a-zA-Z0-9_$]+)|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*\{([\s\S]*?)\}/g;
            let match;
            while ((match = fnRegex.exec(code)) !== null) {
                const fnName = match[1] || match[2];
                const fnBody = match[3];
                if (fnName && fnBody) {
                    const statements = [];
                    if (fnBody.includes('fetch(') || fnBody.includes('XMLHttpRequest') || fnBody.includes('$.ajax') || fnBody.includes('axios')) statements.push('HTTP Request');
                    if (fnBody.includes('classList') || fnBody.includes('innerHTML') || fnBody.includes('querySelector') || fnBody.includes('getElementById') || fnBody.includes('removeChild') || fnBody.includes('appendChild')) statements.push('DOM Mutation');
                    if (fnBody.includes('localStorage') || fnBody.includes('sessionStorage')) statements.push('Web Storage Write');

                    jsFunctions[fnName] = { body: fnBody, statements };

                    // DOM Dependency extraction per function
                    const domTargetMatches = fnBody.matchAll(/(?:document\s*\.\s*(?:getElementById|querySelector|querySelectorAll)\s*\(\s*["']([^"']+)["']\s*\)|\$\s*\(\s*["']([^"']+)["']\s*\))\s*\.\s*([a-zA-Z0-9_$]+)/g);
                    for (const tm of domTargetMatches) {
                        const targetEl = tm[1] || tm[2];
                        const method = tm[3];
                        if (targetEl && !targetEl.includes('{{')) {
                            domDependencies.push(`${fnName}() -> [${targetEl}] -> ${method}()`);
                        }
                    }
                }
            }

            // Extract Detailed DOM Writes / Manipulations
            if (code.includes('classList')) domManipulations.push('classList');
            if (code.includes('innerHTML')) domManipulations.push('innerHTML');
            if (code.includes('textContent')) domManipulations.push('textContent');
            if (code.includes('innerText')) domManipulations.push('innerText');
            if (code.includes('setAttribute') || code.includes('removeAttribute')) domManipulations.push('Attribute modification');
            if (code.includes('appendChild') || code.includes('removeChild') || code.includes('remove()')) domManipulations.push('DOM Tree Structure modification');

            // Extract Side Effects & Storage (Precise mapping)
            const hasApiFetch = code.includes('fetch(') || code.includes('XMLHttpRequest') || code.includes('$.ajax') || code.includes('axios');
            if (hasApiFetch) sideEffects.add('HTTP Network Call');
            if (code.includes('localStorage')) sideEffects.add('localStorage');
            if (code.includes('sessionStorage')) sideEffects.add('sessionStorage');
            if (code.includes('window.location') || code.includes('location.href')) sideEffects.add('Browser Page Navigation');
            if (code.includes('window.print(') || code.includes('print()')) sideEffects.add('WINDOW ACTION: window.print()');
            if (domManipulations.length > 0) sideEffects.add('textContent / DOM update');

            // Separate API Endpoints (Fetch/AJAX) vs Browser Navigation Links (href)
            const apiMatches = code.matchAll(/(?:fetch|axios(?:\.get|\.post|\.put|\.delete)?|\$\.ajax)\s*\(?\s*[:=]?\s*["'`]([^"'`\s{}]+)["'`]/gi);
            for (const m of apiMatches) {
                const endpoint = m[1].trim();
                if (endpoint && !endpoint.endsWith('.css') && !endpoint.endsWith('.js')) {
                    apiEndpoints.add(endpoint);
                }
            }
            const xhrMatches = code.matchAll(/\.open\s*\(\s*["'](?:GET|POST|PUT|DELETE|PATCH)["']\s*,\s*["'`]([^"'`]+)["'`]/gi);
            for (const m of xhrMatches) {
                apiEndpoints.add(m[1].trim());
            }

            const hrefMatches = code.matchAll(/(?:href|location\.href|action)\s*[:=]?\s*["'`]([^"'`\s{}]+)["'`]/gi);
            for (const m of hrefMatches) {
                const link = m[1].trim();
                if (link && !link.endsWith('.css') && !link.endsWith('.js') && !link.startsWith('javascript:')) {
                    navigationLinks.add(link);
                }
            }

            // Construct Rich Structural HTML UI Tree Hierarchy
            const uiComponents = [];

            // Detect Structural Layout Tags
            if (/<header\b/i.test(code)) uiComponents.push('Header Layout Section');
            if (/<nav\b|class=["'][^"']*\bnavbar\b/i.test(code)) uiComponents.push('Navbar Navigation');
            if (/<aside\b|class=["'][^"']*\bsidebar\b/i.test(code)) uiComponents.push('Sidebar Panel');
            if (/<table\b/i.test(code)) uiComponents.push('Data Table Block');
            if (/class=["'][^"']*\bmodal\b/i.test(code)) uiComponents.push('Modal Dialog Box');
            if (/class=["'][^"']*\bcard\b/i.test(code)) uiComponents.push('Card Container');
            if (/<footer\b/i.test(code)) uiComponents.push('Footer Section');

            // Detect UI Controls & Inputs
            const inputElements = [];
            if (/<button\b/i.test(code)) inputElements.push('Buttons (<button>)');
            if (/<input\b/i.test(code)) inputElements.push('Form Input Fields (<input>)');
            if (/<select\b/i.test(code)) inputElements.push('Dropdown Controls (<select>)');
            if (/<textarea\b/i.test(code)) inputElements.push('Text Area Inputs (<textarea>)');

            const semanticGroups = {
                'UI Layout & Components': uiComponents,
                'UI Controls & Inputs': inputElements,
                'Forms & Action Handlers': forms.map(f => `Form [${f.method}] -> ${f.action}` + (f.boundHandler ? ` (JS Handler: ${f.boundHandler})` : '')),
                'Go Template Blocks': goBlocks.map(b => `{{${b.type} ${b.expression}}}`),
                'DOM Event Listeners': inlineEvents.map(e => `${e.event} [${e.target}] -> ${e.handler}`)
            };

            Object.keys(semanticGroups).forEach(group => {
                const items = Array.from(new Set(semanticGroups[group]));
                if (items.length > 0) {
                    jsxStructure.push(`├── ${group}`);
                    items.forEach(it => {
                        jsxStructure.push(`│   └── ${it}`);
                    });
                }
            });

            return {
                handlerName,
                goVars: Array.from(goVars),
                goFunctions: Array.from(goFunctions),
                goBlocks,
                templateIncludes: Array.from(templateIncludes),
                forms,
                inlineEvents,
                jsFunctions,
                domManipulations,
                apiEndpoints,
                navigationLinks,
                domSelectors: Array.from(domSelectors),
                storageReads: Array.from(storageReads),
                cookieReads: Array.from(cookieReads),
                sideEffects,
                jsxStructure,
                domDependencies,
                templateDataMap
            };
        }

        extractEntryPoints(code, symbolModel, fileType, filePath) {
            const entryPoints = [];

            if (fileType.includes("Go HTML")) {
                const route = filePath.replace(/\\/g, '/');
                entryPoints.push(`SERVER RENDER\n  GET /${route.split('/').pop().replace(/\.[^/.]+$/, '')}\n  ↓\n  Go Handler: ${symbolModel.handlerName}\n  ↓\n  Execute Template`);
            }

            if (code.includes('DOMContentLoaded') || code.includes('window.onload') || code.includes('$(document).ready') || code.includes('$(function')) {
                entryPoints.push('PAGE LOAD\n  DOMContentLoaded / window.onload / jQuery Ready Execution');
            } else if (!fileType.includes("Go HTML")) {
                entryPoints.push('PAGE LOAD\n  Server SSR Rendering Engine');
            }

            if (symbolModel.inlineEvents.length > 0) {
                const eventsList = symbolModel.inlineEvents.map(e => `${e.event} [${e.target}] -> ${e.handler}`).join('\n  ');
                entryPoints.push(`DOM USER ACTIONS & LISTENERS\n  ${eventsList}`);
            }

            if (symbolModel.forms.length > 0) {
                const formList = symbolModel.forms.map(f => `Form Submit [${f.method}] -> ${f.action}` + (f.boundHandler ? ` (Handler: ${f.boundHandler})` : '')).join('\n  ');
                entryPoints.push(`FORM SUBMISSIONS\n  ${formList}`);
            }

            return entryPoints;
        }

        extractExecutionFlow(code, symbolModel, fileType, filePath) {
            const flows = [];

            if (fileType.includes("Go HTML")) {
                const routeName = '/' + filePath.split('/').pop().replace(/\.[^/.]+$/, '');
                flows.push(`SERVER EXECUTION\n  GET ${routeName}\n  ↓\n  ${symbolModel.handlerName}\n  ↓\n  Render Template`);
            }

            const clientSteps = [];
            if (code.includes('DOMContentLoaded') || code.includes('window.onload')) {
                clientSteps.push('DOMContentLoaded()\n  ↓\n  anonymous callback');
            }

            if (symbolModel.inlineEvents.length > 0) {
                symbolModel.inlineEvents.forEach(evt => {
                    let cleanFn = evt.handler.trim();
                    if (/^[a-zA-Z0-9_$]+\(.*\)$/.test(cleanFn)) {
                        cleanFn = cleanFn.replace(/\(.*\)/, '()').trim();
                    }

                    const chain = [
                        `EVENT\n  ${evt.event}`,
                        `↓\n  ${cleanFn}`,
                        `↓\n  DOM Update`
                    ];
                    flows.push(chain.join('\n  '));
                });
            } else if (clientSteps.length > 0) {
                flows.push(`CLIENT EXECUTION\n  ${clientSteps.join('\n  ↓\n  ')}`);
            }

            if (symbolModel.forms.length > 0) {
                symbolModel.forms.forEach(form => {
                    const chain = [
                        `FORM EXECUTION:\n  Submit Form ${form.id ? '(#' + form.id + ')' : ''}`,
                        `JS HANDLER:\n  ${form.boundHandler ? form.boundHandler : 'Native Browser Submission'}`,
                        `HTTP REQUEST:\n  ${form.method} ${form.action}`,
                        `SERVER HANDLER:\n  ${symbolModel.handlerName}`,
                        `RESULT:\n  Page Reload / HTML SSR Response / AJAX Response`
                    ];
                    flows.push(chain.join('\n\n↓\n\n'));
                });
            }

            if (flows.length === 0) {
                flows.push('USER ACTION:\nPage Load / Interaction\n\n↓\n\nEXECUTE:\nDOM Parsing / Event Binding\n\n↓\n\nRENDER:\nStatic View');
            }

            return flows;
        }

        extractStateFlow(code, symbolModel) {
            const stateFlows = [];

            if (symbolModel.goVars.length > 0) {
                symbolModel.goVars.forEach(v => {
                    stateFlows.push(`${v}\n  Controller\n  ↓\n  Template\n  ↓\n  HTML`);
                });
            }

            if (symbolModel.domManipulations.length > 0) {
                stateFlows.push(`Client DOM State\n  Controller\n  ↓\n  Template\n  ↓\n  HTML`);
            }

            return stateFlows;
        }

        extractReads(code, symbolModel) {
            const reads = [];

            if (symbolModel.goVars.length > 0) {
                reads.push(`Go Server Context Variables\n    ${symbolModel.goVars.join('\n    ')}`);
            } else {
                reads.push('Go Server Context Variables\n    None');
            }

            if (symbolModel.domSelectors.length > 0) {
                reads.push(`DOM Elements\n    ${symbolModel.domSelectors.join('\n    ')}`);
            } else {
                reads.push('DOM Elements\n    None');
            }

            if (symbolModel.cookieReads.length > 0 || symbolModel.storageReads.length > 0) {
                const items = [...symbolModel.cookieReads, ...symbolModel.storageReads];
                reads.push(`Browser Cookies & Storage Reads\n    ${items.join('\n    ')}`);
            } else {
                reads.push('Browser Cookies & Storage Reads\n    None');
            }

            if (code.includes('dataset') || code.includes('getAttribute') || code.includes('.data(')) {
                reads.push('DOM Attributes / Dataset\n    Active (data-* attributes read)');
            } else {
                reads.push('DOM Attributes / Dataset\n    None');
            }

            return reads;
        }

        extractWrites(code, symbolModel) {
            const writes = [];

            if (symbolModel.domManipulations.length > 0) {
                writes.push(`DOM Writes\n    - ${symbolModel.domManipulations.join('\n    - ')}`);
            } else {
                writes.push('DOM Writes\n    None');
            }

            if (code.includes('localStorage.setItem') || code.includes('sessionStorage.setItem')) {
                writes.push('Web Storage Writes\n    localStorage / sessionStorage');
            } else {
                writes.push('Web Storage Writes\n    None');
            }

            if (code.includes('window.location') || code.includes('location.href')) {
                writes.push('Window Navigation\n    window.location redirection');
            } else {
                writes.push('Window Navigation\n    None');
            }

            return writes;
        }

        extractHttpCalls(code, symbolModel) {
            const httpBlocks = [];

            if (symbolModel.navigationLinks.size > 0) {
                symbolModel.navigationLinks.forEach(nav => {
                    httpBlocks.push(`GET ${nav}`);
                });
            }

            if (symbolModel.forms.length > 0) {
                symbolModel.forms.forEach(f => {
                    httpBlocks.push(`${f.method} ${f.action}`);
                });
            }

            if (symbolModel.apiEndpoints.size > 0) {
                symbolModel.apiEndpoints.forEach(endpoint => {
                    httpBlocks.push(`fetch ${endpoint}`);
                });
            }

            return httpBlocks.length > 0 ? httpBlocks : ['REQUEST\n  None detected in source code'];
        }

        extractDependencies(code, symbolModel, framework) {
            const deps = [];

            const scriptMatches = code.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi);
            const externalScripts = [];
            for (const m of scriptMatches) externalScripts.push(m[1]);

            if (externalScripts.length > 0) {
                deps.push(`External JS Scripts\n    ${externalScripts.join('\n    ')}`);
            }

            if (framework) {
                deps.push(`Framework Context\n    ${framework}`);
            }

            if (symbolModel.templateIncludes.length > 0) {
                deps.push(`TEMPLATE INCLUDE GRAPH\n  ${symbolModel.templateIncludes.join('\n  ↓\n  ')}`);
            }

            if (symbolModel.domDependencies.length > 0) {
                deps.push(`DOM Element Dependencies\n    ${symbolModel.domDependencies.join('\n    ')}`);
            }

            if (symbolModel.goBlocks.length > 0) {
                const templates = symbolModel.goBlocks.filter(b => b.type === 'template' || b.type === 'block' || b.type === 'with').map(b => `${b.type}: ${b.expression}`);
                if (templates.length > 0) {
                    deps.push(`Go Template Scope Blocks\n    ${templates.join('\n    ')}`);
                }
            }

            return deps.length > 0 ? deps : ['Detected Dependencies:\n    None'];
        }

        extractFailurePoints(code, symbolModel, fileType) {
            const failures = [];

            const selectorMatches = code.matchAll(/document\.querySelector\s*\(\s*["']([^"']+)["']\s*\)/g);
            for (const m of selectorMatches) {
                const fnMatch = code.match(new RegExp(`function\\s+([a-zA-Z0-9_$]+)[^}]*?${m[1].replace('#', '\\#')}`));
                const fnName = fnMatch ? fnMatch[1] + '()' : 'Client Script';
                failures.push(`${fnName}\n↓\nquerySelector("${m[1]}")\n↓\nnull\n↓\nTypeError`);
            }

            if (failures.length === 0) {
                if (fileType.includes('Go HTML')) {
                    failures.push('Template Execution Failure\n↓\nMissing Variable / Controller Error / HTTP 500');
                }
                if (symbolModel.forms.length > 0) {
                    failures.push('HTML Form Submission\n↓\nHTTP Network Error / Server 500 Failure');
                }
                if (symbolModel.apiEndpoints.size > 0) {
                    failures.push('AJAX / Network Request Call\n↓\nNetwork Drop or Invalid Response');
                }
            }

            return failures.length > 0 ? failures : ['No explicit failure points identified'];
        }

        extractExitPaths(code, symbolModel, fileType) {
            const exits = [];

            if (fileType.includes('Go HTML')) {
                exits.push('SUCCESS\n\nServer:\n  HTML Rendered\n\nClient:\n  User Interaction Available\n\nERROR\n\nTemplate Render Failure\n↓\n500 Response\n\nClient Error\n↓\nJS Exception');
            } else if (symbolModel.forms.length > 0) {
                exits.push('SUCCESS\n  Full Browser Navigation or Handled Action Endpoint\n\nERROR\n  HTTP 500 / Error Response');
            } else if (code.includes('window.location') || code.includes('location.href')) {
                exits.push('SUCCESS\n  window.location redirection\n\nERROR\n  Navigation Interrupted');
            } else if (symbolModel.domManipulations.length > 0) {
                exits.push('SUCCESS\n  UI element class / content updated in-place\n\nERROR\n  DOM Mutation Error');
            } else {
                exits.push('SUCCESS\n  HTML Rendered\n  ↓\n  User Interaction\n\nERROR\n  HTTP 500\n  ↓\n  Error Response');
            }

            return exits;
        }

        formatDebugLir(data) {
            const sm = data.symbolModel;

            let uiTreeOutput = `[Document Root: ${data.filePath}]`;
            if (sm.jsxStructure.length > 0) {
                uiTreeOutput += '\n' + sm.jsxStructure.join('\n');
            } else {
                uiTreeOutput += '\n└── [No Form / Event Elements Detected]';
            }

            const formMapOutput = sm.forms.length > 0 
                ? sm.forms.map(f => `Form ${f.id ? '#' + f.id : ''}\n  ${f.method} ${f.action}\n  Fields:\n    ${f.fields.length > 0 ? f.fields.join('\n    ') : 'None'}\n  JS:\n    ${f.boundHandler || 'None'}`).join('\n\n')
                : 'None';

            const routeGraphOutput = sm.navigationLinks.size > 0 
                ? 'Navigation Routes\n  ' + Array.from(sm.navigationLinks).join('\n  ') 
                : 'None';

            // Map Client Functions with their source file location
            const ext = this.getFileExtension(data.filePath);
            const sourceLocation = ext === 'js' ? data.filePath : 'inline <script>';

            const clientFns = new Set(Object.keys(sm.jsFunctions).map(f => `${f}() -> ${sourceLocation}`));
            sm.inlineEvents.forEach(e => {
                const match = e.handler.match(/^([a-zA-Z0-9_$]+)\s*\(/);
                if (match) {
                    clientFns.add(`${match[1]}() -> ${sourceLocation}`);
                } else if (/^[a-zA-Z0-9_$]+$/.test(e.handler.trim())) {
                    clientFns.add(`${e.handler.trim()}() -> ${sourceLocation}`);
                }
            });

            return [
                '==================================================',
                `FILE: ${data.filePath}`,
                `FRAMEWORK: ${data.framework}`,
                `TYPE: ${data.fileType}`,
                `PURPOSE: ${data.purpose}`,
                '================================================== SYMBOL TABLE',
                `HANDLER:\n  ${sm.handlerName}`,
                `GO VARIABLES:\n  ${sm.goVars.length > 0 ? sm.goVars.join('\n  ') : 'None'}`,
                `TEMPLATE FUNCTIONS:\n  ${sm.goFunctions.length > 0 ? sm.goFunctions.join('\n  ') : 'None'}`,
                `TEMPLATE INCLUDES:\n  ${sm.templateIncludes.length > 0 ? sm.templateIncludes.join('\n  ') : 'None'}`,
                `GO BLOCKS:\n  ${sm.goBlocks.length > 0 ? sm.goBlocks.map(b => `${b.type.toUpperCase()}:\n    ${b.expression}` + (b.depends.length > 0 ? `\n    depends:\n      ${b.depends.join(', ')}` : '')).join('\n  ') : 'None'}`,
                `FORMS:\n  ${sm.forms.length > 0 ? sm.forms.map(f => `[${f.method}] ${f.action}` + (f.boundHandler ? ` (Handler: ${f.boundHandler})` : '')).join('\n  ') : 'None'}`,
                `FUNCTIONS:\n  ${Object.keys(sm.jsFunctions).length > 0 ? Object.keys(sm.jsFunctions).join('\n  ') : 'None'}`,
                `CLIENT FUNCTIONS:\n  ${clientFns.size > 0 ? Array.from(clientFns).join('\n  ') : 'None'}`,
                `API ENDPOINTS:\n  ${sm.apiEndpoints.size > 0 ? Array.from(sm.apiEndpoints).join('\n  ') : 'None'}`,
                '================================================== TEMPLATE DATA MAP',
                `${sm.templateDataMap.length > 0 ? sm.templateDataMap.join('\n\n') : 'None'}`,
                '================================================== FORM MAP',
                `${formMapOutput}`,
                '================================================== ROUTE MAP',
                `${routeGraphOutput}`,
                '================================================== UI TREE',
                `UI TREE:\n${uiTreeOutput}`,
                '================================================== ENTRY POINTS',
                `${data.entryPoints.join('\n\n')}`,
                '================================================== EXECUTION FLOW',
                `${data.executionFlow.join('\n\n')}`,
                '================================================== STATE FLOW',
                `STATE LIFECYCLE:\n${data.stateFlow.length > 0 ? data.stateFlow.join('\n\n') : '  None'}`,
                '================================================== READS',
                `${data.reads.join('\n\n')}`,
                '================================================== WRITES',
                `${data.writes.join('\n\n')}`,
                '================================================== HTTP',
                `${data.http.join('\n\n')}`,
                '================================================== DEPENDENCIES',
                `${data.dependencies.join('\n\n')}`,
                '================================================== SIDE EFFECTS',
                `FUNCTION MAP & SIDE EFFECTS:\n  ${sm.sideEffects.size > 0 ? Array.from(sm.sideEffects).join('\n  ↓\n  ') : 'None'}`,
                '================================================== FAILURE POINTS',
                `${data.failurePoints.join('\n\n')}`,
                '================================================== EXIT PATH',
                `${data.exitPaths.join('\n\n')}`,
                '=================================================='
            ].join('\n');
        }
    }

    const extractor = new HtmlGoTemplateDebugLirExtractor();

    // Register stage khusus untuk HTML & Go HTML Template
    window.LirEngineRegistry.registerStage('frontend', async function (ctx) {
        return await extractor.processFiles(ctx.projectFiles, ctx.selectedFiles);
    });
})();
