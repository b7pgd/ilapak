/**
 * viber2.js — Semantic Refinement Layer / Intelligence Wrapper
 *
 * Enhances raw structural extraction outputs into a lossless
 * SEMANTIC SKELETON for legacy project analysis and migration tracking.
 */

const Viber2Engine = {
    /**
     * Main entry point to process raw text output from viber.js
     * or analyze source file contexts into a Lossless Semantic Skeleton.
     * 
     * @param {string} fileKey - Relative file path (e.g., 'src/app.js')
     * @param {string} rawCode - Source code contents
     * @returns {string} Processed Lossless SEMANTIC SKELETON text block
     */
    analyzeFile: function(fileKey, rawCode) {
        const lines = rawCode.split('\n');
        const lowerPath = fileKey.toLowerCase();
        const fileName = fileKey.split('/').pop().toLowerCase();

        // LAYER 1: STRUCTURE PRESERVATION & INFERENCE
        const filePurpose = this.inferPurpose(lowerPath, fileName);
        const fileRole = this.inferRole(lowerPath, fileName);
        const dependencies = this.extractDependencies(lines);

        // LAYER 2: BEHAVIOR ANALYZER (STRICT EXTRACTION)
        const functions = this.extractStrictFunctions(lines, rawCode);
        this.resolveRealCallers(functions, lines, fileKey);
        const triggers = this.extractTriggers(lines, fileKey, functions);
        const stateAnalysis = this.extractStateAndLocalVariables(lines, functions);
        const stateModel = stateAnalysis.stateModel;
        const localVariableMap = stateAnalysis.localVariables;
        const apiContracts = this.extractApiContracts(lines, fileKey, functions);
        const errorFlows = this.extractErrorFlows(lines, functions);

        // LAYER 3: INTENT MAPPER & CALL GRAPH
        const codeIntent = this.generateCodeIntent(fileKey, filePurpose, functions, triggers, apiContracts);
        const callGraph = this.buildCallGraph(functions);
        const migrationAnchors = this.buildMigrationAnchors(fileKey, lines, functions, apiContracts, triggers, stateModel);

        // FORMAT LOSSLESS SEMANTIC SKELETON OUTPUT
        return this.formatOutput({
            fileKey,
            filePurpose,
            fileRole,
            dependencies,
            codeIntent,
            functions,
            triggers,
            stateModel,
            localVariableMap,
            apiContracts,
            callGraph,
            errorFlows,
            migrationAnchors
        });
    },

    // --- LAYER 1 HELPERS ---

    inferPurpose: function(lowerPath, fileName) {
        if (lowerPath.includes('auth') || lowerPath.includes('login')) return "Authentication & User Session Management";
        if (lowerPath.includes('controller')) return "Request Handling & Business Logic Controller";
        if (lowerPath.includes('route') || lowerPath.includes('router')) return "API Routing & Endpoint Mapping";
        if (lowerPath.includes('model') || lowerPath.includes('struct') || lowerPath.includes('entity')) return "Data Schema / Entity State Definition";
        if (lowerPath.includes('service')) return "Core Business Logic & External Integration Service";
        if (lowerPath.includes('util') || lowerPath.includes('helper')) return "Shared Helper Utilities";
        if (fileName.endsWith('.html')) return "UI Presentation Structure & View Template";
        if (fileName.endsWith('.css')) return "Visual Presentation & Styling Rules";
        if (fileName.endsWith('.json') || fileName.endsWith('.env') || fileName.endsWith('.yaml') || fileName.endsWith('.yml')) return "Application Configuration & Runtime Environment Data";
        return "General Application Logic / Utility Module";
    },

    inferRole: function(lowerPath, fileName) {
        if (fileName.endsWith('.html') || fileName.endsWith('.css')) return "UI Component";
        if (lowerPath.includes('controller') || lowerPath.includes('handler')) return "Backend Controller";
        if (lowerPath.includes('model') || lowerPath.includes('entity') || lowerPath.includes('struct')) return "Database Model";
        if (lowerPath.includes('service') || lowerPath.includes('api')) return "API Service";
        if (fileName.endsWith('.json') || fileName.endsWith('.env') || fileName.endsWith('.yaml') || fileName.endsWith('.yml')) return "Configuration";
        return "Utility";
    },

    extractDependencies: function(lines) {
        const deps = [];
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('import ') || trimmed.startsWith('import(') || 
                trimmed.includes('require(') || trimmed.includes('<script src=') || 
                trimmed.includes('<link rel=')) {
                deps.push(trimmed);
            }
        });
        return deps;
    },

    // --- CODE INTENT SECTION ---

    generateCodeIntent: function(fileKey, purpose, functions, triggers, apiContracts) {
        const responsibilities = [];
        const behaviors = [];

        if (triggers.length > 0) {
            responsibilities.push("Handle user interactions and DOM event bindings");
        }
        if (apiContracts.length > 0) {
            responsibilities.push("Manage HTTP requests and remote backend synchronization");
        }
        if (functions.length > 0) {
            responsibilities.push("Execute core domain and operational business logic");
        }
        if (responsibilities.length === 0) {
            responsibilities.push("Provide structural template and presentation rules");
        }

        functions.forEach(fn => {
            if (fn.purposeSummary && fn.purposeSummary !== `Executes ${fn.name} operational logic`) {
                behaviors.push(fn.purposeSummary);
            }
        });

        if (behaviors.length === 0) {
            behaviors.push("Maintain component/module lifecycle execution");
        }

        return {
            purpose: purpose,
            responsibilities: responsibilities,
            behaviors: Array.from(new Set(behaviors))
        };
    },

    // --- REFACTOR TARGET 3: FUNCTION PURPOSE ENGINE (DETERMINISTIC SCORING & SIGNALS) ---

    analyzeFunctionSignals: function(name, bodyText, params) {
        const signals = {
            name: name,
            dom: [],
            api: [],
            state: [],
            dataProcessing: []
        };

        const lowerBody = bodyText.toLowerCase();

        // DOM Signal Detection
        if (lowerBody.includes('document.getelementbyid') || lowerBody.includes('queryselector')) signals.dom.push("Queries DOM elements");
        if (lowerBody.includes('queryselectorall') || lowerBody.includes('getelementsbytagname')) signals.dom.push("Queries multiple DOM elements / collections");
        if (lowerBody.includes('checked') || lowerBody.includes('selected')) signals.dom.push("Reads checked/selected UI states");
        if (lowerBody.includes('innertext') || lowerBody.includes('innerhtml') || lowerBody.includes('value =')) signals.dom.push("Mutates DOM node values or text content");
        if (lowerBody.includes('classlist')) signals.dom.push("Manipulates element CSS classes");

        // API Signal Detection
        if (lowerBody.includes('fetch(') || lowerBody.includes('axios') || lowerBody.includes('$.ajax')) signals.api.push("Triggers network HTTP request");
        if (lowerBody.includes('json.stringify')) signals.api.push("Serializes payload objects to JSON string");

        // State Signal Detection
        if (lowerBody.includes('localstorage') || lowerBody.includes('sessionstorage')) signals.state.push("Accesses Web Storage API");
        if (lowerBody.match(/\b[a-zA-Z0-9_]+\s*=\s*[^=]/)) signals.state.push("Modifies local/scoped variables or state references");

        // Data Processing Signal Detection
        if (lowerBody.includes('.filter(') || lowerBody.includes('.map(') || lowerBody.includes('.reduce(')) signals.dataProcessing.push("Transforms collection data using functional array methods");
        if (lowerBody.includes('.split(') || lowerBody.includes('.replace(') || lowerBody.includes('match(')) signals.dataProcessing.push("Performs string parsing or regex matching");
        if (lowerBody.includes('validator') || lowerBody.includes('validate') || lowerBody.includes('if ')) signals.dataProcessing.push("Evaluates conditional validation rules");
        if (params && params !== 'None') signals.dataProcessing.push(`Accepts input parameters (${params})`);

        // Compute Confidence Level
        let confidence = "LOW";
        let score = 0;
        if (signals.dom.length > 0) score++;
        if (signals.api.length > 0) score++;
        if (signals.state.length > 0) score++;
        if (signals.dataProcessing.length > 0) score++;

        if (score >= 3) confidence = "HIGH";
        else if (score === 2) confidence = "MEDIUM";
        else confidence = "LOW";

        // Generate Deterministic Purpose Summary
        let purposeSummary = `Executes ${name} operational logic`;
        const lowerName = name.toLowerCase();
        if (lowerName.includes('print')) purposeSummary = "Execute selected label printing workflow";
        else if (lowerName.includes('selectall')) purposeSummary = "Perform bulk selection of list/table UI items";
        else if (lowerName.includes('unselectall')) purposeSummary = "Clear selection state across list/table items";
        else if (lowerName.includes('toggle')) purposeSummary = "Toggle state for target entity";
        else if (lowerName.includes('extract')) purposeSummary = "Parse structural or semantic data streams";
        else if (lowerName.includes('copy')) purposeSummary = "Write target text buffer to clipboard";
        else if (lowerName.includes('download')) purposeSummary = "Export data buffer as local file artifact";
        else if (lowerName.includes('update')) purposeSummary = "Synchronize UI state representations";

        return {
            purposeSummary,
            confidence,
            signals
        };
    },

    // --- REFACTOR TARGET 1: STRICT FUNCTION DETECTION & BEHAVIOR EXTRACTION ---

    extractStrictFunctions: function(lines, rawCode) {
        const functions = [];
        
        const funcPatterns = [
            /^\s*function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/,
            /^\s*(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/,
            /^\s*(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
            /^\s*(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?([a-zA-Z0-9_]+)\s*=>/,
            /^\s*export\s+function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/,
            /^\s*export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
            /^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)/
        ];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let name = "";
            let params = "";
            let matched = false;

            for (let pattern of funcPatterns) {
                const match = line.match(pattern);
                if (match) {
                    name = match[1];
                    params = match[2] || "";
                    matched = true;
                    break;
                }
            }

            if (matched && name) {
                const startLine = i + 1;
                const endLine = this.getScopeEndLine(lines, i);
                const bodyLines = lines.slice(i, endLine);
                const bodyText = bodyLines.join('\n');
                const analysis = this.analyzeFunctionSignals(name, bodyText, params);

                functions.push({
                    name: name,
                    startLine: startLine,
                    endLine: endLine,
                    params: params.trim() || "None",
                    purposeSummary: analysis.purposeSummary,
                    confidence: analysis.confidence,
                    signals: analysis.signals,
                    read: this.inferReadSource(bodyText, params),
                    process: this.inferProcessLogic(bodyText),
                    stateChange: this.inferStateChange(bodyText),
                    calls: [], 
                    calledBy: "Unknown External Entry Point",
                    output: this.inferOutputResult(bodyText)
                });
            }
        }

        const localNames = new Set(functions.map(f => f.name));
        functions.forEach(fn => {
            const bodyText = lines.slice(fn.startLine - 1, fn.endLine).join('\n');
            localNames.forEach(otherName => {
                if (otherName !== fn.name) {
                    const regex = new RegExp(`\\b${otherName}\\s*\\(`, 'g');
                    if (regex.test(bodyText)) {
                        fn.calls.push(otherName);
                    }
                }
            });
        });

        return functions;
    },

    getScopeEndLine: function(lines, startIdx) {
        let braceCount = 0;
        let started = false;
        for (let j = startIdx; j < lines.length; j++) {
            const openCount = (lines[j].match(/\{/g) || []).length;
            const closeCount = (lines[j].match(/\}/g) || []).length;
            if (openCount > 0) started = true;
            braceCount += openCount - closeCount;
            if (started && braceCount <= 0) return j + 1;
        }
        return lines.length;
    },

    inferReadSource: function(bodyText, params) {
        const reads = [];
        if (params && params !== 'None') reads.push(`Parameters (${params})`);
        if (bodyText.includes('document.querySelectorAll') || bodyText.includes('type="checkbox"')) reads.push("Selected checkbox state / IDs");
        if (bodyText.includes('document.getElementById') || bodyText.includes('querySelector')) reads.push("DOM Element Attributes / User selection state");
        if (bodyText.includes('localStorage')) reads.push("localStorage configuration");
        if (bodyText.includes('fetch(') || bodyText.includes('axios.')) reads.push("Network API Payload");
        return reads.length > 0 ? reads.join(', ') : "Internal Execution Context";
    },

    inferProcessLogic: function(bodyText) {
        const steps = [];
        if (bodyText.includes('.filter(') || bodyText.includes('.map(') || bodyText.includes('validate')) steps.push("Validate selected items");
        if (bodyText.includes('JSON.stringify') || bodyText.includes('fetch') || bodyText.includes('payload')) steps.push("Build request payload");
        if (bodyText.includes('fetch(') || bodyText.includes('axios.') || bodyText.includes('$.ajax')) steps.push("Trigger network request");
        if (bodyText.includes('.split(') || bodyText.includes('.replace(') || bodyText.includes('match(')) steps.push("Data parsing / text transformation");
        return steps.length > 0 ? steps.join(' -> ') : "Sequential execution";
    },

    inferStateChange: function(bodyText) {
        const changes = [];
        if (bodyText.includes('.classList') || bodyText.includes('checked')) changes.push("Update UI selection state");
        if (bodyText.includes('innerText') || bodyText.includes('innerHTML') || bodyText.includes('status')) changes.push("Modify UI feedback / text node");
        if (bodyText.includes('localStorage.set')) changes.push("Update persistent local storage");
        return changes.length > 0 ? changes.join(', ') : "No permanent state side-effects";
    },

    inferOutputResult: function(bodyText) {
        if (bodyText.includes('fetch') || bodyText.includes('axios')) return "Network execution result / API response";
        if (bodyText.includes('return ')) return "Returned value / computed evaluation";
        if (bodyText.includes('navigator.clipboard.writeText')) return "Clipboard data updated";
        if (bodyText.includes('link.click()')) return "File download trigger triggered";
        return "State / DOM mutation side effect";
    },

    // --- REFACTOR TARGET 2: REAL CALLER ANALYSIS (REVERSE CALL TRACING) ---

    resolveRealCallers: function(functions, lines, fileKey) {
        const fnMap = new Map();
        functions.forEach(f => fnMap.set(f.name, f));

        // 1. Check internal function-to-function calls
        functions.forEach(callerFn => {
            callerFn.calls.forEach(calledName => {
                const targetFn = fnMap.get(calledName);
                if (targetFn && (targetFn.calledBy === "Unknown External Entry Point" || !targetFn.calledBy.includes('()'))) {
                    targetFn.calledBy = `${callerFn.name}()`;
                }
            });
        });

        // 2. Check HTML inline events & DOM addEventListeners across lines
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();

            // addEventListener pattern
            if (trimmed.includes('addEventListener(')) {
                const match = trimmed.match(/(?:document\.getElementById\(['"]([^'"]+)['"]\)|document\.querySelector\(['"]([^'"]+)['"]\)|(\$?[a-zA-Z0-9_]+))\s*\.\s*addEventListener\(['"]([^'"]+)['"]\s*,\s*(?:function\s*\([^)]*\)\s*\{?|([a-zA-Z0-9_]+))/);
                if (match) {
                    const eventType = match[4] || "event";
                    const handlerName = match[5];
                    if (handlerName && fnMap.has(handlerName)) {
                        fnMap.get(handlerName).calledBy = `DOM Event Listener ${eventType}`;
                    }
                }
            }

            // Inline event attributes (onclick, onchange, etc.)
            const inlineMatch = trimmed.match(/on([a-z]+)=['"]([a-zA-Z0-9_]+)\s*\(?/);
            if (inlineMatch) {
                const eventType = inlineMatch[1];
                const handlerName = inlineMatch[2];
                const idMatch = trimmed.match(/id=['"]([^'"]+)['"]/);
                const tagMatch = trimmed.match(/^<([a-zA-Z0-9]+)/);
                const targetElement = idMatch ? `${tagMatch ? tagMatch[1] : 'element'}#${idMatch[1]}` : (tagMatch ? tagMatch[1] : 'DOM Element');

                if (fnMap.has(handlerName)) {
                    fnMap.get(handlerName).calledBy = `${targetElement} onclick`;
                }
            }
        });
    },

    // --- REFACTOR TARGET 4: STATE MODEL STRICTNESS ---

    extractStateAndLocalVariables: function(lines, functions) {
        const stateModel = [];
        const localVariables = [];
        
        const tempVarNames = new Set(['i', 'j', 'k', 'e', 'err', 'event', 'tr', 'cells', 'rowtext', 'row', 'chk', 'li', 'label', 'reader', 'lines', 'trimmed', 'line', 'x', 'y', 'val', 'item', 'index', 'response', 'data', 'result']);

        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();

            if (trimmed.startsWith('let ') || trimmed.startsWith('var ') || trimmed.startsWith('const ')) {
                if (trimmed.includes('=>') || trimmed.includes('function')) return;

                const varDecl = trimmed.split('=')[0].replace(/(let|var|const)\s+/, '').trim();
                const varName = varDecl.split(':')[0].trim();

                if (varName && !varName.includes('(') && !varName.startsWith('//')) {
                    const containingFn = functions.find(f => lineNum >= f.startLine && lineNum <= f.endLine);
                    const lowerVar = varName.toLowerCase();

                    // STRICT FILTER: Only classify as application state if global scope OR explicitly shared/persisted
                    const isGlobal = !containingFn;
                    const isTemp = tempVarNames.has(lowerVar) || (containingFn && !isGlobal);

                    if (isTemp) {
                        localVariables.push({
                            name: varName,
                            scope: containingFn ? `${containingFn.name}()` : `Block Line ${lineNum}`,
                            purpose: `Temporary execution value (${varName})`
                        });
                    } else if (isGlobal) {
                        let type = "Unknown";
                        if (trimmed.includes('{}')) type = "Object";
                        else if (trimmed.includes('[]')) type = "Array";
                        else if (trimmed.includes('0') || trimmed.includes('length')) type = "Number";
                        else if (trimmed.includes("''") || trimmed.includes('""')) type = "String";

                        stateModel.push({
                            name: varName,
                            type: type,
                            purpose: `Stores global application state for ${varName}`,
                            lifecycle: `Declared at line ${lineNum} -> Accessed across module execution`
                        });
                    }
                }
            }
        });

        const fullCode = lines.join('\n');
        if (fullCode.includes('localStorage')) {
            stateModel.push({
                name: "localStorage",
                type: "Persistent Storage",
                purpose: "Persists application data across browser sessions",
                lifecycle: "Loaded on initialization -> Updated on state mutation"
            });
        }

        return { stateModel, localVariables };
    },

    // --- REFACTOR TARGET 5: TRIGGER MAP PRECISION ---

    extractTriggers: function(lines, fileKey, functions) {
        const triggers = [];
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();

            if (trimmed.includes('addEventListener(')) {
                const match = trimmed.match(/(?:document\.getElementById\(['"]([^'"]+)['"]\)|document\.querySelector\(['"]([^'"]+)['"]\)|(\$?[a-zA-Z0-9_]+))\s*\.\s*addEventListener\(['"]([^'"]+)['"]\s*,\s*(?:function\s*\([^)]*\)\s*\{?|([a-zA-Z0-9_]+))/);
                if (match) {
                    const targetEl = match[1] ? `#${match[1]}` : (match[2] || match[3] || "DOM Element");
                    const eventType = match[4] || "event";
                    const handlerName = match[5] || "Anonymous Handler";
                    triggers.push({
                        type: eventType,
                        source: `${fileKey}:${lineNum}`,
                        target: targetEl,
                        handler: `${handlerName}()`,
                        read: "DOM element attributes / input values",
                        sideEffect: "Triggers event callback execution -> Updates UI state"
                    });
                }
            } else if (trimmed.includes('onclick=') || trimmed.includes('onchange=') || trimmed.includes('onsubmit=')) {
                const typeMatch = trimmed.match(/on(click|change|submit|keyup|load)=/);
                const idMatch = trimmed.match(/id=['"]([^'"]+)['"]/);
                const tagMatch = trimmed.match(/^<([a-zA-Z0-9]+)/);
                const handlerMatch = trimmed.match(/on[a-z]+=['"]([a-zA-Z0-9_]+)\(?\)?['"]/);

                if (handlerMatch) {
                    const targetEl = idMatch ? `${tagMatch ? tagMatch[1] : 'element'}#${idMatch[1]}` : (tagMatch ? tagMatch[1] : 'DOM Element');
                    triggers.push({
                        type: typeMatch ? typeMatch[1] : "click",
                        source: `${fileKey}:${lineNum}`,
                        target: targetEl,
                        handler: `${handlerMatch[1]}()`,
                        read: "DOM input / selection state",
                        sideEffect: "Invokes handler -> Mutates view or network state"
                    });
                }
            }
        });
        return triggers;
    },

    // --- REFACTOR TARGET 1: LOSSLESS API CONTRACT EXTRACTION ---

    extractApiContracts: function(lines, fileKey, functions) {
        const contracts = [];
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();

            if (trimmed.includes('fetch(') || trimmed.includes('axios') || trimmed.includes('$.ajax')) {
                const match = trimmed.match(/(?:fetch|axios|\$.ajax)\s*\(\s*[`'"]([^`'"]+)[`'"]/);
                const endpoint = match ? match[1] : "/api/endpoint";
                const parentFn = functions.find(f => lineNum >= f.startLine && lineNum <= f.endLine);

                // Extract detected fields from nearby lines in function body if available
                const detectedFields = [];
                if (parentFn) {
                    const bodyLines = lines.slice(parentFn.startLine - 1, parentFn.endLine);
                    bodyLines.forEach(bl => {
                        const bt = bl.trim();
                        if (bt.includes(':') && !bt.startsWith('//') && !bt.includes('function')) {
                            const keyMatch = bt.match(/^([a-zA-Z0-9_]+)\s*:/);
                            if (keyMatch && !detectedFields.includes(keyMatch[1])) {
                                detectedFields.push(keyMatch[1]);
                            }
                        }
                    });
                }

                let requestText = "Unknown / Not detected";
                if (detectedFields.length > 0) {
                    requestText = "Detected fields:\n" + detectedFields.map(f => `- ${f}`).join('\n');
                }

                const responseText = trimmed.includes('.json()') || trimmed.includes('.then') 
                    ? "Consumed as JSON response\nUsed by:\n" + (parentFn ? `${parentFn.name}()` : "Global Scope")
                    : "Not detected";

                contracts.push({
                    method: trimmed.includes("POST") || trimmed.includes("method: 'POST'") ? "POST" : "GET",
                    endpoint: endpoint,
                    source: `${fileKey}:${lineNum}`,
                    calledBy: parentFn ? `${parentFn.name}()` : "Global Scope",
                    request: requestText,
                    response: responseText,
                    consumed: parentFn ? `Processed within ${parentFn.name}()` : "Global Scope execution"
                });
            }
        });
        return contracts;
    },

    buildCallGraph: function(functions) {
        const graph = [];
        functions.forEach(fn => {
            if (fn.calls.length > 0) {
                graph.push({
                    caller: `${fn.name}()`,
                    type: "Function Dependency",
                    calls: fn.calls.map(c => `${c}()`),
                    purpose: fn.purposeSummary
                });
            }
        });
        return graph;
    },

    extractErrorFlows: function(lines, functions) {
        const errors = [];
        lines.forEach((line, idx) => {
            if (line.includes('try {') || line.includes('.catch(')) {
                const lineNum = idx + 1;
                const parentFn = functions.find(f => lineNum >= f.startLine && lineNum <= f.endLine);
                errors.push({
                    source: parentFn ? `Function ${parentFn.name}() (Line ${lineNum})` : `Block at Line ${lineNum}`,
                    handler: "try/catch block / Promise error callback",
                    userEffect: "Displays error status or fails gracefully"
                });
            }
        });
        return errors;
    },

    buildMigrationAnchors: function(fileKey, lines, functions, apiContracts, triggers, stateModel) {
        const anchors = [];

        apiContracts.forEach(a => {
            anchors.push({
                source: a.source,
                category: "API_INTEGRATION",
                behavior: `Send payload/request to backend (${a.method} ${a.endpoint})`,
                dependency: a.calledBy,
                targetMigration: "React event handler + API service"
            });
        });

        triggers.forEach(t => {
            anchors.push({
                source: t.source,
                category: "UI_EVENT",
                behavior: `Handles ${t.type} interaction targeting ${t.target}`,
                dependency: t.handler,
                targetMigration: "React Synthetic Event / Hook"
            });
        });

        stateModel.forEach(s => {
            anchors.push({
                source: `${fileKey}:State`,
                category: "STATE_MANAGEMENT",
                behavior: `Manages state for ${s.name}`,
                dependency: "Global / Scope state",
                targetMigration: "useState / useReducer / Redux store"
            });
        });

        return anchors;
    },

    // --- LOSSLESS FORMATTER OUTPUT ---

    formatOutput: function(data) {
        let out = [];

        out.push("==================================================");
        out.push(`FILE:\n/${data.fileKey}\n`);
        out.push(`PURPOSE:\n${data.filePurpose}\n`);
        out.push(`ROLE:\n${data.fileRole}\n`);
        
        out.push("DEPENDENCY:");
        if (data.dependencies.length > 0) {
            data.dependencies.forEach(d => out.push(`- ${d}`));
        } else {
            out.push("- None");
        }
        out.push("");

        out.push("PUBLIC API / EXPORT:");
        if (data.functions.length > 0) {
            data.functions.forEach(f => out.push(`- ${f.name}()`));
        } else {
            out.push("- None");
        }
        out.push("");

        // SECTION: CODE INTENT
        out.push("CODE INTENT:\n");
        out.push(`Purpose:\n${data.codeIntent.purpose}\n`);
        out.push("Main Responsibilities:");
        data.codeIntent.responsibilities.forEach(r => out.push(`- ${r}`));
        out.push("\nImportant Behaviors:");
        data.codeIntent.behaviors.forEach(b => out.push(`- ${b}`));
        out.push("");

        out.push("SEMANTIC FUNCTION MAP:\n");
        if (data.functions.length > 0) {
            data.functions.forEach(f => {
                out.push(`FUNCTION:`);
                out.push(`NAME:\n${f.name}\n`);
                out.push(`LOCATION:\nLine ${f.startLine}-${f.endLine}\n`);
                out.push(`PURPOSE:\n${f.purposeSummary}\n`);
                out.push(`CONFIDENCE:\n${f.confidence}\n`);
                out.push("SOURCE SIGNAL:");
                out.push(`- Name: ${f.signals.name}`);
                out.push(`- DOM: ${f.signals.dom.length > 0 ? f.signals.dom.join(', ') : 'None'}`);
                out.push(`- API: ${f.signals.api.length > 0 ? f.signals.api.join(', ') : 'None'}`);
                out.push(`- State: ${f.signals.state.length > 0 ? f.signals.state.join(', ') : 'None'}`);
                out.push(`- Data processing: ${f.signals.dataProcessing.length > 0 ? f.signals.dataProcessing.join(', ') : 'None'}\n`);
                out.push(`READ:\n${f.read}\n`);
                out.push(`PROCESS:\n${f.process}\n`);
                out.push(`STATE CHANGE:\n${f.stateChange}\n`);
                out.push(`CALLS:\n${f.calls.length > 0 ? f.calls.join(', ') : 'None'}\n`);
                out.push(`CALLED BY:\n${f.calledBy}\n`);
                out.push(`OUTPUT:\n${f.output}\n`);
                out.push("--------------------------------------------------");
            });
        } else {
            out.push("None\n");
        }

        out.push("TRIGGER MAP:\n");
        if (data.triggers.length > 0) {
            data.triggers.forEach(t => {
                out.push("TRIGGER:\n");
                out.push(`TYPE:\n${t.type}\n`);
                out.push(`SOURCE:\n${t.source}\n`);
                out.push(`TARGET:\n${t.target}\n`);
                out.push(`HANDLER:\n${t.handler}\n`);
                out.push(`READ:\n${t.read}\n`);
                out.push(`SIDE EFFECT:\n${t.sideEffect}\n`);
            });
        } else {
            out.push("None\n");
        }

        out.push("DATA FLOW:");
        out.push("INPUT:\nUser Interactions / Uploaded Files / DOM Events\n");
        out.push("PROCESS:\nDeterministic Extraction / Parsing / String Transformations\n");
        out.push("OUTPUT:\nStructured Semantic Maps / Clipboard Copy / Text File Exports\n");

        out.push("STATE MODEL:\n");
        if (data.stateModel.length > 0) {
            data.stateModel.forEach(s => {
                out.push("STATE:\n");
                out.push(`NAME:\n${s.name}\n`);
                out.push(`TYPE:\n${s.type}\n`);
                out.push(`PURPOSE:\n${s.purpose}\n`);
                out.push(`LIFECYCLE:\n${s.lifecycle}\n`);
            });
        } else {
            out.push("Stateless / Transient DOM State\n");
        }

        out.push("LOCAL VARIABLE MAP:\n");
        if (data.localVariableMap.length > 0) {
            data.localVariableMap.forEach(v => {
                out.push("LOCAL VARIABLE:\n");
                out.push(`NAME:\n${v.name}\n`);
                out.push(`SCOPE:\n${v.scope}\n`);
                out.push(`PURPOSE:\n${v.purpose}\n`);
            });
        } else {
            out.push("None\n");
        }

        out.push("API CONTRACT:\n");
        if (data.apiContracts.length > 0) {
            data.apiContracts.forEach(a => {
                out.push("API CONTRACT:\n");
                out.push(`METHOD:\n${a.method}\n`);
                out.push(`ENDPOINT:\n${a.endpoint}\n`);
                out.push(`SOURCE:\n${a.source}\n`);
                out.push(`CALLED BY:\n${a.calledBy}\n`);
                out.push("REQUEST:\n" + a.request + "\n");
                out.push("RESPONSE:\n" + a.response + "\n");
                out.push(`CONSUMED:\n${a.consumed}\n`);
            });
        } else {
            out.push("None\n");
        }

        out.push("CALL GRAPH:\n");
        if (data.callGraph.length > 0) {
            data.callGraph.forEach(g => {
                out.push(`${g.caller}\n`);
                out.push(`TYPE:\n${g.type}\n`);
                out.push(`CALLS:\n${g.calls.join(', ')}\n`);
                out.push(`PURPOSE:\n${g.purpose}\n`);
            });
        } else {
            out.push("None\n");
        }

        out.push("ERROR FLOW:\n");
        if (data.errorFlows.length > 0) {
            data.errorFlows.forEach(e => {
                out.push(`ERROR SOURCE:\n${e.source}`);
                out.push(`HANDLER:\n${e.handler}`);
                out.push(`USER EFFECT:\n${e.userEffect}\n`);
            });
        } else {
            out.push("None\n");
        }

        out.push("MODEL / DATABASE MAP:\nNone\n");

        out.push("MIGRATION ANCHOR:\n");
        if (data.migrationAnchors.length > 0) {
            data.migrationAnchors.forEach(ma => {
                out.push("MIGRATION ANCHOR:\n");
                out.push(`SOURCE:\n${ma.source}\n`);
                out.push(`CATEGORY:\n${ma.category}\n`);
                out.push(`BEHAVIOR:\n${ma.behavior}\n`);
                out.push(`DEPENDENCY:\n${ma.dependency}\n`);
                out.push(`TARGET MIGRATION:\n${ma.targetMigration}\n`);
            });
        } else {
            out.push("None\n");
        }

        out.push("==================================================");

        return out.join('\n');
    }
};

// Global expose for browser script attachment
if (typeof window !== 'undefined') {
    window.Viber2Engine = Viber2Engine;
}
