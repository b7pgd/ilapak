/**
 * @LIR_ENGINE
 * @TYPE semantic_processor
 * @TARGET frontend_lir
 * @NOT_COMPONENT
 *
 * DEBUG LIR ENGINE - FRONTEND ADVANCED SEMANTIC ANALYZER (STAGE 2)
 * Advanced semantic mapper reading LIR output from Stage 1 (frontend.js).
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

    class FrontendAdvancedSemanticAnalyzer {
        /**
         * Helper Parser: Split file LIR Stage 1 secara aman berdasarkan delimiter FILE: atau DEBUG LIR
         */
        splitFileBlocks(rawLirText) {
            if (!rawLirText) return [];
            return rawLirText
                .split(/(?=FILE\s*:?\s*\n)/)
                .map(x => x.trim())
                .filter(Boolean);
        }

        /**
         * Helper Parser: Generic Section Parser untuk mengekstrak semua section LIR
         */
        parseSections(text) {
            const sections = {};
            const regex = /={10,}\n([^\n]+)\n={10,}\n([\s\S]*?)(?=\n={10,}|$)/g;

            let m;
            while ((m = regex.exec(text)) !== null) {
                sections[m[1].trim()] = m[2].trim();
            }

            return sections;
        }

        /**
         * Helper Parser: Parse Symbol Table khusus STATE / PROPS per baris
         */
        parseStates(symbolTable) {
            if (!symbolTable) return [];
            const lines = symbolTable.split('\n');
            const states = [];
            let inside = false;
            let currentVar = null;

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed === 'STATE:' || trimmed === 'VARIABLE:' || trimmed === 'STATE' || trimmed === 'VARIABLE') {
                    inside = true;
                    continue;
                }
                if (trimmed === 'PROPS:' || trimmed === 'FUNCTIONS:' || trimmed === 'IMPORTS:' || trimmed === 'PROPS' || trimmed === 'FUNCTIONS' || trimmed === 'IMPORTS') {
                    if (inside && (trimmed === 'PROPS:' || trimmed === 'PROPS')) {
                        // Lanjut jika masih ingin membaca props
                    } else {
                        inside = false;
                    }
                }

                if (!inside) continue;

                if (!trimmed.startsWith('type:')) {
                    currentVar = trimmed;
                } else if (trimmed.startsWith('type:') && currentVar) {
                    const typeVal = trimmed.replace('type:', '').trim();
                    states.push({
                        field: currentVar,
                        type: typeVal || 'string'
                    });
                    currentVar = null;
                }
            }

            return states;
        }

        /**
         * Helper Parser: Parse HTTP Block secara robust tanpa dependensi regex kaku
         */
        parseHttpBlock(httpText) {
            if (!httpText) return {};
            const lines = httpText.split('\n');
            const obj = {};
            let currentKey = '';

            const knownKeys = ['CALLER', 'TRIGGER', 'CONSUMER', 'HEADERS', 'ENDPOINT', 'METHOD', 'AUTHENTICATION', 'BODY', 'REQUEST', 'SOURCE', 'DEPENDENT STATE', 'RESPONSE'];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                let matchedKey = null;
                const firstWord = trimmed.split(/\s+/)[0].toUpperCase();

                if (trimmed.endsWith(':')) {
                    matchedKey = trimmed.slice(0, -1).toUpperCase();
                } else if (knownKeys.includes(trimmed.toUpperCase())) {
                    matchedKey = trimmed.toUpperCase();
                } else if (knownKeys.includes(firstWord)) {
                    matchedKey = firstWord;
                    const restValue = trimmed.slice(firstWord.length).trim();
                    obj[matchedKey.toLowerCase()] = restValue;
                    currentKey = matchedKey.toLowerCase();
                    continue;
                }

                if (matchedKey && knownKeys.includes(matchedKey)) {
                    currentKey = matchedKey.toLowerCase();
                    continue;
                }

                if (currentKey) {
                    obj[currentKey] = obj[currentKey] ? `${obj[currentKey]} ${trimmed}` : trimmed;
                } else if (!obj.request && (trimmed.startsWith('GET') || trimmed.startsWith('POST') || trimmed.startsWith('PUT') || trimmed.startsWith('DELETE') || trimmed.startsWith('PATCH'))) {
                    obj.request = trimmed;
                }
            }

            return obj;
        }

        /**
         * Helper Parser: Parse Failure Flow per baris
         */
        parseFlow(text) {
            if (!text) return [];
            return text
                .split('\n')
                .map(x => x.trim())
                .filter(x => x && x !== '↓' && x !== '->');
        }

        /**
         * Helper Parser: Extract UI Tree Nodes tanpa karakter pohon
         */
        parseUiTreeNodes(uiTreeText) {
            if (!uiTreeText) return [];
            return uiTreeText
                .split('\n')
                .map(x => x.replace(/[├└│─]/g, '').trim())
                .filter(x => x && x !== 'UI TREE:');
        }

        /**
         * Helper Parser: Extract Component Name from Symbol Table
         */
        extractComponent(symbolTable) {
            if (!symbolTable) return null;
            const m = symbolTable.match(/COMPONENT:\s*([\w$]+)/);
            return m ? m[1] + '()' : null;
        }

        /**
         * Helper Parser: Extract Path Parameters from Endpoint String
         */
        extractPathParams(endpoint) {
            if (!endpoint) return [];
            const matches = [
                ...endpoint.matchAll(/\$\{([^}]+)\}/g),
                ...endpoint.matchAll(/:([a-zA-Z0-9_$]+)/g),
                ...endpoint.matchAll(/\{([^}]+)\}/g)
            ];
            const found = new Set();
            const result = [];
            for (const m of matches) {
                if (!found.has(m[1])) {
                    found.add(m[1]);
                    result.push(m[1]);
                }
            }
            return result;
        }

        /**
         * Helper Parser: Extract Dependencies from DEPENDENCIES section
         */
        extractDependenciesAnalysis(lir) {
            const depsText = lir.dependencies || '';
            if (!depsText || depsText.includes('None') || depsText === 'Unknown') {
                return 'No external dependencies detected';
            }

            const lines = depsText.split('\n').map(x => x.trim()).filter(Boolean);
            const mappings = [];

            for (const line of lines) {
                if (line.includes('window.fetch') || line.includes('fetch()')) {
                    mappings.push(`${line} -> Migration Recommendation: Server Action / Route Handler / Axios Client`);
                } else if (line.includes('react')) {
                    mappings.push(`${line} -> Framework Dependency: Core React Client Hook`);
                } else {
                    mappings.push(`${line} -> Import Dependency`);
                }
            }

            return mappings.length > 0 ? mappings.join('\n') : depsText;
        }

        /**
         * Helper Parser: Extract Side Effects from SIDE EFFECTS section
         */
        extractSideEffectsAnalysis(lir) {
            const sideEffectsText = lir.sideEffects || '';
            if (!sideEffectsText || sideEffectsText.includes('None') || sideEffectsText === 'Unknown') {
                return 'No side effects detected';
            }

            const lines = sideEffectsText.split('\n').map(x => x.trim()).filter(Boolean);
            const results = [];

            for (const line of lines) {
                if (line.toLowerCase().includes('fetch') || line.toLowerCase().includes('http') || line.toLowerCase().includes('network')) {
                    results.push(`${line} ↓ External Network Dependency`);
                } else if (line.toLowerCase().includes('set') || line.toLowerCase().includes('state')) {
                    results.push(`${line} ↓ State Mutation Risk`);
                } else {
                    results.push(`${line} ↓ Side Effect Execution`);
                }
            }

            return results.length > 0 ? results.join('\n') : sideEffectsText;
        }

        /**
         * Helper Parser: Semantic Failure Points breakdown
         */
        extractSemanticFailurePoints(lir) {
            const failureText = lir.failurePoints || '';
            const flows = this.parseFlow(failureText);

            if (flows.length === 0) {
                return {
                    networkFailure: 'fetch() failure / Network Error',
                    dataFailure: 'Unexpected Response Schema / Contract Mismatch',
                    uiFailure: 'State Update Failure / UI Not Updated'
                };
            }

            let networkFailure = 'N/A';
            let dataFailure = 'N/A';
            let uiFailure = 'N/A';

            for (const item of flows) {
                const lower = item.toLowerCase();
                if (lower.includes('network') || lower.includes('http') || lower.includes('call') || lower.includes('fetch')) {
                    networkFailure = item;
                } else if (lower.includes('contract') || lower.includes('schema') || lower.includes('mismatch') || lower.includes('data') || lower.includes('response')) {
                    dataFailure = item;
                } else if (lower.includes('state') || lower.includes('ui') || lower.includes('render') || lower.includes('update')) {
                    uiFailure = item;
                }
            }

            return {
                networkFailure: networkFailure !== 'N/A' ? networkFailure : (flows[0] || 'fetch() failure'),
                dataFailure: dataFailure !== 'N/A' ? dataFailure : (flows[1] || 'Response Schema Mismatch'),
                uiFailure: uiFailure !== 'N/A' ? uiFailure : (flows[2] || 'UI State Failure')
            };
        }

        /**
         * Helper Parser: Generate State Transition Graph
         */
        extractStateTransitionGraph(lir) {
            const stateFlowText = lir.stateFlow || '';
            if (!stateFlowText || stateFlowText.includes('None') || stateFlowText === 'Unknown') {
                return 'No state transitions detected';
            }

            const lines = stateFlowText.split('\n').map(x => x.trim()).filter(Boolean);
            const transitions = [];

            for (const line of lines) {
                const transitionMatch = line.match(/([a-zA-Z0-9_$]+)\s*(?:initial\s*:?\s*)?([^\s↓|]+)?\s*↓?\s*(set[A-Z]\w*\(?\)?)\s*↓?\s*(.*)/);
                if (transitionMatch) {
                    const varName = transitionMatch[1];
                    const initialVal = transitionMatch[2] || 'initial';
                    const setter = transitionMatch[3];
                    const nextVal = transitionMatch[4] || 'rerender';
                    transitions.push(`${varName}: ${initialVal} | ${setter} | ${nextVal} | rerender`);
                } else {
                    transitions.push(line);
                }
            }

            return transitions.length > 0 ? transitions.join('\n') : stateFlowText;
        }

        /**
         * Process stage 1 LIR input and produce advanced semantic analysis output appended to original LIR.
         * @param {Object|string} lirInput - Standard LIR context or raw output string from frontend.js
         */
        analyzeLir(lirInput) {
            const isObjectCtx = typeof lirInput === 'object' && lirInput !== null;
            const rawLirText = isObjectCtx ? (lirInput.finalOutput || '') : (typeof lirInput === 'string' ? lirInput : '');
            
            const fileBlocks = this.splitFileBlocks(rawLirText);
            const semanticLayers = [];

            for (const block of fileBlocks) {
                if (!block.trim()) continue;
                const parsedLir = this.parseLirText(block);
                
                const httpContract = this.extractHttpContract(parsedLir);
                const requestSchema = this.extractRequestSchema(parsedLir);
                const expectedResponseSchema = this.extractExpectedResponseSchema(parsedLir);
                const apiConsumerMapping = this.extractApiConsumerMapping(parsedLir);

                const dependenciesAnalysis = this.extractDependenciesAnalysis(parsedLir);
                const sideEffectsAnalysis = this.extractSideEffectsAnalysis(parsedLir);
                const semanticFailures = this.extractSemanticFailurePoints(parsedLir);
                const stateTransitionGraph = this.extractStateTransitionGraph(parsedLir);

                semanticLayers.push({
                    file: parsedLir.file,
                    httpContract,
                    requestSchema,
                    expectedResponseSchema,
                    apiConsumerMapping,
                    dependenciesAnalysis,
                    sideEffectsAnalysis,
                    stateTransitionGraph,
                    failureBreakdown: semanticFailures
                });
            }

            if (isObjectCtx) {
                return {
                    ...lirInput,
                    finalOutput: rawLirText,
                    semanticLayers
                };
            }

            return {
                finalOutput: rawLirText,
                semanticLayers
            };
        }

        /**
         * Parse raw LIR structured text back into a queryable semantic Object model.
         */
        parseLirText(lirText) {
            const sections = this.parseSections(lirText);

            const getValue = (key) => {
                // Skenario 1: KEY: value
                let m = lirText.match(new RegExp(`${key}:(?:\\n|\\s+)([^\\n]+)`));
                if (m) return m[1].trim();

                // Skenario 2: KEY\nvalue
                m = lirText.match(new RegExp(`(?:^|\\n)${key}\\n([^\\n]+)`));
                if (m) return m[1].trim();

                return 'Unknown';
            };

            return {
                file: getValue('FILE'),
                framework: getValue('FRAMEWORK'),
                type: getValue('TYPE'),
                purpose: getValue('PURPOSE'),
                symbolTable: sections['SYMBOL TABLE'] || '',
                uiTree: sections['UI TREE'] || '',
                entryPoints: sections['ENTRY POINTS'] || '',
                executionFlow: sections['EXECUTION FLOW'] || '',
                stateFlow: sections['STATE FLOW'] || '',
                reads: sections['READS'] || '',
                writes: sections['WRITES'] || '',
                http: sections['HTTP'] || '',
                dependencies: sections['DEPENDENCIES'] || '',
                sideEffects: sections['SIDE EFFECTS'] || '',
                failurePoints: sections['FAILURE POINTS'] || '',
                exitPath: sections['EXIT PATH'] || ''
            };
        }

        // ==================================================
        // 1. HTTP CONTRACT ANALYSIS
        // ==================================================
        extractHttpContract(lir) {
            const httpContent = lir.http;

            if (!httpContent) {
                return {
                    endpoint: 'HTTP Parsing Failed',
                    method: 'Unknown',
                    trigger: 'N/A',
                    caller: 'N/A',
                    consumer: 'N/A',
                    source: 'N/A',
                    dependentState: 'N/A',
                    responseContract: 'N/A',
                    authentication: 'N/A',
                    headers: 'N/A',
                    body: 'N/A',
                    expectedStatus: 'N/A',
                    failurePath: 'N/A'
                };
            }

            if (httpContent.includes('None detected') || httpContent.includes('None / Local')) {
                return {
                    endpoint: 'None / Local Component Logic Only',
                    method: 'N/A',
                    trigger: 'N/A',
                    caller: 'N/A',
                    consumer: 'N/A',
                    source: 'N/A',
                    dependentState: 'N/A',
                    responseContract: 'N/A',
                    authentication: 'N/A',
                    headers: 'N/A',
                    body: 'None',
                    expectedStatus: 'N/A',
                    failurePath: 'N/A'
                };
            }

            const httpObj = this.parseHttpBlock(httpContent);

            let method = 'GET';
            let endpoint = 'Unknown Endpoint';

            if (httpObj.request) {
                const parts = httpObj.request.split(/\s+/);
                if (parts.length >= 2) {
                    method = parts[0].toUpperCase();
                    endpoint = parts[1];
                }
            } else {
                const methodMatch = httpContent.match(/(GET|POST|PUT|DELETE|PATCH)\s+([^\s\n]+)/i);
                if (methodMatch) {
                    method = methodMatch[1].toUpperCase();
                    endpoint = methodMatch[2];
                }
            }

            const caller = httpObj.caller || 'Inline / Global';
            const trigger = httpObj.trigger || 'User Action';
            const consumer = httpObj.consumer || 'None';
            const source = httpObj.source || 'fetch()';
            const dependentState = httpObj['dependent state'] || httpObj.consumer || 'None';
            const responseContract = httpObj.response || 'Unknown Response Schema';
            const headers = httpObj.headers || 'Content-Type: application/json';

            const hasAuth = headers.toLowerCase().includes('authorization') || lir.symbolTable.toLowerCase().includes('token');
            const authentication = hasAuth ? 'Bearer Token (Present in Session/Headers)' : 'None Required / Public';

            const failureFlow = this.parseFlow(lir.failurePoints);
            const failurePath = failureFlow.length > 0 ? failureFlow.join(' -> ') : 'Network Error -> Error Toast / Fallback State';

            return {
                endpoint,
                method,
                trigger,
                caller,
                consumer,
                source,
                dependentState,
                responseContract,
                authentication,
                headers: headers !== 'Unknown' ? headers : 'Content-Type: application/json',
                body: ['POST', 'PUT', 'PATCH'].includes(method) ? 'Inferred JSON Payload' : 'None',
                expectedStatus: method === 'POST' ? '201 Created / 200 OK' : '200 OK',
                failurePath
            };
        }

        // ==================================================
        // 2. REQUEST SCHEMA INFERENCE
        // ==================================================
        extractRequestSchema(lir) {
            const httpContent = lir.http;
            const httpObj = this.parseHttpBlock(httpContent);
            
            let method = 'GET';
            let endpoint = '';
            if (httpObj.request) {
                const parts = httpObj.request.split(/\s+/);
                method = parts[0].toUpperCase();
                endpoint = parts[1] || '';
            } else {
                const methodMatch = httpContent.match(/(GET|POST|PUT|DELETE|PATCH)\s*([^\s\n]*)/i);
                if (methodMatch) {
                    method = methodMatch[1].toUpperCase();
                    endpoint = methodMatch[2] || '';
                }
            }

            if (['GET', 'DELETE'].includes(method)) {
                const pathParams = this.extractPathParams(endpoint);
                const fields = [];

                if (pathParams.length > 0) {
                    pathParams.forEach(param => {
                        fields.push({ field: param, type: 'path parameter', required: 'Yes' });
                    });
                } else {
                    fields.push({ field: 'queryParams / pathParams', type: 'string / number', required: 'Optional' });
                }

                return {
                    contentType: 'N/A (No Request Body)',
                    fields
                };
            }

            const parsedStates = this.parseStates(lir.symbolTable);
            const fields = [];

            for (const item of parsedStates) {
                if (!item.field.toLowerCase().includes('loading') && !item.field.toLowerCase().includes('error')) {
                    fields.push({
                        field: item.field,
                        type: item.type,
                        required: 'Yes'
                    });
                }
            }

            if (fields.length === 0) {
                fields.push({ field: 'payload', type: 'object', required: 'Inferred Payload' });
            }

            return {
                contentType: 'application/json',
                fields
            };
        }

        // ==================================================
        // 3. EXPECTED RESPONSE SCHEMA INFERENCE
        // ==================================================
        extractExpectedResponseSchema(lir) {
            const fields = [];
            const added = new Set();

            const sources = [
                { text: lir.stateFlow, name: 'STATE FLOW' },
                { text: lir.http, name: 'HTTP' },
                { text: lir.symbolTable, name: 'SYMBOL TABLE' },
                { text: lir.executionFlow, name: 'EXECUTION FLOW' }
            ];

            for (const src of sources) {
                if (!src.text) continue;
                
                const dotMatches = src.text.matchAll(/data\.([a-zA-Z0-9_]+)/g);
                for (const dm of dotMatches) {
                    const fieldName = dm[1];
                    if (!added.has(fieldName)) {
                        added.add(fieldName);

                        let targetSetter = null;
                        let targetStateVar = null;
                        const setterMatch = src.text.match(new RegExp(`data\\.${fieldName}[\\s\\S]*?(set([A-Z]\\w*))`));
                        if (setterMatch) {
                            targetSetter = setterMatch[1] + '()';
                            const rawState = setterMatch[2];
                            targetStateVar = rawState.charAt(0).toLowerCase() + rawState.slice(1);
                        }

                        let flowDesc = `Inferred from data.${fieldName} (${src.name})`;
                        if (targetSetter && targetStateVar) {
                            flowDesc = `data.${fieldName} ↓ ${targetSetter} ↓ ${targetStateVar}`;
                        }

                        fields.push({ field: fieldName, type: 'string', inferred: flowDesc });
                    }
                }

                const matches = src.text.matchAll(/([a-zA-Z0-9_$]+)\s*:\s*([a-zA-Z0-9_$<>]+)/g);
                for (const m of matches) {
                    const varName = m[1];
                    const type = m[2];

                    if ((varName.toLowerCase().includes('data') || varName.toLowerCase().includes('list') || varName.toLowerCase().includes('user') || varName.toLowerCase().includes('item') || varName.toLowerCase().includes('response')) && !added.has(varName)) {
                        added.add(varName);
                        fields.push({ field: varName, type: type === 'array' ? 'Array<Object>' : (type || 'Object'), inferred: `UI Data Payload (${src.name})` });
                    }
                }
            }

            if (fields.length === 0) {
                const httpObj = this.parseHttpBlock(lir.http);
                const consumerState = httpObj.consumer || httpObj['dependent state'];

                if (consumerState && consumerState !== 'None' && consumerState !== 'Unknown') {
                    const setterName = 'set' + consumerState.charAt(0).toUpperCase() + consumerState.slice(1) + '()';
                    const targetComponent = this.extractComponent(lir.symbolTable) || 'Component';
                    fields.push({
                        field: `EXPECTED PAYLOAD CONSUMER: API RESPONSE ↓ ${setterName} ↓ ${consumerState} state ↓ ${targetComponent} rerender`,
                        type: 'Semantic Flow',
                        inferred: 'Inferred via HTTP Consumer & State Flow'
                    });
                } else {
                    fields.push({ field: 'INFERENCE', type: 'N/A', inferred: 'No explicit response schema detected' });
                }
            }

            return {
                expectedType: 'application/json',
                fields
            };
        }

        // ==================================================
        // 4. API CONSUMER MAPPING
        // ==================================================
        extractApiConsumerMapping(lir) {
            const httpContent = lir.http;
            const httpObj = this.parseHttpBlock(httpContent);

            let api = 'N/A (No External API)';
            if (httpObj.request) {
                api = httpObj.request;
            } else {
                const methodMatch = httpContent.match(/(GET|POST|PUT|DELETE|PATCH)\s+([^\s\n]+)/i);
                if (methodMatch) {
                    api = `${methodMatch[1].toUpperCase()} ${methodMatch[2]}`;
                }
            }

            const fnCaller = httpObj.caller || 'Unknown Function / Action';
            
            let targetState = httpObj.consumer;
            if (!targetState || targetState === 'None') {
                const stateFlowMatch = lir.stateFlow.match(/set([A-Z]\w*)/) || lir.executionFlow.match(/set([A-Z]\w*)/);
                if (stateFlowMatch) {
                    const rawState = stateFlowMatch[1];
                    targetState = rawState.charAt(0).toLowerCase() + rawState.slice(1);
                } else {
                    targetState = 'Unmapped State';
                }
            }

            const targetComponent = this.extractComponent(lir.symbolTable) || 'Unknown Component';

            const uiNodes = this.parseUiTreeNodes(lir.uiTree);
            let uiRenderConsumer = 'Unmapped Component';

            for (const node of uiNodes) {
                if (node.includes('Table') || node.includes('Header') || node.includes('Button') || node.includes('Control') || node.includes('Form')) {
                    uiRenderConsumer = node;
                    break;
                }
            }

            if (uiRenderConsumer === 'Unmapped Component' && targetComponent !== 'Unknown Component') {
                uiRenderConsumer = targetComponent;
            }

            let nextFlow = '';
            const setterName = 'set' + targetState.charAt(0).toUpperCase() + targetState.slice(1) + '()';
            if (targetState !== 'Unmapped State') {
                nextFlow = `${setterName} ↓ Component Rerender`;
            }

            const mappingChain = [
                `API: ${api}`,
                `FUNCTION: ${fnCaller}`,
                `STATE: ${targetState}`,
                `TARGET COMPONENT: ${targetComponent}`,
                `RENDER CONSUMER: ${uiRenderConsumer}`
            ];

            if (nextFlow) {
                mappingChain.push(`NEXT FLOW: ${nextFlow}`);
            }

            return {
                api,
                callerFunction: fnCaller,
                targetState,
                targetComponent,
                uiConsumer: uiRenderConsumer,
                nextFlow,
                chainFlow: mappingChain.join('\n  ↓\n')
            };
        }

        /**
         * Format all Stage 2 semantic analysis results into strict header output.
         */
        formatOutput(data) {
            const hc = data.httpContract;
            const rs = data.requestSchema;
            const ers = data.expectedResponseSchema;
            const acm = data.apiConsumerMapping;
            const sf = data.semanticFailures;

            const reqFieldsStr = rs.fields.map(f => `  - ${f.field} (${f.type}) | Required: ${f.required}`).join('\n');
            const resFieldsStr = ers.fields.map(f => `  - ${f.field}: ${f.type} [${f.inferred}]`).join('\n');

            return [
                '==================================================',
                'ADVANCED SEMANTIC MAPPER (STAGE 2)',
                '==================================================',
                '',
                'FILE',
                data.filePath,
                '',
                '==================================================',
                'HTTP CONTRACT',
                '==================================================',
                '',
                `ENDPOINT: ${hc.endpoint}`,
                `METHOD: ${hc.method}`,
                `TRIGGER: ${hc.trigger}`,
                `CALLER: ${hc.caller}`,
                `CONSUMER: ${hc.consumer}`,
                `SOURCE: ${hc.source}`,
                `DEPENDENT STATE: ${hc.dependentState}`,
                `RESPONSE CONTRACT: ${hc.responseContract}`,
                `AUTHENTICATION: ${hc.authentication}`,
                `HEADERS: ${hc.headers}`,
                `BODY: ${hc.body}`,
                `EXPECTED STATUS: ${hc.expectedStatus}`,
                `FAILURE PATH: ${hc.failurePath}`,
                '',
                '==================================================',
                'REQUEST SCHEMA',
                '==================================================',
                '',
                `CONTENT-TYPE: ${rs.contentType}`,
                '',
                'FIELDS:',
                reqFieldsStr,
                '',
                '==================================================',
                'EXPECTED RESPONSE SCHEMA',
                '==================================================',
                '',
                `EXPECTED TYPE: ${ers.expectedType}`,
                '',
                'FIELDS / PAYLOAD:',
                resFieldsStr,
                '',
                '==================================================',
                'API CONSUMER MAPPING',
                '==================================================',
                '',
                'DEPENDENCY FLOW:',
                `  ${acm.chainFlow}`,
                '',
                '==================================================',
                'SIDE EFFECTS & DEPENDENCIES',
                '==================================================',
                '',
                'DEPENDENCIES ANALYSIS:',
                data.dependenciesAnalysis,
                '',
                'SIDE EFFECT ANALYSIS:',
                data.sideEffectsAnalysis,
                '',
                '==================================================',
                'STATE TRANSITION GRAPH',
                '==================================================',
                '',
                data.stateTransitionGraph,
                '',
                '==================================================',
                'FAILURE BREAKDOWN',
                '==================================================',
                '',
                `NETWORK FAILURE: ${sf.networkFailure}`,
                `DATA FAILURE: ${sf.dataFailure}`,
                `UI FAILURE: ${sf.uiFailure}`,
                '',
                '=================================================='
            ].join('\n');
        }
    }

    const analyzer = new FrontendAdvancedSemanticAnalyzer();

    // Register Stage 2 Engine in global registry
    window.LirEngineRegistry.registerStage('frontend_semantic_mapper', async function (ctx) {
        // ctx is the LIR output received from stage 1 (frontend.js)
        return analyzer.analyzeLir(ctx);
    });

    // Support direct execution/fallback
    window.FrontendAdvancedSemanticAnalyzer = FrontendAdvancedSemanticAnalyzer;
})();
