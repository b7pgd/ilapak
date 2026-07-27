/**
 * DEBUG LIR ENGINE - FRONTEND EXTRACTOR
 * Static analysis engine for frontend source code parsing.
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

    class FrontendDebugLirExtractor {
        constructor() {
            this.fileContexts = [];
        }

        async processFiles(projectFiles, selectedFiles) {
            const results = [];
            for (const path of selectedFiles) {
                const fileObj = projectFiles[path];
                if (!fileObj) continue;

                let content = '';
                try {
                    content = await fileObj.text();
                } catch (e) {
                    content = '';
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
            const purpose = this.inferPurpose(filePath, code, fileType);

            // Internal Symbol & Structure Analysis (Stage 1: Build Symbol Table)
            const symbolModel = this.buildSymbolModel(code, filePath, fileType);
            
            // Stage 2: Semantic Extraction
            const entryPoints = this.extractEntryPoints(code, ext, symbolModel);
            const executionFlow = this.extractExecutionFlow(code, symbolModel);
            const reads = this.extractReads(code, symbolModel);
            const writes = this.extractWrites(code, symbolModel);
            const http = this.extractHttpCalls(code, symbolModel);
            const dependencies = this.extractDependencies(code, symbolModel);
            const failurePoints = this.extractFailurePoints(code, symbolModel);
            const exitPaths = this.extractExitPaths(code, symbolModel);

            return {
                filePath,
                fileType,
                purpose,
                symbolModel,
                entryPoints,
                executionFlow,
                reads,
                writes,
                http,
                dependencies,
                failurePoints,
                exitPaths
            };
        }

        getFileExtension(filePath) {
            const parts = filePath.split('.');
            return parts.length > 1 ? parts.pop().toLowerCase() : '';
        }

        detectFileType(path, code, ext) {
            const p = path.toLowerCase();
            if (ext === 'html' || ext === 'htm') return 'HTML Document / Template';
            if (ext === 'vue') return 'Vue Single File Component';
            if (ext === 'svelte') return 'Svelte Component';
            if (ext === 'astro') return 'Astro Component';
            if (ext === 'css' || ext === 'scss' || ext === 'less') return 'Stylesheet';

            if (p.includes('next.config') || p.includes('vite.config') || p.includes('nuxt.config') || p.includes('astro.config')) {
                return 'Frontend Configuration';
            }

            if (code.includes('import React') || code.includes('from "react"') || code.includes("from 'react'") || ext === 'jsx' || ext === 'tsx') {
                if (p.includes('page') || p.includes('screen') || p.includes('views') || p.includes('app/')) return 'React Page View Component';
                if ((p.includes('use') || /use[A-Z]\w+/.test(code)) && !code.includes('return <') && !code.includes('return (')) return 'React Hook / Custom Hook';
                if (p.includes('context') || code.includes('createContext')) return 'React Context Provider';
                return 'React Component';
            }

            if (code.includes('defineComponent') || code.includes('ref(') || code.includes('reactive(') || code.includes('createApp')) {
                return 'Vue Script Module';
            }

            if (code.includes('@Component') || code.includes('@Injectable') || code.includes('@NgModule')) {
                return 'Angular Decorator Module / Service';
            }

            if (code.includes('createSignal') || code.includes('createEffect')) {
                return 'SolidJS Reactive Module';
            }

            if (p.includes('store') || p.includes('redux') || p.includes('slice') || p.includes('pinia') || p.includes('zustand')) {
                return 'State Management Store';
            }

            if (p.includes('router') || p.includes('routes') || code.includes('createBrowserRouter') || code.includes('vue-router')) {
                return 'Client Router Setup';
            }

            if (p.includes('api') || p.includes('service') || p.includes('client')) {
                return 'Frontend Service / API Client';
            }

            return 'JavaScript / TypeScript Module';
        }

        inferPurpose(path, code, fileType) {
            const p = path.toLowerCase();
            if (p.includes('login')) return 'User Authentication & Login View';
            if (p.includes('dashboard')) return 'Main User Dashboard & Summary Metrics';
            if (p.includes('profile')) return 'User Profile & Account Settings Management';
            if (p.includes('label')) return 'Label Management & Batch Operations';
            if (p.includes('setting')) return 'Application Settings & Configuration';
            if (p.includes('auth')) return 'Authentication & Authorization Handler';

            const lines = code.split('\n');
            let docComment = '';
            for (let i = 0; i < Math.min(lines.length, 15); i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
                    docComment += line.replace(/[\/\*]/g, '').trim() + ' ';
                }
            }
            if (docComment.trim().length > 5) {
                return docComment.trim();
            }

            const fileName = path.split('/').pop();
            return `Provides ${fileType} logic for handling components, reactivity, UI events, and DOM state within ${fileName}.`;
        }

        buildSymbolModel(code, filePath, fileType) {
            const functions = {};
            const stateMap = {}; // setter -> state variable
            const stateVars = [];
            const propsVars = [];
            const storageReads = new Set();
            const storageWrites = new Set();
            const navWrites = new Set();
            const jsxEvents = [];
            const apiEndpoints = new Set();
            const sideEffects = new Set();
            const jsxStructure = [];

            // Framework & Component Metadata Extraction
            let framework = 'React / Standard JS';
            if (code.includes('next/') || filePath.includes('app/') || filePath.includes('pages/')) {
                framework = 'Next.js App Router';
            } else if (filePath.endsWith('.vue')) {
                framework = 'Vue.js Framework';
            }

            let mainComponent = 'AnonymousComponent';
            const exportDefaultMatch = code.match(/export\s+default\s+(?:function\s+)?([a-zA-Z0-9_$]+)/);
            if (exportDefaultMatch) {
                mainComponent = `${exportDefaultMatch[1]}()`;
            } else {
                const fnMatch = code.match(/(?:function|const)\s+([A-Z][a-zA-Z0-9_$]*)/);
                if (fnMatch) mainComponent = `${fnMatch[1]}()`;
            }

            const exportType = code.includes('export default') ? 'default' : (code.includes('export ') ? 'named' : 'none');
            const isClientComponent = code.includes('"use client"') || code.includes("'use client'") ? 'Yes' : 'No';

            // Extract useState pairings & Infer Types: const [state, setState] = useState(...)
            const stateMatches = code.matchAll(/const\s*\[\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)\s*\]\s*=\s*useState(?:<([^>]+)>)?\(([^)]*)\)/g);
            for (const m of stateMatches) {
                const varName = m[1];
                const setter = m[2];
                const typeAnnotation = m[3];
                const initialVal = m[4] ? m[4].trim() : '';

                let inferredType = 'any';
                if (typeAnnotation) {
                    inferredType = typeAnnotation;
                } else if (initialVal === 'true' || initialVal === 'false') {
                    inferredType = 'boolean';
                } else if (!isNaN(Number(initialVal)) && initialVal !== '') {
                    inferredType = 'number';
                } else if (initialVal.startsWith('"') || initialVal.startsWith("'") || initialVal.startsWith('`')) {
                    inferredType = 'string';
                } else if (initialVal.startsWith('[')) {
                    inferredType = 'array';
                } else if (initialVal.startsWith('{')) {
                    inferredType = 'object';
                }

                stateVars.push({ varName, setter, inferredType, initialVal });
                stateMap[setter] = varName;
            }

            // Extract Strict Props Variables (Avoid ...prev or array index destructuring)
            const propDestruct = code.matchAll(/(?:const\s*\{([^}]+)\}\s*=\s*props|\(\s*\{([^}]+)\}\s*(?::\s*[^)]+)?\s*\))/g);
            for (const m of propDestruct) {
                const raw = m[1] || m[2];
                if (raw) {
                    raw.split(',').forEach(p => {
                        const clean = p.trim().split(':')[0].trim();
                        if (clean && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(clean) && !clean.startsWith('//') && !clean.startsWith('...')) {
                            propsVars.push(clean);
                        }
                    });
                }
            }

            // Extract Storage & Nav symbols & Side Effects
            if (code.includes('fetch(') || code.includes('axios')) sideEffects.add('fetch()');
            if (code.includes('localStorage')) sideEffects.add('localStorage');
            if (code.includes('router.push') || code.includes('navigate')) sideEffects.add('router.push()');
            if (code.includes('setTimeout')) sideEffects.add('setTimeout');
            if (code.includes('console.log') || code.includes('console.error')) sideEffects.add('console');

            const localReads = code.matchAll(/(?:localStorage|sessionStorage)\.getItem\s*\(\s*["']([^"']+)["']\s*\)/g);
            for (const m of localReads) storageReads.add(m[1]);

            const localWrites = code.matchAll(/(?:localStorage|sessionStorage)\.setItem\s*\(\s*["']([^"']+)["']\s*,/g);
            for (const m of localWrites) storageWrites.add(m[1]);

            const navMatches = code.matchAll(/(?:router\.push|router\.replace|navigate)\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/g);
            for (const m of navMatches) navWrites.add(m[1]);

            // Extract Route/API
            const apiMatch = code.matchAll(/(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*["'`]/g);
            const urlMatches = code.matchAll(/(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*["'`]([^"'`]+)["'`]/g);
            for (const m of urlMatches) apiEndpoints.add(m[1]);

            // Extract JSX Event Source & UI Layout Elements
            const jsxTagRegex = /<([a-zA-Z0-9_$]+)([^>]*?)>(.*?)<\/\1>|<(button|input|form|table|div|header|main)([^>]*?)\/?>/gs;
            let tagMatch;
            while ((tagMatch = jsxTagRegex.exec(code)) !== null) {
                const tagName = tagMatch[1] || tagMatch[4];
                const attrs = tagMatch[2] || tagMatch[5] || '';
                const innerText = (tagMatch[3] || '').replace(/<[^>]*>/g, '').trim();

                if (['input', 'table', 'button', 'form', 'toolbar', 'header', 'main', 'div', 'tr', 'td', 'th', 'section'].includes(tagName.toLowerCase())) {
                    const cleanName = innerText ? `${innerText} (${tagName})` : tagName;
                    if (!jsxStructure.includes(cleanName)) jsxStructure.push(cleanName);
                }

                const eventMatch = attrs.match(/(onClick|onSubmit|onChange)\s*=\s*\{?\s*([a-zA-Z0-9_$]+)\s*\}?/);
                if (eventMatch) {
                    const eventType = eventMatch[1];
                    const handler = eventMatch[2];
                    
                    let typeAttr = '';
                    const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/);
                    if (typeMatch) typeAttr = typeMatch[1];

                    let sourceName = innerText || typeAttr || tagName;
                    if (tagName.toLowerCase() === 'button' || typeAttr === 'submit') {
                        sourceName = innerText ? `${innerText} Button` : 'Submit Button';
                    } else if (tagName.toLowerCase() === 'form') {
                        sourceName = 'Form';
                    }

                    jsxEvents.push({
                        eventType,
                        handler,
                        sourceName,
                        tag: tagName
                    });
                }
            }

            // Function Statement-by-Statement Walk Definition
            const fnRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\}/g;
            let match;
            while ((match = fnRegex.exec(code)) !== null) {
                const fnName = match[1] || match[4];
                const fnBody = match[3] || match[6];
                if (fnName && fnBody) {
                    const statements = [];
                    const lines = fnBody.split('\n');
                    for (const line of lines) {
                        const l = line.trim();
                        if (!l || l.startsWith('//')) continue;

                        if (l.includes('validate') || l.includes('check')) statements.push('Validate Form');
                        else if (l.includes('body') || l.includes('JSON.stringify') || l.includes('payload')) statements.push('Build Request Body');
                        else if (l.includes('fetch') || l.includes('axios')) statements.push('Network Request');
                        else if (l.includes('res.json()') || l.includes('response.data')) statements.push('Receive Response');
                        else if (l.includes('setItem')) statements.push('Save Token');
                        else if (l.includes('router.push') || l.includes('navigate')) statements.push('Redirect Dashboard');
                        else {
                            const callMatch = l.match(/([a-zA-Z0-9_$]+)\s*\(/);
                            if (callMatch && !['if', 'for', 'while', 'switch', 'catch', 'function', 'console'].includes(callMatch[1])) {
                                statements.push(`${callMatch[1]}()`);
                            }
                        }
                    }
                    functions[fnName] = { body: fnBody, statements };
                }
            }

            return { 
                framework, 
                mainComponent, 
                exportType, 
                isClientComponent, 
                functions, 
                stateMap, 
                stateVars, 
                propsVars, 
                storageReads, 
                storageWrites, 
                navWrites, 
                jsxEvents, 
                apiEndpoints, 
                sideEffects, 
                jsxStructure 
            };
        }

        extractEntryPoints(code, ext, symbolModel) {
            const pageLoad = [];
            const userActions = [];

            // PAGE LOAD / Lifecycle
            const reactHooks = ['useEffect', 'useLayoutEffect'];
            reactHooks.forEach(hook => {
                if (code.includes(`${hook}(`)) pageLoad.push(`${hook}()`);
            });
            if (code.includes('DOMContentLoaded')) pageLoad.push('DOMContentLoaded');
            if (code.includes('window.onload')) pageLoad.push('window.onload');
            if (code.includes('onMounted')) pageLoad.push('onMounted');
            if (code.includes('ngOnInit')) pageLoad.push('ngOnInit');

            // USER ACTIONS WITH EVENT SOURCE (Tag, Event, Handler)
            if (symbolModel.jsxEvents.length > 0) {
                symbolModel.jsxEvents.forEach(evt => {
                    userActions.push(`${evt.sourceName}\n  ↓\n${evt.handler}()`);
                });
            } else {
                const eventAttrMatches = code.matchAll(/(onClick|onSubmit|onChange)\s*=\s*\{?\s*([a-zA-Z0-9_$]+)\s*\}?/g);
                for (const match of eventAttrMatches) {
                    const eventType = match[1];
                    const handler = match[2];
                    let label = eventType === 'onSubmit' ? 'Submit Button' : 'User Action';
                    userActions.push(`${label}\n  ↓\n${handler}()`);
                }
            }

            const res = [];
            if (pageLoad.length > 0) {
                res.push(`PAGE LOAD\n${pageLoad.map(p => `  ${p}`).join('\n')}`);
            }
            if (userActions.length > 0) {
                res.push(`USER ACTIONS\n${userActions.map(u => `  ${u}`).join('\n\n')}`);
            }

            return res.length > 0 ? res : ['PAGE LOAD / INITIALIZATION'];
        }

        extractExecutionFlow(code, symbolModel) {
            const flowChains = [];

            if (symbolModel.jsxEvents.length > 0) {
                symbolModel.jsxEvents.forEach(evt => {
                    const chain = [];
                    chain.push(`USER:\nClick ${evt.sourceName}`);
                    chain.push(`CALL:\n${evt.handler}()`);

                    if (symbolModel.functions[evt.handler]) {
                        const stmts = symbolModel.functions[evt.handler].statements;
                        stmts.forEach(st => {
                            if (!chain.includes(`CALL:\n${st}`)) chain.push(`EXECUTE:\n${st}`);
                        });
                    }

                    let stateChanged = false;
                    Object.keys(symbolModel.stateMap).forEach(setter => {
                        if (code.includes(`${setter}(`)) {
                            chain.push(`STATE CHANGE:\n${symbolModel.stateMap[setter]} updated`);
                            stateChanged = true;
                        }
                    });

                    chain.push('RENDER:\nComponent rerender');
                    flowChains.push(chain.join('\n\n↓\n\n'));
                });
            } else {
                const handlers = Object.keys(symbolModel.functions);
                if (handlers.length > 0) {
                    handlers.forEach(fnName => {
                        const chain = [
                            `CALL:\n${fnName}()`,
                            'RENDER:\nComponent rerender'
                        ];
                        flowChains.push(chain.join('\n\n↓\n\n'));
                    });
                }
            }

            if (flowChains.length === 0) {
                flowChains.push('USER:\nClick Action Button\n\n↓\n\nCALL:\nhandleAction()\n\n↓\n\nRENDER:\nComponent rerender');
            }

            return flowChains;
        }

        extractReads(code, symbolModel) {
            const reads = [];

            if (symbolModel.stateVars.length > 0) {
                reads.push(`React State\n    ${symbolModel.stateVars.map(s => s.varName).join('\n    ')}`);
            } else {
                reads.push('React State\n    None');
            }

            if (symbolModel.propsVars.length > 0) {
                reads.push(`Props\n    ${symbolModel.propsVars.join('\n    ')}`);
            } else {
                reads.push('Props\n    None');
            }

            if (code.includes('useContext') || code.includes('Context.Provider')) {
                reads.push('React Context / Store\n    Context Data');
            } else {
                reads.push('React Context / Store\n    None');
            }

            if (symbolModel.storageReads.size > 0) {
                reads.push(`Cookies / Storage\n    ${Array.from(symbolModel.storageReads).map(s => `localStorage.${s}`).join('\n    ')}`);
            } else {
                reads.push('Cookies / Storage\n    None');
            }

            if (code.includes('useSearchParams') || code.includes('URLSearchParams') || code.includes('useParams')) {
                const params = [...code.matchAll(/(?:params|searchParams)\.get\s*\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]);
                if (params.length > 0) {
                    reads.push(`URL Params / Search Params\n    ${params.join('\n    ')}`);
                } else {
                    reads.push('URL Params / Search Params\n    Active');
                }
            } else {
                reads.push('URL Params / Search Params\n    None');
            }

            return reads;
        }

        extractWrites(code, symbolModel) {
            const writes = [];

            const mutatedStates = new Set();
            Object.keys(symbolModel.stateMap).forEach(setter => {
                if (code.includes(`${setter}(`)) {
                    mutatedStates.add(symbolModel.stateMap[setter]);
                }
            });

            if (mutatedStates.size > 0) {
                writes.push(`React State / Context\n    ${Array.from(mutatedStates).join('\n    ')}`);
            } else {
                writes.push('React State / Context\n    None');
            }

            if (symbolModel.storageWrites.size > 0) {
                writes.push(`Cookies / Storage (localStorage, sessionStorage)\n    ${Array.from(symbolModel.storageWrites).map(s => `localStorage.${s}`).join('\n    ')}`);
            } else {
                writes.push('Cookies / Storage (localStorage, sessionStorage)\n    None');
            }

            if (symbolModel.navWrites.size > 0) {
                writes.push(`Router Navigation (router.push, router.replace)\n    ${Array.from(symbolModel.navWrites).map(n => `router.push("${n}")`).join('\n    ')}`);
            } else {
                writes.push('Router Navigation (router.push, router.replace)\n    None');
            }

            if (code.includes('toast(') || code.includes('alert(') || code.includes('dispatch(')) {
                writes.push('UI Notifications & Actions (toast, alert, dispatch)\n    Active');
            } else {
                writes.push('UI Notifications & Actions (toast, alert, dispatch)\n    None');
            }

            return writes;
        }

        extractHttpCalls(code, symbolModel) {
            const httpBlocks = [];

            const fetchRegex = /(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*(["'`][^"'`]+["'`]|[a-zA-Z0-9_$.]+)\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;
            let match;
            while ((match = fetchRegex.exec(code)) !== null) {
                const rawUrl = match[1].replace(/["'`]/g, '');
                const optionsStr = match[2] || '';

                let method = 'GET';
                if (code.includes('axios.post') || optionsStr.includes("method: 'POST'") || optionsStr.includes('method: "POST"')) method = 'POST';
                if (code.includes('axios.put') || optionsStr.includes("method: 'PUT'") || optionsStr.includes('method: "PUT"')) method = 'PUT';
                if (code.includes('axios.delete') || optionsStr.includes("method: 'DELETE'") || optionsStr.includes('method: "DELETE"')) method = 'DELETE';

                let block = `REQUEST\n  ${method} ${rawUrl}\nSOURCE:\n  ${code.includes('axios') ? 'axios' : 'fetch()'}`;

                const hasAuth = code.includes('Authorization') || code.includes('Bearer');
                if (hasAuth) {
                    block += `\nHEADERS\n  Authorization: Present in source`;
                } else {
                    block += `\nHEADERS\n  unknown`;
                }

                block += `\nRESPONSE:\n  unknown`;
                httpBlocks.push(block);
            }

            return httpBlocks.length > 0 ? httpBlocks : ['REQUEST\n  None detected in source code'];
        }

        extractDependencies(code, symbolModel) {
            const imports = [];
            const externalCalls = [];

            const esImports = code.matchAll(/import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g);
            for (const match of esImports) {
                imports.push(match[1]);
            }

            if (code.includes('axios')) externalCalls.push('axios API client');
            if (code.includes('fetch')) externalCalls.push('window.fetch API');
            if (code.includes('localStorage')) externalCalls.push('Web Storage API');

            const res = [];
            if (imports.length > 0) {
                res.push(`Imports\n    ${imports.join('\n    ')}`);
            }
            if (externalCalls.length > 0) {
                res.push(`External Calls\n    ${externalCalls.join('\n    ')}`);
            }

            return res.length > 0 ? res : ['No external ES modules imported or exported'];
        }

        extractFailurePoints(code, symbolModel) {
            const failures = [];

            if (code.includes('catch(') || code.includes('catch (')) {
                failures.push('Try/Catch Block\n↓\nError Caught\n↓\nHandler Execution');
            }
            if (code.includes('fetch') || code.includes('axios')) {
                failures.push('Network Call\n↓\nHTTP Error / Network Failure');
            }

            return failures.length > 0 ? failures : ['No explicit failure handling blocks found'];
        }

        extractExitPaths(code, symbolModel) {
            const exits = [];

            const navMatches = code.matchAll(/(router\.push|router\.replace|navigate)\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?\s*\)/g);
            for (const match of navMatches) {
                exits.push(`NAVIGATION\n  Route to ${match[2]}`);
            }

            if (code.includes('return')) {
                exits.push('RENDER EXIT\n  Component / Function Return Statement');
            }

            return exits.length > 0 ? exits : ['STANDARD EXIT\n  Function Execution Complete'];
        }

        formatDebugLir(data) {
            const sm = data.symbolModel;
            const fnKeys = Object.keys(sm.functions);
            const apiList = Array.from(sm.apiEndpoints);
            const sideEffectsList = Array.from(sm.sideEffects);

            // Construct strictly accurate State Flow based ONLY on symbolModel.stateVars
            const stateFlows = sm.stateVars.map(s => {
                const initialVal = s.initialVal !== '' ? s.initialVal : 'undefined';
                return `${s.varName}:\n  initial: ${initialVal}\n  ↓\n  ${s.setter || 'state update'}\n  ↓\n  updated ${s.inferredType}`;
            });

            // Format UI Tree hierarchy based on actual JSX elements or default main component
            let uiTreeOutput = `${sm.mainComponent}`;
            if (sm.jsxStructure.length > 0) {
                uiTreeOutput += '\n' + sm.jsxStructure.map(item => `├── ${item}`).join('\n');
            } else {
                uiTreeOutput += '\n└── [No JSX Child Structure Detected]';
            }

            return [
                '==================================================',
                `FILE: ${data.filePath}`,
                `FRAMEWORK: ${sm.framework}`,
                `TYPE: ${data.fileType}`,
                `PURPOSE: ${data.purpose}`,
                '================================================== SYMBOL TABLE',
                `COMPONENT:\n  ${sm.mainComponent}`,
                `FUNCTIONS:\n  ${fnKeys.length > 0 ? fnKeys.join('\n  ') : 'None'}`,
                `STATE:\n  ${sm.stateVars.length > 0 ? sm.stateVars.map(s => `${s.varName}\n    type: ${s.inferredType}`).join('\n  ') : 'None'}`,
                `PROPS:\n  ${sm.propsVars.length > 0 ? sm.propsVars.join('\n  ') : 'None'}`,
                `ROUTES:\n  ${sm.navWrites.size > 0 ? Array.from(sm.navWrites).join('\n  ') : 'Current: /'}`,
                `API:\n  ${apiList.length > 0 ? apiList.join('\n  ') : 'None'}`,
                '================================================== UI TREE',
                `UI TREE:\n${uiTreeOutput}`,
                '================================================== ENTRY POINTS',
                `${data.entryPoints.join('\n\n')}`,
                '================================================== EXECUTION FLOW',
                `${data.executionFlow.join('\n\n')}`,
                '================================================== STATE FLOW',
                `STATE LIFECYCLE:\n${stateFlows.length > 0 ? stateFlows.join('\n\n') : '  None'}`,
                '================================================== READS',
                `${data.reads.join('\n\n')}`,
                '================================================== WRITES',
                `${data.writes.join('\n\n')}`,
                '================================================== HTTP',
                `${data.http.join('\n\n')}`,
                '================================================== DEPENDENCIES',
                `${data.dependencies.join('\n\n')}`,
                '================================================== SIDE EFFECTS',
                `FUNCTION MAP & SIDE EFFECTS:\n  ${sideEffectsList.length > 0 ? sideEffectsList.join('\n  ↓\n  ') : 'None'}`,
                '================================================== FAILURE POINTS',
                `${data.failurePoints.join('\n\n')}`,
                '================================================== EXIT PATH',
                `${data.exitPaths.join('\n\n')}`,
                '=================================================='
            ].join('\n');
        }
    }

    const extractor = new FrontendDebugLirExtractor();

    window.LirEngineRegistry.registerStage('frontend', async function (ctx) {
        return await extractor.processFiles(ctx.projectFiles, ctx.selectedFiles);
    });
})();
