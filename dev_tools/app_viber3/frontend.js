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
            const httpContract = this.extractHttpContract(code, symbolModel);
            const requestSchema = this.extractRequestSchema(code, symbolModel);
            const expectedResponseSchema = this.extractExpectedResponseSchema(code, symbolModel);
            const apiConsumerMapping = this.extractApiConsumerMapping(code, symbolModel);
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
                httpContract,
                requestSchema,
                expectedResponseSchema,
                apiConsumerMapping,
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

            // Extract Semantic UI Tree Hierarchy & Event Source Elements
            const componentMatches = code.matchAll(/<([A-Z][a-zA-Z0-9_$]*)\b[^>]*>/g);
            const foundComponents = new Set();
            for (const cm of componentMatches) {
                if (cm[1] !== mainComponent.replace('()', '')) {
                    foundComponents.add(cm[1]);
                }
            }

            const semanticGroups = {
                'Header / User Section': [],
                'Actions / Controls': [],
                'Data / Layout Tables': []
            };

            const jsxTagRegex = /<([a-zA-Z0-9_$]+)([^>]*?)>(.*?)<\/\1>|<(button|input|form|table|div|header|main)([^>]*?)\/?>/gs;
            let tagMatch;
            while ((tagMatch = jsxTagRegex.exec(code)) !== null) {
                const tagName = tagMatch[1] || tagMatch[4];
                const attrs = tagMatch[2] || tagMatch[5] || '';
                const innerText = (tagMatch[3] || '').replace(/<[^>]*>/g, '').trim();

                const tagLower = tagName.toLowerCase();
                if (['button', 'input', 'form', 'table', 'header'].includes(tagLower) || /^[A-Z]/.test(tagName)) {
                    let label = innerText || tagName;
                    if (tagLower === 'button' || attrs.includes('type="submit"')) {
                        label = innerText ? `${innerText} Button` : 'Button Action';
                        semanticGroups['Actions / Controls'].push(label);
                    } else if (tagLower === 'input') {
                        label = 'Input Control';
                        semanticGroups['Actions / Controls'].push(label);
                    } else if (tagLower === 'table') {
                        label = 'Data Table';
                        semanticGroups['Data / Layout Tables'].push(label);
                    } else if (tagLower === 'header' || attrs.includes('user') || attrs.includes('profile')) {
                        label = innerText ? `${innerText} Header` : 'Header Section';
                        semanticGroups['Header / User Section'].push(label);
                    }
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

            // Build hierarchical UI Tree Structure
            if (foundComponents.size > 0) {
                foundComponents.forEach(comp => {
                    jsxStructure.push(`├── ${comp}`);
                });
            }
            Object.keys(semanticGroups).forEach(group => {
                const items = Array.from(new Set(semanticGroups[group]));
                if (items.length > 0) {
                    jsxStructure.push(`├── ${group}`);
                    items.forEach(it => {
                        jsxStructure.push(`│   └── ${it}`);
                    });
                }
            });

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
                    userActions.push(`${evt.sourceName}\n↓\n${evt.handler}()`);
                });
            } else {
                const eventAttrMatches = code.matchAll(/(onClick|onSubmit|onChange)\s*=\s*\{?\s*([a-zA-Z0-9_$]+)\s*\}?/g);
                for (const match of eventAttrMatches) {
                    const eventType = match[1];
                    const handler = match[2];
                    let label = eventType === 'onSubmit' ? 'Submit Button' : 'User Action';
                    userActions.push(`${label}\n↓\n${handler}()`);
                }
            }

            const res = [];
            if (pageLoad.length > 0) {
                res.push(`PAGE LOAD\n\n  ${pageLoad.join('\n  ')}`);
            }
            if (userActions.length > 0) {
                res.push(`USER ACTIONS\n\n${userActions.join('\n\n')}`);
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

                    const fnObj = symbolModel.functions[evt.handler];
                    const fnBody = fnObj ? fnObj.body : '';

                    if (fnObj) {
                        fnObj.statements.forEach(st => {
                            if (!chain.includes(`CALL:\n${st}`)) chain.push(`EXECUTE:\n${st}`);
                        });
                    }

                    // Strict function-level state mutation extraction (Avoid false positives)
                    const mutatedInHandler = [];
                    Object.keys(symbolModel.stateMap).forEach(setter => {
                        if (fnBody.includes(`${setter}(`)) {
                            const stateVar = symbolModel.stateMap[setter];
                            mutatedInHandler.push(stateVar);
                        }
                    });

                    if (mutatedInHandler.length > 0) {
                        chain.push(`WRITES:\n${mutatedInHandler.join('\n')}`);
                        mutatedInHandler.forEach(sVar => {
                            chain.push(`STATE CHANGE:\n${sVar} updated`);
                        });
                    }

                    chain.push('RENDER:\nComponent rerender / UI update');
                    flowChains.push(chain.join('\n\n↓\n\n'));
                });
            } else {
                const handlers = Object.keys(symbolModel.functions);
                if (handlers.length > 0) {
                    handlers.forEach(fnName => {
                        const fnBody = symbolModel.functions[fnName].body;
                        const chain = [`CALL:\n${fnName}()`];
                        
                        const mutatedInHandler = [];
                        Object.keys(symbolModel.stateMap).forEach(setter => {
                            if (fnBody.includes(`${setter}(`)) {
                                mutatedInHandler.push(symbolModel.stateMap[setter]);
                            }
                        });

                        if (mutatedInHandler.length > 0) {
                            chain.push(`WRITES:\n${mutatedInHandler.join('\n')}`);
                            mutatedInHandler.forEach(sVar => {
                                chain.push(`STATE CHANGE:\n${sVar} updated`);
                            });
                        }

                        chain.push('RENDER:\nComponent rerender');
                        flowChains.push(chain.join('\n\n↓\n\n'));
                    });
                }
            }

            if (flowChains.length === 0) {
                flowChains.push('USER:\nClick Action Button\n\n↓\n\nCALL:\nhandleAction()\n\n↓\n\nWRITES:\nstate\n\n↓\n\nSTATE CHANGE:\nstate updated\n\n↓\n\nRENDER:\nComponent rerender');
            }

            return flowChains;
        }

        extractReads(code, symbolModel) {
            const reads = [];

            reads.push('React State\n\n' + (symbolModel.stateVars.length > 0 ? symbolModel.stateVars.map(s => s.varName).join('\n\n') : 'None'));

            reads.push('Props\n\n' + (symbolModel.propsVars.length > 0 ? symbolModel.propsVars.join('\n\n') : 'None'));

            if (code.includes('useContext') || code.includes('Context.Provider')) {
                reads.push('React Context / Store\n\nContext Data');
            } else {
                reads.push('React Context / Store\n\nNone');
            }

            if (symbolModel.storageReads.size > 0) {
                reads.push('Cookies / Storage\n\n' + Array.from(symbolModel.storageReads).map(s => `localStorage.${s}`).join('\n\n'));
            } else {
                reads.push('Cookies / Storage\n\nNone');
            }

            if (code.includes('useSearchParams') || code.includes('URLSearchParams') || code.includes('useParams')) {
                const params = [...code.matchAll(/(?:params|searchParams)\.get\s*\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]);
                if (params.length > 0) {
                    reads.push('URL Params / Search Params\n\n' + params.join('\n\n'));
                } else {
                    reads.push('URL Params / Search Params\n\nActive');
                }
            } else {
                reads.push('URL Params / Search Params\n\nNone');
            }

            return reads;
        }

        extractWrites(code, symbolModel) {
            const writes = [];

            const fnWrites = [];
            Object.keys(symbolModel.functions).forEach(fn => {
                const fnBody = symbolModel.functions[fn].body;
                const mutatedInFn = [];
                Object.keys(symbolModel.stateMap).forEach(setter => {
                    if (fnBody.includes(`${setter}(`)) {
                        mutatedInFn.push(symbolModel.stateMap[setter]);
                    }
                });
                if (mutatedInFn.length > 0) {
                    fnWrites.push(`${fn}:\n${mutatedInFn.join('\n')}`);
                }
            });

            if (fnWrites.length > 0) {
                writes.push(`React State / Context\n\n${fnWrites.join('\n\n')}`);
            } else {
                const mutatedStates = new Set();
                Object.keys(symbolModel.stateMap).forEach(setter => {
                    if (code.includes(`${setter}(`)) {
                        mutatedStates.add(symbolModel.stateMap[setter]);
                    }
                });
                if (mutatedStates.size > 0) {
                    writes.push(`React State / Context\n\n${Array.from(mutatedStates).join('\n\n')}`);
                } else {
                    writes.push('React State / Context\n\nNone');
                }
            }

            if (symbolModel.storageWrites.size > 0) {
                writes.push(`Cookies / Storage\n(localStorage, sessionStorage)\n\n${Array.from(symbolModel.storageWrites).map(s => `localStorage.${s}`).join('\n\n')}`);
            } else {
                writes.push('Cookies / Storage\n(localStorage, sessionStorage)\n\nNone');
            }

            if (symbolModel.navWrites.size > 0) {
                writes.push(`Router Navigation\n(router.push, router.replace)\n\n${Array.from(symbolModel.navWrites).map(n => `router.push("${n}")`).join('\n\n')}`);
            } else {
                writes.push('Router Navigation\n(router.push, router.replace)\n\nNone');
            }

            if (code.includes('toast') || code.includes('alert') || code.includes('dispatch')) {
                writes.push('UI Notifications & Actions\n\ntoast\nalert\ndispatch\n\nDetected if applicable');
            } else {
                writes.push('UI Notifications & Actions\n\nNone');
            }

            return writes;
        }

        extractHttpCalls(code, symbolModel) {
            const httpBlocks = [];

            const fetchRegex = /(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*(["'`][^"'`]+["'`]|[a-zA-Z0-9_$.`]+)\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;
            let match;
            while ((match = fetchRegex.exec(code)) !== null) {
                const rawUrl = match[1].replace(/["'`]/g, '');
                const optionsStr = match[2] || '';

                let method = 'GET';
                if (code.includes('axios.post') || optionsStr.includes("method: 'POST'") || optionsStr.includes('method: "POST"')) method = 'POST';
                if (code.includes('axios.put') || optionsStr.includes("method: 'PUT'") || optionsStr.includes('method: "PUT"')) method = 'PUT';
                if (code.includes('axios.delete') || optionsStr.includes("method: 'DELETE'") || optionsStr.includes('method: "DELETE"')) method = 'DELETE';

                let callerFn = 'Inline / Global';
                let consumerState = 'None';

                Object.keys(symbolModel.functions).forEach(fn => {
                    if (symbolModel.functions[fn].body.includes(rawUrl) || symbolModel.functions[fn].body.includes('fetch(') || symbolModel.functions[fn].body.includes('axios')) {
                        callerFn = `${fn}()`;
                    }
                });

                Object.keys(symbolModel.stateMap).forEach(setter => {
                    if (code.includes(setter)) {
                        consumerState = symbolModel.stateMap[setter];
                    }
                });

                let trigger = code.includes('useEffect') ? 'Page Load / Lifecycle Hook' : 'User Action / Handler Call';

                let block = `REQUEST\n\n${method} ${rawUrl}\n\nSOURCE\n\n${code.includes('axios') ? 'axios' : 'fetch()'}`;
                block += `\n\nCALLER\n\n${callerFn}\n\nTRIGGER\n\n${trigger}\n\nCONSUMER\n\n${consumerState}\n\nDEPENDENT STATE\n\n${consumerState}`;

                const hasAuth = code.includes('Authorization') || code.includes('Bearer');
                if (hasAuth) {
                    block += `\n\nHEADERS\n\nAuthorization: Present in source`;
                } else {
                    block += `\n\nHEADERS\n\nUnknown`;
                }

                block += `\n\nRESPONSE\n\nUnknown`;
                httpBlocks.push(block);
            }

            return httpBlocks.length > 0 ? httpBlocks : ['REQUEST\n\nNone detected in source code'];
        }

        extractHttpContract(code, symbolModel) {
            let method = 'GET';
            let endpoint = 'Unknown / Not Detected';
            const urlMatches = code.match(/(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/);
            if (urlMatches) {
                endpoint = urlMatches[1];
            }

            if (code.includes('POST') || code.includes('axios.post')) method = 'POST';
            if (code.includes('PUT') || code.includes('axios.put')) method = 'PUT';
            if (code.includes('DELETE') || code.includes('axios.delete')) method = 'DELETE';

            let caller = 'Inline / Global';
            Object.keys(symbolModel.functions).forEach(fn => {
                if (symbolModel.functions[fn].body.includes('fetch') || symbolModel.functions[fn].body.includes('axios')) {
                    caller = `${fn}()`;
                }
            });

            let trigger = code.includes('useEffect') ? 'Page Load / Lifecycle Hook' : 'User Action / Handler Call';
            let auth = code.includes('Authorization') || code.includes('Bearer') ? 'Present' : 'Unknown / Not Detected';

            return {
                method,
                endpoint,
                requestSource: code.includes('axios') ? 'axios' : 'fetch()',
                caller,
                trigger,
                targetHandler: 'Unknown / Not Mapped',
                authentication: auth
            };
        }

        extractRequestSchema(code, symbolModel) {
            let contentType = 'Unknown';
            if (code.includes('application/json') || code.includes('JSON.stringify')) {
                contentType = 'application/json';
            }

            let pathParams = 'None';
            if (code.includes('${')) {
                const match = code.match(/\$\{([^}]+)\}/);
                if (match) pathParams = match[1];
            }

            return {
                contentType,
                body: 'None',
                queryParams: 'None',
                pathParams,
                headers: 'Unknown'
            };
        }

        extractExpectedResponseSchema(code, symbolModel) {
            let consumer = 'None';
            Object.keys(symbolModel.stateMap).forEach(setter => {
                if (code.includes(setter)) {
                    consumer = symbolModel.stateMap[setter];
                }
            });

            // Extract referenced/accessed response fields statically
            const fields = new Set();
            const resPropMatches = code.matchAll(/(?:res|data|response|json)\.([a-zA-Z0-9_$]+)/g);
            for (const m of resPropMatches) {
                if (!['json', 'data', 'status', 'ok', 'headers'].includes(m[1])) {
                    fields.add(m[1]);
                }
            }

            const destructMatches = code.matchAll(/const\s*\{([^}]+)\}\s*=\s*(?:await\s+)?(?:res|data|response)\b/g);
            for (const m of destructMatches) {
                m[1].split(',').forEach(f => {
                    const clean = f.trim().split(':')[0].trim();
                    if (clean) fields.add(clean);
                });
            }

            const expectedFieldsStr = fields.size > 0 ? Array.from(fields).join('\n') : 'Unknown';

            return {
                contentType: 'application/json (Expected)',
                expectedPayload: 'Unknown',
                expectedFields: expectedFieldsStr,
                statusCode: 'Unknown',
                consumerState: consumer
            };
        }

        extractApiConsumerMapping(code, symbolModel) {
            let caller = 'Inline / Global';
            let api = 'GET /api/example';
            let targetState = 'None';

            const urlMatches = code.match(/(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/);
            if (urlMatches) {
                let m = 'GET';
                if (code.includes('POST') || code.includes('axios.post')) m = 'POST';
                if (code.includes('PUT') || code.includes('axios.put')) m = 'PUT';
                if (code.includes('DELETE') || code.includes('axios.delete')) m = 'DELETE';
                api = `${m} ${urlMatches[1]}`;
            }

            Object.keys(symbolModel.functions).forEach(fn => {
                if (symbolModel.functions[fn].body.includes('fetch') || symbolModel.functions[fn].body.includes('axios')) {
                    caller = `${fn}()`;
                }
            });

            Object.keys(symbolModel.stateMap).forEach(setter => {
                if (code.includes(setter)) {
                    targetState = symbolModel.stateMap[setter];
                }
            });

            const component = symbolModel.mainComponent;

            // Strict flow generation adhering to UI consumer mappings
            let consumerUI = 'Table / UI Element';
            if (symbolModel.jsxStructure.length > 0) {
                const tableItem = symbolModel.jsxStructure.find(s => s.includes('Table'));
                if (tableItem) consumerUI = 'Table';
            }

            const flowParts = [api];
            if (targetState !== 'None') flowParts.push(targetState);
            flowParts.push(component);
            flowParts.push(consumerUI);

            return {
                callerFunction: caller,
                api,
                targetState,
                targetComponent: component,
                renderConsumer: consumerUI,
                nextFlow: flowParts.join('\n\n↓\n\n')
            };
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
                res.push(`Imports\n\n${imports.join('\n\n')}`);
            }
            if (externalCalls.length > 0) {
                res.push(`External Calls\n\n${externalCalls.join('\n\n')}`);
            }

            return res.length > 0 ? res : ['No external ES modules imported or exported'];
        }

        extractFailurePoints(code, symbolModel) {
            const failures = [];

            failures.push('Try/Catch Block\n\n↓\n\nError Caught\n\n↓\n\nHandler Execution');
            failures.push('Network Call\n\n↓\n\nHTTP Error / Network Failure');
            failures.push('API Contract Mismatch\n\n↓\n\nUnexpected Response Schema');
            failures.push('State Update Failure\n\n↓\n\nUI Not Updated');

            return failures;
        }

        extractExitPaths(code, symbolModel) {
            const exits = [];

            exits.push('ERROR\n\nException caught\n\n↓\n\nToast / Notification\n\n↓\n\nRemain on current view');
            exits.push('SUCCESS\n\nState updated\n\n↓\n\nComponent View Rerender');

            return exits;
        }

        formatDebugLir(data) {
            const sm = data.symbolModel;
            const fnKeys = Object.keys(sm.functions);
            const apiList = Array.from(sm.apiEndpoints);

            // Construct rich State Lifecycle Flow with Writer Functions & Data Flow
            const stateFlows = sm.stateVars.map(s => {
                const initialVal = s.initialVal !== '' ? s.initialVal : "''";
                const writerFns = [];
                Object.keys(sm.functions).forEach(fn => {
                    if (sm.functions[fn].body.includes(s.setter)) {
                        writerFns.push(`${fn}()`);
                    }
                });
                let writerOutput = writerFns.length > 0 ? writerFns.join('\n') : (s.setter ? `${s.setter}()` : sm.mainComponent);
                if (writerOutput === sm.mainComponent) {
                    writerOutput = sm.mainComponent;
                } else {
                    writerOutput = `${sm.mainComponent}\n${writerOutput}`;
                }

                return `${s.varName}\n\nTYPE:\n${s.inferredType}\n\nINITIALIZER:\n${sm.mainComponent}\n\nWRITER:\n${writerOutput}\n\nFLOW:\n${initialVal}\n↓\n${s.setter || 'setter'}()\n↓\nupdated ${s.inferredType}`;
            });

            // Format UI Tree hierarchy
            let uiTreeOutput = `${sm.mainComponent}`;
            if (sm.jsxStructure.length > 0) {
                uiTreeOutput += '\n\n' + sm.jsxStructure.join('\n\n');
            }

            return [
                '==================================================',
                'DEBUG LIR',
                '==================================================',
                '',
                'FILE',
                data.filePath,
                '',
                'FRAMEWORK',
                sm.framework,
                '',
                'TYPE',
                data.fileType,
                '',
                'PURPOSE',
                data.purpose,
                '',
                '==================================================',
                'SYMBOL TABLE',
                '==================================================',
                '',
                'COMPONENT:',
                `  ${sm.mainComponent}`,
                '',
                'FUNCTIONS:',
                `  ${fnKeys.length > 0 ? fnKeys.join('\n  ') : 'None'}`,
                '',
                'STATE:',
                `  ${sm.stateVars.length > 0 ? sm.stateVars.map(s => `${s.varName}\n    type: ${s.inferredType}`).join('\n\n  ') : 'None'}`,
                '',
                'PROPS:',
                `  ${sm.propsVars.length > 0 ? sm.propsVars.join('\n  ') : 'None'}`,
                '',
                'ROUTES:',
                `  ${sm.navWrites.size > 0 ? Array.from(sm.navWrites).join('\n  ') : 'Current: /'}`,
                '',
                'API:',
                `  ${apiList.length > 0 ? apiList.join('\n  ') : 'None'}`,
                '',
                '==================================================',
                'UI TREE',
                '==================================================',
                '',
                uiTreeOutput,
                '',
                '==================================================',
                'ENTRY POINTS',
                '==================================================',
                '',
                data.entryPoints.join('\n\n'),
                '',
                '==================================================',
                'EXECUTION FLOW',
                '==================================================',
                '',
                data.executionFlow.join('\n\n\n'),
                '',
                '==================================================',
                'STATE FLOW',
                '==================================================',
                '',
                `STATE LIFECYCLE:\n\n${stateFlows.length > 0 ? stateFlows.join('\n\n\n') : 'None'}`,
                '',
                '==================================================',
                'READS',
                '==================================================',
                '',
                data.reads.join('\n\n'),
                '',
                '==================================================',
                'WRITES',
                '==================================================',
                '',
                data.writes.join('\n\n'),
                '',
                '==================================================',
                'HTTP',
                '==================================================',
                '',
                data.http.join('\n\n'),
                '',
                '==================================================',
                'HTTP CONTRACT',
                '==================================================',
                '',
                'METHOD',
                '',
                data.httpContract.method,
                '',
                'ENDPOINT',
                '',
                data.httpContract.endpoint,
                '',
                'REQUEST SOURCE',
                '',
                data.httpContract.requestSource,
                '',
                'CALLER',
                '',
                data.httpContract.caller,
                '',
                'TRIGGER',
                '',
                data.httpContract.trigger,
                '',
                'TARGET HANDLER',
                '',
                data.httpContract.targetHandler,
                '',
                'AUTHENTICATION',
                '',
                data.httpContract.authentication,
                '',
                '==================================================',
                'REQUEST SCHEMA',
                '==================================================',
                '',
                'CONTENT TYPE',
                '',
                data.requestSchema.contentType,
                '',
                'BODY',
                '',
                data.requestSchema.body,
                '',
                'QUERY PARAMS',
                '',
                data.requestSchema.queryParams,
                '',
                'PATH PARAMS',
                '',
                data.requestSchema.pathParams,
                '',
                'HEADERS',
                '',
                data.requestSchema.headers,
                '',
                '==================================================',
                'EXPECTED RESPONSE SCHEMA',
                '==================================================',
                '',
                'CONTENT TYPE',
                '',
                data.expectedResponseSchema.contentType,
                '',
                'EXPECTED PAYLOAD',
                '',
                data.expectedResponseSchema.expectedPayload,
                '',
                'EXPECTED FIELDS',
                '',
                data.expectedResponseSchema.expectedFields,
                '',
                'STATUS CODE',
                '',
                data.expectedResponseSchema.statusCode,
                '',
                'CONSUMER STATE',
                '',
                data.expectedResponseSchema.consumerState,
                '',
                '==================================================',
                'API CONSUMER MAPPING',
                '==================================================',
                '',
                'CALLER FUNCTION',
                '',
                data.apiConsumerMapping.callerFunction,
                '',
                'API',
                '',
                data.apiConsumerMapping.api,
                '',
                'TARGET STATE',
                '',
                data.apiConsumerMapping.targetState,
                '',
                'TARGET COMPONENT',
                '',
                data.apiConsumerMapping.targetComponent,
                '',
                'RENDER CONSUMER',
                '',
                data.apiConsumerMapping.renderConsumer,
                '',
                'NEXT FLOW',
                '',
                data.apiConsumerMapping.nextFlow,
                '',
                '==================================================',
                'DEPENDENCIES',
                '==================================================',
                '',
                data.dependencies.join('\n\n'),
                '',
                '==================================================',
                'SIDE EFFECTS',
                '==================================================',
                '',
                'FUNCTION MAP & SIDE EFFECTS',
                '',
                Array.from(sm.sideEffects).join('\n\n'),
                '',
                '==================================================',
                'FAILURE POINTS',
                '==================================================',
                '',
                data.failurePoints.join('\n\n'),
                '',
                '==================================================',
                'EXIT PATH',
                '==================================================',
                '',
                data.exitPaths.join('\n\n'),
                '',
                '=================================================='
            ].join('\n');
        }
    }

    const extractor = new FrontendDebugLirExtractor();

    window.LirEngineRegistry.registerStage('frontend', async function (ctx) {
        return await extractor.processFiles(ctx.projectFiles, ctx.selectedFiles);
    });
})();
