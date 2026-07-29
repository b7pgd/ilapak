(function () {
    'use strict';

    /**
     * Senior Go Static Analyzer and JavaScript Parser Engineer implementation
     * Parser for Go Backend Graph LIR Engine
     */
    class GoParser {
        constructor() {
            this.name = 'go';
        }

        /**
         * Parse a single Go file and update the global projectGraph index.
         * @param {string} filePath - Path of the file being parsed
         * @param {string} content - Raw source code content
         * @param {Object} projectGraph - Global index object
         */
        parseFile(filePath, content, projectGraph) {
            if (!projectGraph.files) projectGraph.files = {};
            if (!projectGraph.packages) projectGraph.packages = {};
            if (!projectGraph.imports) projectGraph.imports = {};
            if (!projectGraph.functions) projectGraph.functions = {};
            if (!projectGraph.methods) projectGraph.methods = {};
            if (!projectGraph.receivers) projectGraph.receivers = {};
            if (!projectGraph.callGraph) projectGraph.callGraph = {};
            if (!projectGraph.reverseCallGraph) projectGraph.reverseCallGraph = {};
            if (!projectGraph.endpointGraph) projectGraph.endpointGraph = {};
            if (!projectGraph.handlers) projectGraph.handlers = {};
            if (!projectGraph.services) projectGraph.services = {};
            if (!projectGraph.repositories) projectGraph.repositories = {};
            if (!projectGraph.routers) projectGraph.routers = {};

            const cleanCode = this._removeCommentsAndStrings(content);

            const pkgName = this._parsePackage(cleanCode);
            const imports = this._parseImports(cleanCode);
            const framework = this._detectFramework(content, imports);
            const { functions, methods, receivers } = this._parseFunctionsAndMethods(cleanCode);
            const endpoints = this._parseEndpoints(cleanCode, framework);
            const functionCallsMap = this._parseFunctionCallsMap(cleanCode, functions, methods);
            const calls = Array.from(new Set(Object.values(functionCallsMap).flat()));
            const typeAndPurpose = this._inferTypeAndPurpose(filePath, functions, methods, endpoints, content);

            // Populate projectGraph
            projectGraph.packages[filePath] = pkgName;
            projectGraph.imports[filePath] = imports;
            projectGraph.functions[filePath] = functions;
            projectGraph.methods[filePath] = methods;
            projectGraph.receivers[filePath] = receivers;
            projectGraph.endpointGraph[filePath] = endpoints;
            projectGraph.callGraph[filePath] = calls;

            if (endpoints.length > 0) {
                projectGraph.handlers[filePath] = functions.concat(methods.map(m => m.receiver ? `${m.receiver}.${m.name}` : m.name));
            }

            if (filePath.toLowerCase().includes('service')) {
                projectGraph.services[filePath] = functions.concat(methods.map(m => m.receiver ? `${m.receiver}.${m.name}` : m.name));
            }

            if (filePath.toLowerCase().includes('repo') || filePath.toLowerCase().includes('db')) {
                projectGraph.repositories[filePath] = functions.concat(methods.map(m => m.receiver ? `${m.receiver}.${m.name}` : m.name));
            }

            projectGraph.files[filePath] = {
                framework: framework,
                type: typeAndPurpose.type,
                purpose: typeAndPurpose.purpose,
                pkg: pkgName,
                imports: imports,
                functions: functions,
                methods: methods,
                endpoints: endpoints,
                calls: calls,
                functionCallsMap: functionCallsMap
            };
        }

        /**
         * Cross-reference links after all files are parsed.
         * Builds reverseCallGraph and caller relationship maps.
         * @param {Object} projectGraph 
         */
        buildCrossReferences(projectGraph) {
            const files = Object.keys(projectGraph.files || {});

            files.forEach(srcFile => {
                const fData = projectGraph.files[srcFile];
                if (!fData || !fData.functionCallsMap) return;

                Object.entries(fData.functionCallsMap).forEach(([callerFunc, calledList]) => {
                    if (!callerFunc || callerFunc === 'undefined' || callerFunc === 'undefined()') return;
                    calledList.forEach(callName => {
                        files.forEach(targetFile => {
                            const targetData = projectGraph.files[targetFile];
                            if (!targetData) return;

                            const funcs = targetData.functions || [];
                            const methods = (targetData.methods || []).map(m => m.receiver ? `${m.receiver}.${m.name}` : m.name);
                            const rawMethods = (targetData.methods || []).map(m => m.name);

                            if (funcs.includes(callName) || methods.includes(callName) || rawMethods.includes(callName)) {
                                if (!projectGraph.reverseCallGraph[targetFile]) {
                                    projectGraph.reverseCallGraph[targetFile] = [];
                                }
                                projectGraph.reverseCallGraph[targetFile].push({
                                    callerFile: srcFile,
                                    callerFunction: callerFunc,
                                    functionName: callName
                                });
                            }
                        });
                    });
                });
            });
        }

        /**
         * Generates Backend Graph LIR string for a given file path based on Graph Index.
         * @param {string} filePath 
         * @param {Object} projectGraph 
         * @returns {string} Graph LIR representation
         */
        generateGraphLIR(filePath, projectGraph) {
            const fileData = projectGraph.files[filePath];
            if (!fileData) return null;

            const framework = fileData.framework || 'Go';
            const type = fileData.type || 'Backend Module';
            const purpose = fileData.purpose || 'Logic Implementation';
            const endpoints = fileData.endpoints || [];
            const functions = fileData.functions || [];
            const methods = fileData.methods || [];
            const functionCallsMap = fileData.functionCallsMap || {};

            const reverseCalls = projectGraph.reverseCallGraph[filePath] || [];

            let mapLines = [];

            if (endpoints.length > 0) {
                endpoints.forEach((ep) => {
                    mapLines.push(`${ep.method} ${ep.path}`);
                    mapLines.push('│');
                    mapLines.push('├── Called By');
                    
                    const epHandler = ep.handler || (functions[0] || (methods[0] ? (methods[0].receiver ? `${methods[0].receiver}.${methods[0].name}` : methods[0].name) : 'Handler'));
                    const epHandlerRaw = epHandler.includes('.') ? epHandler.split('.').pop() : epHandler;

                    const handlerReverseCalls = reverseCalls.filter(rc => rc.functionName === epHandler || rc.functionName === epHandlerRaw);
                    
                    const callerMap = new Map();
                    handlerReverseCalls.forEach(rc => {
                        if (rc.callerFunction && !rc.callerFunction.startsWith('undefined')) {
                            if (!callerMap.has(rc.callerFunction)) {
                                callerMap.set(rc.callerFunction, rc.callerFile);
                            }
                        }
                    });

                    if (callerMap.size > 0) {
                        const callerEntries = Array.from(callerMap.entries());
                        callerEntries.forEach(([cFunc, cFile], cIdx) => {
                            const isLastCaller = cIdx === callerEntries.length - 1;
                            const cPrefix = isLastCaller ? '└── ' : '├── ';
                            const cIndent = isLastCaller ? '    ' : '│   ';
                            mapLines.push(`│   ${cPrefix}${cFunc}()`);
                            mapLines.push(`│   ${cIndent}└── ${cFile}`);
                        });
                    } else {
                        mapLines.push('│   └── External Client / Router');
                    }
                    mapLines.push('│');

                    mapLines.push(`└── ${epHandler}()`);
                    
                    const calls = functionCallsMap[epHandler] || functionCallsMap[epHandlerRaw] || [];
                    this._appendCallsTree(mapLines, calls, projectGraph, '    ', new Set([epHandler]), fileData.imports || []);
                });
            } else {
                const allFuncs = functions.concat(methods.map(m => m.receiver ? `${m.receiver}.${m.name}` : m.name));
                allFuncs.forEach((funcName, index) => {
                    if (index > 0) mapLines.push('');
                    
                    const rawName = funcName.includes('.') ? funcName.split('.').pop() : funcName;
                    const funcReverseCalls = reverseCalls.filter(rc => rc.functionName === funcName || rc.functionName === rawName);
                    
                    const callerMap = new Map();
                    funcReverseCalls.forEach(rc => {
                        if (rc.callerFunction && !rc.callerFunction.startsWith('undefined')) {
                            if (!callerMap.has(rc.callerFunction)) {
                                callerMap.set(rc.callerFunction, rc.callerFile);
                            }
                        }
                    });

                    mapLines.push(`${funcName}()`);
                    mapLines.push('│');
                    mapLines.push('├── Called By');
                    if (callerMap.size > 0) {
                        const callerEntries = Array.from(callerMap.entries());
                        callerEntries.forEach(([cFunc, cFile], cIdx) => {
                            const isLastCaller = cIdx === callerEntries.length - 1;
                            const cPrefix = isLastCaller ? '└── ' : '├── ';
                            const cIndent = isLastCaller ? '    ' : '│   ';
                            mapLines.push(`│   ${cPrefix}${cFunc}()`);
                            mapLines.push(`│   ${cIndent}└── ${cFile}`);
                        });
                    } else {
                        mapLines.push('│   └── Internal / Unindexed Caller');
                    }
                    mapLines.push('│');

                    const calls = functionCallsMap[funcName] || functionCallsMap[rawName] || [];
                    if (calls.length > 0) {
                        this._appendCallsTree(mapLines, calls, projectGraph, '', new Set([funcName]), fileData.imports || []);
                    } else {
                        mapLines.push('└── [No internal/external calls detected]');
                    }
                });
            }

            return [
                `==================================================`,
                `FILE:`,
                `${filePath}`,
                ``,
                `FRAMEWORK:`,
                `${framework}`,
                ``,
                `TYPE:`,
                `${type}`,
                ``,
                `PURPOSE:`,
                `${purpose}`,
                `==================================================`,
                `BACKEND GRAPH MAP`,
                ``,
                mapLines.join('\n'),
                `==================================================`
            ].join('\n');
        }

        // =========================================================================
        // PRIVATE HELPER / STATIC ANALYSIS METHODS
        // =========================================================================

        _removeCommentsAndStrings(code) {
            return code
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*/g, '')
                .replace(/`[\s\S]*?`/g, '""');
        }

        _parsePackage(code) {
            const match = code.match(/package\s+([a-zA-Z0-9_]+)/);
            return match ? match[1] : 'main';
        }

        _parseImports(code) {
            const imports = [];
            const singleImportRegex = /import\s+"([^"]+)"/g;
            const multiImportRegex = /import\s*\(([\s\S]*?)\)/g;

            let match;
            while ((match = singleImportRegex.exec(code)) !== null) {
                imports.push(match[1]);
            }

            while ((match = multiImportRegex.exec(code)) !== null) {
                const lines = match[1].split('\n');
                lines.forEach(line => {
                    const trimmed = line.trim().replace(/"/g, '');
                    if (trimmed) {
                        const parts = trimmed.split(/\s+/);
                        imports.push(parts[parts.length - 1]);
                    }
                });
            }

            return imports;
        }

        _detectFramework(content, imports) {
            const impStr = imports.join(' ');
            if (impStr.includes('github.com/gin-gonic/gin')) return 'Go + Gin';
            if (impStr.includes('github.com/gofiber/fiber')) return 'Go + Fiber';
            if (impStr.includes('github.com/labstack/echo')) return 'Go + Echo';
            if (impStr.includes('github.com/go-chi/chi')) return 'Go + Chi';
            if (impStr.includes('github.com/gorilla/mux')) return 'Go + Gorilla Mux';
            if (impStr.includes('net/http')) return 'Go + net/http';
            return 'Go Standard Library';
        }

        _parseFunctionsAndMethods(code) {
            const functions = [];
            const methods = [];
            const receivers = {};

            // Match methods: func (r *Receiver) MethodName(...)
            const methodRegex = /func\s*\(\s*([a-zA-Z0-9_]+)\s+\*?([a-zA-Z0-9_]+)\s*\)\s*([a-zA-Z0-9_]+)\s*\(/g;
            let match;
            while ((match = methodRegex.exec(code)) !== null) {
                const recVar = match[1];
                const recType = match[2];
                const methodName = match[3];
                methods.push({ receiver: recType, name: methodName });
                receivers[recType] = recVar;
            }

            // Match functions: func FuncName(...)
            const funcRegex = /func\s+([a-zA-Z0-9_]+)\s*\(/g;
            while ((match = funcRegex.exec(code)) !== null) {
                const name = match[1];
                // Exclude methods caught by func keyword
                if (!methods.some(m => m.name === name)) {
                    functions.push(name);
                }
            }

            return { functions, methods, receivers };
        }

        _parseEndpoints(code, framework) {
            const endpoints = [];
            const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

            // Match router.GET("/path", Handler) or e.POST("/path", Handler) or r.HandleFunc("/path", Handler)
            const routeRegex = /(?:[a-zA-Z0-9_\.]+)\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|Handle|HandleFunc)\s*\(\s*"([^"]+)"\s*,\s*([a-zA-Z0-9_\.]+)?/gi;
            let match;
            while ((match = routeRegex.exec(code)) !== null) {
                let m = match[1].toUpperCase();
                if (m === 'HANDLE' || m === 'HANDLEFUNC') m = 'GET/POST';
                endpoints.push({
                    method: m,
                    path: match[2],
                    handler: match[3] || 'AnonymousHandler'
                });
            }

            return endpoints;
        }

        _parseFunctionCallsMap(code, functions, methods) {
            const map = {};
            const funcRegex = /func\s+(?:\(\s*([a-zA-Z0-9_]+)\s+\*?([a-zA-Z0-9_]+)\s*\)\s*)?([a-zA-Z0-9_]+)\s*\([^{]*\{/g;

            let match;
            const blocks = [];
            while ((match = funcRegex.exec(code)) !== null) {
                const recType = match[2];
                const funcName = match[3];
                const fullName = recType ? `${recType}.${funcName}` : funcName;

                blocks.push({
                    name: fullName,
                    rawName: funcName,
                    startIndex: match.index + match[0].length
                });
            }

            for (let i = 0; i < blocks.length; i++) {
                const current = blocks[i];
                const nextStart = (i + 1 < blocks.length) ? blocks[i + 1].startIndex : code.length;
                
                let depth = 1;
                let endIndex = current.startIndex;
                for (let j = current.startIndex; j < nextStart; j++) {
                    if (code[j] === '{') depth++;
                    else if (code[j] === '}') {
                        depth--;
                        if (depth === 0) {
                            endIndex = j;
                            break;
                        }
                    }
                }

                const body = code.substring(current.startIndex, endIndex);
                map[current.name] = this._parseCalls(body, current.rawName);
            }

            return map;
        }

        _parseCalls(code, enclosingFuncName) {
            const calls = [];
            // Match FunctionCall(...) or Object.MethodCall(...) preserving order
            const callRegex = /([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/g;
            let match;
            const blacklist = new Set([
                'func', 'if', 'for', 'switch', 'return', 'type', 'struct', 'interface',
                'byte', 'string', 'int', 'int8', 'int16', 'int32', 'int64',
                'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
                'float32', 'float64', 'complex64', 'complex128', 'bool', 'rune',
                'append', 'copy', 'make', 'new', 'len', 'cap', 'close', 'delete', 'panic', 'recover'
            ]);

            while ((match = callRegex.exec(code)) !== null) {
                const call = match[1];
                if (!blacklist.has(call) && call !== enclosingFuncName && !calls.includes(call)) {
                    calls.push(call);
                }
            }

            return calls;
        }

        _inferTypeAndPurpose(filePath, functions, methods, endpoints, content) {
            const lower = filePath.toLowerCase();
            let type = 'Go Module';
            let purpose = 'General Logic';

            if (endpoints.length > 0 || lower.includes('controller') || lower.includes('handler')) {
                type = 'HTTP Handler';
                purpose = 'Handle HTTP Requests & Routing';
            } else if (lower.includes('service')) {
                type = 'Service Layer';
                purpose = 'Business Logic Execution';
            } else if (lower.includes('repo') || lower.includes('store') || lower.includes('dao')) {
                type = 'Repository';
                purpose = 'Database Operations & Data Access';
            } else if (lower.includes('model') || lower.includes('entity')) {
                type = 'Data Model';
                purpose = 'Data Structures & Schema Definitions';
            } else if (lower.includes('middleware')) {
                type = 'Middleware';
                purpose = 'Request Interception & Processing';
            } else if (lower.includes('main.go')) {
                type = 'Application Entrypoint';
                purpose = 'Initialize and Start Server';
            }

            return { type, purpose };
        }

        _appendCallsTree(mapLines, calls, projectGraph, indent, visited = new Set(), currentImports = []) {
            const fileKeys = Object.keys(projectGraph.files || {});

            calls.forEach((call, index) => {
                const isLast = index === calls.length - 1;
                const prefix = isLast ? '└── ' : '├── ';
                const childIndent = isLast ? '    ' : '│   ';

                mapLines.push(`${indent}${prefix}${call}()`);

                // Find defining file
                let definedIn = null;
                let targetFileData = null;
                const rawCall = call.includes('.') ? call.split('.').pop() : call;

                for (const fk of fileKeys) {
                    const fData = projectGraph.files[fk];
                    if (
                        fData.functions.includes(call) || 
                        fData.functions.includes(rawCall) || 
                        fData.methods.some(m => m.name === call || m.name === rawCall || `${m.receiver}.${m.name}` === call)
                    ) {
                        definedIn = fk;
                        targetFileData = fData;
                        break;
                    }
                }

                if (definedIn) {
                    mapLines.push(`${indent}${childIndent}└── ${definedIn}`);
                    if (!visited.has(call)) {
                        const nextVisited = new Set(visited).add(call);
                        const nestedCalls = (targetFileData.functionCallsMap && (targetFileData.functionCallsMap[call] || targetFileData.functionCallsMap[rawCall])) || [];
                        if (nestedCalls.length > 0) {
                            this._appendCallsTree(mapLines, nestedCalls, projectGraph, indent + childIndent, nextVisited, targetFileData.imports || []);
                        }
                    }
                } else if (call.includes('.')) {
                    const pkgPrefix = call.split('.')[0];
                    const matchedImport = currentImports.find(imp => imp.endsWith('/' + pkgPrefix) || imp === pkgPrefix);
                    if (matchedImport) {
                        mapLines.push(`${indent}${childIndent}└── ${matchedImport}`);
                    } else {
                        mapLines.push(`${indent}${childIndent}└── External Package`);
                    }
                }
            });
        }
    }

    // Register instance to BackendParserRegistry
    if (window.BackendParserRegistry) {
        window.BackendParserRegistry.register('go', new GoParser());
    }
})();
