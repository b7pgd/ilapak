(function () {
    'use strict';

    /**
     * Senior Node.js Static Analyzer and JavaScript Parser Engineer implementation
     * Parser for Node.js Backend Graph LIR Engine
     */
    class NodeParser {
        constructor() {
            this.name = 'node';
            this.ignoredBuiltins = new Set([
                'replace', 'split', 'join', 'map', 'filter', 'reduce',
                'forEach', 'push', 'pop', 'shift', 'unshift', 'includes',
                'startsWith', 'endsWith', 'trim', 'flat', 'Object.keys',
                'Object.values', 'Object.entries', 'Array.from', 'Set',
                'Map', 'JSON.parse', 'JSON.stringify', 'Promise', 'Math',
                'Date', 'Number', 'String', 'Boolean'
            ]);
        }

        /**
         * Parse a single Node.js/TypeScript file and update the global projectGraph index.
         * @param {string} filePath - Path of the file being parsed
         * @param {string} content - Raw source code content
         * @param {Object} projectGraph - Global index object
         */
        parseFile(filePath, content, projectGraph) {
            if (!projectGraph.files) projectGraph.files = {};
            if (!projectGraph.imports) projectGraph.imports = {};
            if (!projectGraph.functions) projectGraph.functions = {};
            if (!projectGraph.classes) projectGraph.classes = {};
            if (!projectGraph.methods) projectGraph.methods = {};
            if (!projectGraph.callGraph) projectGraph.callGraph = {};
            if (!projectGraph.reverseCallGraph) projectGraph.reverseCallGraph = {};
            if (!projectGraph.endpointGraph) projectGraph.endpointGraph = {};
            if (!projectGraph.handlers) projectGraph.handlers = {};
            if (!projectGraph.services) projectGraph.services = {};
            if (!projectGraph.repositories) projectGraph.repositories = {};
            if (!projectGraph.routers) projectGraph.routers = {};
            if (!projectGraph.symbolIndex) projectGraph.symbolIndex = {};

            const cleanCode = this._removeCommentsAndStrings(content);

            const imports = this._parseImports(cleanCode, content);
            const exports = this._parseExports(cleanCode);
            const framework = this._detectFramework(content, imports);
            const { functions, classes, methods, functionBlocks } = this._parseStructure(cleanCode);
            const endpoints = this._parseEndpoints(cleanCode, content, methods, functions);
            const functionCallsMap = this._parseFunctionCallsMap(cleanCode, functions, methods, content, functionBlocks);
            const calls = Array.from(new Set(Object.values(functionCallsMap).flat()));
            const typeAndPurpose = this._inferTypeAndPurpose(filePath, functions, classes, endpoints, content);

            // Populate global symbolIndex for O(1) lookup
            functions.concat(methods.map(m => m.className ? `${m.className}.${m.name}` : m.name)).forEach(sym => {
                if (!projectGraph.symbolIndex[sym]) {
                    projectGraph.symbolIndex[sym] = new Set();
                }
                projectGraph.symbolIndex[sym].add(filePath);

                const rawSym = sym.includes('.') ? sym.split('.').pop() : sym;
                if (!projectGraph.symbolIndex[rawSym]) {
                    projectGraph.symbolIndex[rawSym] = new Set();
                }
                projectGraph.symbolIndex[rawSym].add(filePath);
            });

            // Populate projectGraph
            projectGraph.imports[filePath] = imports;
            projectGraph.functions[filePath] = functions;
            projectGraph.classes[filePath] = classes;
            projectGraph.methods[filePath] = methods;
            projectGraph.endpointGraph[filePath] = endpoints;
            projectGraph.callGraph[filePath] = calls;

            if (endpoints.length > 0) {
                projectGraph.handlers[filePath] = functions.concat(methods.map(m => m.className ? `${m.className}.${m.name}` : m.name));
            }

            if (filePath.toLowerCase().includes('service')) {
                projectGraph.services[filePath] = functions.concat(methods.map(m => m.className ? `${m.className}.${m.name}` : m.name));
            }

            if (filePath.toLowerCase().includes('repo') || filePath.toLowerCase().includes('model') || filePath.toLowerCase().includes('db')) {
                projectGraph.repositories[filePath] = functions.concat(methods.map(m => m.className ? `${m.className}.${m.name}` : m.name));
            }

            projectGraph.files[filePath] = {
                framework: framework,
                type: typeAndPurpose.type,
                purpose: typeAndPurpose.purpose,
                imports: imports,
                exports: exports,
                functions: functions,
                classes: classes,
                methods: methods,
                endpoints: endpoints,
                calls: calls,
                functionCallsMap: functionCallsMap,
                functionBlocks: functionBlocks
            };
        }

        /**
         * Cross-reference links after all files are parsed.
         * Builds reverseCallGraph and caller relationship maps.
         * @param {Object} projectGraph 
         */
        buildCrossReferences(projectGraph) {
            const files = Object.keys(projectGraph.files || {});
            const symbolIndex = projectGraph.symbolIndex || {};

            files.forEach(srcFile => {
                const fData = projectGraph.files[srcFile];
                if (!fData || !fData.functionCallsMap) return;

                Object.entries(fData.functionCallsMap).forEach(([callerFunc, calledList]) => {
                    if (!callerFunc || callerFunc === 'undefined' || callerFunc === 'undefined()') return;
                    calledList.forEach(callName => {
                        const cleanCallName = callName.replace(/^await\s+/, '');
                        const rawCallName = cleanCallName.includes('.') ? cleanCallName.split('.').pop() : cleanCallName;

                        const targetFiles = new Set([
                            ...(symbolIndex[cleanCallName] || []),
                            ...(symbolIndex[rawCallName] || [])
                        ]);

                        targetFiles.forEach(targetFile => {
                            const targetData = projectGraph.files[targetFile];
                            if (!targetData) return;

                            const qualifiedCaller = `${srcFile}::${callerFunc}`;

                            if (!projectGraph.reverseCallGraph[targetFile]) {
                                projectGraph.reverseCallGraph[targetFile] = [];
                            }
                            projectGraph.reverseCallGraph[targetFile].push({
                                callerFile: srcFile,
                                callerFunction: callerFunc,
                                qualifiedCaller: qualifiedCaller,
                                functionName: callName
                            });
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

            const framework = fileData.framework || 'Node.js';
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

                    if (ep.middlewares && ep.middlewares.length > 0) {
                        mapLines.push('├── Middleware');
                        ep.middlewares.forEach((mw, mwIdx) => {
                            const isLastMw = mwIdx === ep.middlewares.length - 1;
                            const mwPrefix = isLastMw ? '└── ' : '├── ';
                            mapLines.push(`│   ${mwPrefix}${mw}`);
                        });
                        mapLines.push('│');
                    }

                    mapLines.push('├── Called By');

                    const epHandler = ep.handler || (functions[0] || (methods[0] ? (methods[0].className ? `${methods[0].className}.${methods[0].name}` : methods[0].name) : '<anonymous>'));
                    const epHandlerRaw = epHandler.includes('.') ? epHandler.split('.').pop() : epHandler;

                    const handlerReverseCalls = reverseCalls.filter(rc => rc.functionName === epHandler || rc.functionName === epHandlerRaw || rc.functionName.endsWith('.' + epHandlerRaw));
                    
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
                    this._appendCallsTree(mapLines, calls, projectGraph, '    ', new Set([`${filePath}::${epHandler}`]), fileData.imports || []);
                });
            } else {
                const allFuncs = functions.concat(methods.map(m => m.className ? `${m.className}.${m.name}` : m.name));
                allFuncs.forEach((funcName, index) => {
                    if (index > 0) mapLines.push('');

                    const rawName = funcName.includes('.') ? funcName.split('.').pop() : funcName;
                    const funcReverseCalls = reverseCalls.filter(rc => rc.functionName === funcName || rc.functionName === rawName || rc.functionName.endsWith('.' + rawName));

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
                        this._appendCallsTree(mapLines, calls, projectGraph, '', new Set([`${filePath}::${funcName}`]), fileData.imports || []);
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
                .replace(/`(?:\\[\s\S]|(?!\$\{)[^\\`])*`/g, '""')
                .replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, '""');
        }

        _splitByBracketDepth(str) {
            const result = [];
            let current = '';
            let parenDepth = 0;
            let braceDepth = 0;
            let bracketDepth = 0;

            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                if (char === '(') parenDepth++;
                else if (char === ')') parenDepth--;
                else if (char === '{') braceDepth++;
                else if (char === '}') braceDepth--;
                else if (char === '[') bracketDepth++;
                else if (char === ']') bracketDepth--;

                if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) {
                result.push(current.trim());
            }
            return result;
        }

        _getLineNumber(rawCode, charIndex) {
            if (charIndex < 0 || !rawCode) return 1;
            return rawCode.substring(0, charIndex).split('\n').length;
        }

        _extractBlockBody(code, braceStartIndex) {
            if (braceStartIndex === -1 || braceStartIndex >= code.length) return '';
            let depth = 0;
            let start = -1;
            for (let i = braceStartIndex; i < code.length; i++) {
                if (code[i] === '{') {
                    if (depth === 0) start = i + 1;
                    depth++;
                } else if (code[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        return code.substring(start, i);
                    }
                }
            }
            return code.substring(braceStartIndex + 1);
        }

        _buildImportSymbolTable(imports) {
            const table = {};
            imports.forEach(imp => {
                const path = imp.path;
                const clause = imp.clause || '';

                if (clause.startsWith('* as ')) {
                    const alias = clause.replace('* as ', '').trim();
                    table[alias] = { type: 'namespace', path };
                } else if (clause.startsWith('{') && clause.endsWith('}')) {
                    const items = clause.slice(1, -1).split(',');
                    items.forEach(item => {
                        const parts = item.trim().split(/\s+as\s+/);
                        const original = parts[0].trim();
                        const alias = parts[1] ? parts[1].trim() : original;
                        if (alias) {
                            table[alias] = { type: 'named', original, path };
                        }
                    });
                } else if (clause && clause !== 'dynamic') {
                    const cleanClause = clause.replace(/^(const|let|var)\s+/, '').trim();
                    if (cleanClause.startsWith('{') && cleanClause.endsWith('}')) {
                        const items = cleanClause.slice(1, -1).split(',');
                        items.forEach(item => {
                            const parts = item.trim().split(':');
                            const original = parts[0].trim();
                            const alias = parts[1] ? parts[1].trim() : original;
                            if (alias) {
                                table[alias] = { type: 'named', original, path };
                            }
                        });
                    } else if (cleanClause && !cleanClause.includes('=')) {
                        table[cleanClause] = { type: 'default', path };
                    }
                }
            });
            return table;
        }

        _buildVariableSymbolTable(code, imports) {
            const table = {};

            // 1. Instantiations: const service = new UserService()
            const newInstRegex = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*new\s+([a-zA-Z0-9_]+)/g;
            let match;
            while ((match = newInstRegex.exec(code)) !== null) {
                table[match[1]] = match[2];
            }

            // 2. NestJS / Constructor Dependency Injections: constructor(private readonly userService: UserService)
            const ctorRegex = /constructor\s*\(([\s\S]*?)\)/g;
            while ((match = ctorRegex.exec(code)) !== null) {
                const paramBody = match[1];
                const paramRegex = /(?:private|protected|public)?\s*(?:readonly)?\s*([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)/g;
                let pm;
                while ((pm = paramRegex.exec(paramBody)) !== null) {
                    const varName = pm[1];
                    const className = pm[2];
                    table[varName] = className;
                    table[`this.${varName}`] = className;
                }
            }

            return table;
        }

        _resolveRouterHierarchy(code, rawCode) {
            const parentMap = {};
            const expressUseRegex = /([a-zA-Z0-9_]+)\.use\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z0-9_]+)\s*\)/g;
            let match;
            while ((match = expressUseRegex.exec(rawCode)) !== null) {
                const parentVar = match[1];
                const prefixPath = match[2];
                const childVar = match[3];

                parentMap[childVar] = { parent: parentVar, prefix: prefixPath };
            }

            const resolvedPrefixes = {};
            const resolvePath = (varName, visited = new Set()) => {
                if (visited.has(varName)) return '';
                visited.add(varName);

                if (!parentMap[varName]) {
                    return '';
                }

                const { parent, prefix } = parentMap[varName];
                const parentPrefix = (parent === 'app' || parent === 'server') ? '' : resolvePath(parent, visited);

                let combined = parentPrefix ? (parentPrefix.endsWith('/') ? parentPrefix.slice(0, -1) : parentPrefix) : '';
                combined += prefix.startsWith('/') ? prefix : '/' + prefix;
                return combined;
            };

            Object.keys(parentMap).forEach(childVar => {
                resolvedPrefixes[childVar] = resolvePath(childVar);
            });

            return resolvedPrefixes;
        }

        _parseImports(code, rawCode) {
            const imports = [];
            
            // ES6 Imports: import ... from 'module'
            const es6ImportRegex = /import\s+(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
            let match;
            while ((match = es6ImportRegex.exec(rawCode)) !== null) {
                const clause = match[1] || '';
                const path = match[2];
                imports.push({ path, clause: clause.trim() });
            }

            // Dynamic import: await import('module')
            const dynamicImportRegex = /(?:await\s+)?import\s*\(\s*["']([^"']+)["']\s*\)/g;
            while ((match = dynamicImportRegex.exec(rawCode)) !== null) {
                const path = match[1];
                imports.push({ path, clause: 'dynamic' });
            }

            // CommonJS require: const ... = require('module') or destructuring const { a, b } = require('module')
            const cjsRequireRegex = /(?:(?:const|let|var)\s+([\s\S]*?)\s*=\s*)?require\s*\(\s*["']([^"']+)["']\s*\)/g;
            while ((match = cjsRequireRegex.exec(rawCode)) !== null) {
                const clause = match[1] || '';
                const path = match[2];
                imports.push({ path, clause: clause.trim() });
            }

            return imports;
        }

        _parseExports(code) {
            const exports = [];
            const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+([a-zA-Z0-9_]+)/g;
            let match;
            while ((match = exportRegex.exec(code)) !== null) {
                exports.push(match[1]);
            }

            const exportDefaultObjRegex = /export\s+default\s*\{([\s\S]*?)\}/g;
            while ((match = exportDefaultObjRegex.exec(code)) !== null) {
                const body = match[1];
                const keyRegex = /([a-zA-Z0-9_]+)\s*(?::|\()/g;
                let km;
                while ((km = keyRegex.exec(body)) !== null) {
                    exports.push(km[1]);
                }
            }

            const moduleExportsRegex = /module\.exports\s*=\s*(?:\{([\s\S]*?)\}|([a-zA-Z0-9_]+))/g;
            while ((match = moduleExportsRegex.exec(code)) !== null) {
                if (match[2]) {
                    exports.push(match[2]);
                } else if (match[1]) {
                    const items = match[1].split(',').map(i => i.trim().split(':')[0].trim()).filter(Boolean);
                    exports.push(...items);
                }
            }

            const propExportRegex = /(?:module\.)?exports\.([a-zA-Z0-9_]+)\s*=/g;
            while ((match = propExportRegex.exec(code)) !== null) {
                exports.push(match[1]);
            }

            return Array.from(new Set(exports));
        }

        _detectFramework(content, imports) {
            const impStr = imports.map(i => i.path).join(' ').toLowerCase();
            const raw = content.toLowerCase();

            if (impStr.includes('@nestjs') || raw.includes('@controller') || raw.includes('@injectable')) return 'Node.js + NestJS';
            if (impStr.includes('express') || raw.includes('express()') || raw.includes('express.router')) return 'Node.js + Express';
            if (impStr.includes('fastify') || raw.includes('fastify()')) return 'Node.js + Fastify';
            if (impStr.includes('hono') || raw.includes('new hono')) return 'Node.js + Hono';
            if (impStr.includes('koa') || raw.includes('new koa')) return 'Node.js + Koa';
            if (impStr.includes('http')) return 'Node.js + HTTP';
            return 'Node.js Standard Engine';
        }

        _parseStructure(code) {
            const functions = [];
            const classes = [];
            const methods = [];
            const functionBlocks = [];

            const findBraces = (startIndex) => {
                let startBrace = code.indexOf('{', startIndex);
                if (startBrace === -1) return null;
                let depth = 0;
                for (let i = startBrace; i < code.length; i++) {
                    if (code[i] === '{') depth++;
                    else if (code[i] === '}') {
                        depth--;
                        if (depth === 0) {
                            return { startBrace, endBrace: i };
                        }
                    }
                }
                return null;
            };

            // 1. Match Classes and scoped class methods
            const classRegex = /class\s+([a-zA-Z0-9_]+)\s*\{/g;
            let classMatch;
            while ((classMatch = classRegex.exec(code)) !== null) {
                const className = classMatch[1];
                classes.push(className);

                const classBraces = findBraces(classMatch.index);
                if (!classBraces) continue;

                const classBody = code.substring(classBraces.startBrace + 1, classBraces.endBrace);
                const classMethodRegex = /(?:async\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/g;
                let mMatch;
                const reservedMethod = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor']);
                while ((mMatch = classMethodRegex.exec(classBody)) !== null) {
                    const mName = mMatch[1];
                    if (!reservedMethod.has(mName)) {
                        const mBraceIndex = classBraces.startBrace + 1 + mMatch.index + mMatch[0].length - 1;
                        const mBraces = findBraces(mBraceIndex);
                        const fullName = `${className}.${mName}`;
                        methods.push({ className: className, name: mName });
                        functionBlocks.push({
                            name: fullName,
                            rawName: mName,
                            className: className,
                            startBrace: mBraceIndex,
                            endBrace: mBraces ? mBraces.endBrace : mBraceIndex,
                            type: 'method'
                        });
                    }
                }
            }

            // 2. Match Top-Level Functions (standard, async, arrow functions, exported ones)
            const funcRegex = /(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\s+([a-zA-Z0-9_]+)|(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?(?:function(?:\s+[a-zA-Z0-9_]+)?|\([^)]*\)|[a-zA-Z0-9_]+)\s*=>)/g;
            let match;
            while ((match = funcRegex.exec(code)) !== null) {
                const name = match[1] || match[2];
                if (name && !methods.some(m => m.name === name)) {
                    const braces = findBraces(match.index + match[0].length);
                    if (braces) {
                        functions.push(name);
                        functionBlocks.push({
                            name: name,
                            rawName: name,
                            className: null,
                            startBrace: braces.startBrace,
                            endBrace: braces.endBrace,
                            type: 'function'
                        });
                    }
                }
            }

            // 3. Object Literal Methods & Arrow Functions in Object
            const objBlockRegex = /(?:module\.exports(?:\.[a-zA-Z0-9_]+)?\s*=\s*|exports\.[a-zA-Z0-9_]+\s*=\s*|export\s+default\s+|(?:const|let|var)\s+[a-zA-Z0-9_]+\s*=\s*)\{([\s\S]*?)\}/g;
            let objMatch;
            while ((objMatch = objBlockRegex.exec(code)) !== null) {
                const objBody = objMatch[1];
                const objStart = objMatch.index + objMatch[0].indexOf('{');
                const objMethodRegex = /([a-zA-Z0-9_]+)\s*(?::\s*(?:async\s*)?(?:function(?:\s+[a-zA-Z0-9_]+)?|\([^)]*\)\s*=>|[a-zA-Z0-9_]+)|\([^)]*\))\s*(?:\{|,|\n|$)/g;
                let om;
                const reservedObj = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
                while ((om = objMethodRegex.exec(objBody)) !== null) {
                    const omName = om[1];
                    if (!reservedObj.has(omName) && !functions.includes(omName) && !methods.some(m => m.name === omName)) {
                        const braces = findBraces(objStart + om.index);
                        functions.push(omName);
                        functionBlocks.push({
                            name: omName,
                            rawName: omName,
                            className: null,
                            startBrace: braces ? braces.startBrace : -1,
                            endBrace: braces ? braces.endBrace : -1,
                            type: 'object_method'
                        });
                    }
                }
            }

            // 4. Match DOMContentLoaded listener as entrypoint function if present
            const domMatch = /addEventListener\s*\(\s*["']DOMContentLoaded["']/g.exec(code);
            if (domMatch) {
                const braces = findBraces(domMatch.index);
                if (!functions.includes('DOMContentLoaded')) {
                    functions.push('DOMContentLoaded');
                }
                functionBlocks.push({
                    name: 'DOMContentLoaded',
                    rawName: 'DOMContentLoaded',
                    className: null,
                    startBrace: braces ? braces.startBrace : -1,
                    endBrace: braces ? braces.endBrace : -1,
                    type: 'event'
                });
            }

            return { functions: Array.from(new Set(functions)), classes, methods, functionBlocks };
        }

        _parseEndpoints(code, rawCode, methods = [], functions = []) {
            const endpoints = [];

            // Parse Express Routers & Prefixes recursively: app.use("/api", apiRouter) / apiRouter.use("/user", userRouter)
            const routerPrefixes = this._resolveRouterHierarchy(code, rawCode);

            // NestJS Controller Prefix: @Controller('/user')
            let nestClassPrefix = '';
            const nestControllerRegex = /@Controller\s*\(\s*["']([^"']*)["']\s*\)/i;
            const nestControllerMatch = nestControllerRegex.exec(rawCode);
            if (nestControllerMatch) {
                nestClassPrefix = nestControllerMatch[1] ? (nestControllerMatch[1].startsWith('/') ? nestControllerMatch[1] : '/' + nestControllerMatch[1]) : '';
                if (nestClassPrefix === '/') nestClassPrefix = '';
            }

            // Match Express / Router handlers with middleware chains
            const routeRegex = /([a-zA-Z0-9_]+)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']\s*,([\s\S]*?)\)/gi;
            let match;
            while ((match = routeRegex.exec(rawCode)) !== null) {
                const instanceName = match[1];
                const method = match[2].toUpperCase();
                let subPath = match[3];
                const argsStr = match[4] || '';
                const matchIndex = match.index;
                
                const prefix = routerPrefixes[instanceName] || '';
                let fullPath = prefix ? (prefix.endsWith('/') ? prefix.slice(0, -1) : prefix) + (subPath.startsWith('/') ? subPath : '/' + subPath) : subPath;

                const rawArgs = this._splitByBracketDepth(argsStr);
                let actualHandler = rawArgs[rawArgs.length - 1] || '<anonymous>';
                if (actualHandler.includes('=>') || actualHandler.startsWith('function') || actualHandler.startsWith('async')) {
                    const lineNo = this._getLineNumber(rawCode, matchIndex);
                    actualHandler = `anonymous@line${lineNo}`;
                }
                const middlewares = rawArgs.slice(0, rawArgs.length - 1);

                endpoints.push({
                    method: method,
                    path: fullPath,
                    middlewares: middlewares,
                    handler: actualHandler
                });
            }

            // NestJS Decorators: @Get('/path'), @Post('/path') mapped to target class method
            const nestRouteRegex = /@(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']?([^"']*)["']?\s*\)\s*(?:@\w+\s*\([^)]*\)\s*)*(?:async\s+)?([a-zA-Z0-9_]+)\s*\(/gi;
            while ((match = nestRouteRegex.exec(rawCode)) !== null) {
                const mName = match[3];
                const mObj = methods.find(m => m.name === mName);
                const fullHandler = mObj ? `${mObj.className}.${mName}` : mName;

                let routeSubPath = match[2] || '';
                if (routeSubPath && !routeSubPath.startsWith('/')) {
                    routeSubPath = '/' + routeSubPath;
                }
                let fullNestPath = nestClassPrefix + routeSubPath;
                if (!fullNestPath) fullNestPath = '/';

                endpoints.push({
                    method: match[1].toUpperCase(),
                    path: fullNestPath,
                    middlewares: [],
                    handler: fullHandler
                });
            }

            return endpoints;
        }

        _parseFunctionCallsMap(code, functions, methods, rawCode = null, functionBlocks = []) {
            const map = {};
            const blocks = [...functionBlocks];

            // Match inline anonymous handlers in endpoints
            if (rawCode) {
                const routeRegex = /([a-zA-Z0-9_]+)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']\s*,([\s\S]*?)\)/gi;
                let routeMatch;
                while ((routeMatch = routeRegex.exec(rawCode)) !== null) {
                    const argsStr = routeMatch[4] || '';
                    const rawArgs = this._splitByBracketDepth(argsStr);
                    const actualHandlerStr = rawArgs[rawArgs.length - 1] || '';
                    if (actualHandlerStr.includes('=>') || actualHandlerStr.startsWith('function') || actualHandlerStr.startsWith('async')) {
                        const lineNo = this._getLineNumber(rawCode, routeMatch.index);
                        const synthName = `anonymous@line${lineNo}`;

                        const funcIndexInClean = code.indexOf(actualHandlerStr.trim());
                        const braceIdx = funcIndexInClean !== -1 ? code.indexOf('{', funcIndexInClean) : code.indexOf('{', routeMatch.index);

                        blocks.push({
                            name: synthName,
                            rawName: synthName,
                            className: null,
                            startBrace: braceIdx,
                            endBrace: -1
                        });
                    }
                }
            }

            const imports = this._parseImports(code, rawCode || code);
            const importSymbols = this._buildImportSymbolTable(imports);
            const variableSymbols = this._buildVariableSymbolTable(code, imports);

            for (let i = 0; i < blocks.length; i++) {
                const current = blocks[i];
                if (current.startBrace === -1) continue;

                const body = current.endBrace !== -1 
                    ? code.substring(current.startBrace + 1, current.endBrace) 
                    : this._extractBlockBody(code, current.startBrace);

                map[current.name] = this._parseCalls(body, current.rawName, current.className, importSymbols, variableSymbols);
            }

            return map;
        }

        _parseCalls(code, enclosingFuncName, enclosingClassName = null, importSymbols = {}, variableSymbols = {}) {
            const calls = [];
            const callRegex = /(await\s+)?((?:this\.|[a-zA-Z0-9_.]+\.)?[a-zA-Z0-9_]+)\s*\(/g;
            let match;
            const reserved = new Set([
                'if', 'for', 'while', 'switch', 'require', 'import', 'catch', 'return', 
                'function', 'addEventListener', 'forEach', 'map', 'filter', 'reduce', 
                'then', 'Promise', 'console', 'Object', 'Array', 'String', 'Number', 'Boolean'
            ]);

            while ((match = callRegex.exec(code)) !== null) {
                const isAsync = Boolean(match[1]);
                let call = match[2];

                if (call.startsWith('this.') && enclosingClassName) {
                    call = call.replace(/^this\./, `${enclosingClassName}.`);
                }

                // Resolve variable assignment instance / DI symbol
                if (call.includes('.')) {
                    const parts = call.split('.');
                    const targetVar = parts[0];
                    const methodProp = parts.slice(1).join('.');

                    if (variableSymbols[targetVar]) {
                        call = `${variableSymbols[targetVar]}.${methodProp}`;
                    } else if (importSymbols[targetVar]) {
                        if (importSymbols[targetVar].type === 'namespace' || importSymbols[targetVar].type === 'default') {
                            call = `${targetVar}.${methodProp}`;
                        }
                    }
                } else if (importSymbols[call]) {
                    if (importSymbols[call].type === 'named') {
                        call = importSymbols[call].original || call;
                    }
                }

                const rawName = call.includes('.') ? call.split('.').pop() : call;

                if (!reserved.has(rawName) && rawName !== enclosingFuncName) {
                    const formattedCall = (isAsync ? 'await ' : '') + call;
                    if (!calls.includes(formattedCall)) {
                        calls.push(formattedCall);
                    }
                }
            }

            return calls;
        }

        _inferTypeAndPurpose(filePath, functions, classes, endpoints, content) {
            const lower = filePath.toLowerCase();
            let type = 'Node.js Module';
            let purpose = 'General Logic Processing';

            if (endpoints.length > 0 || lower.includes('controller') || lower.includes('handler') || lower.includes('route')) {
                type = 'HTTP Handler';
                purpose = 'Handle HTTP Requests & Route Dispatching';
            } else if (lower.includes('service')) {
                type = 'Service Layer';
                purpose = 'Business Logic Execution';
            } else if (lower.includes('repo') || lower.includes('model') || lower.includes('entity') || lower.includes('dao')) {
                type = 'Repository / Model';
                purpose = 'Database Operations & Data Access';
            } else if (lower.includes('middleware')) {
                type = 'Middleware';
                purpose = 'Request Interception & Processing';
            } else if (lower.includes('app.') || lower.includes('server.') || lower.includes('index.')) {
                type = 'Application Entrypoint';
                purpose = 'Initialize and Start Server Engine';
            }

            return { type, purpose };
        }

        _appendCallsTree(mapLines, calls, projectGraph, indent, visited = new Set(), currentImports = []) {
            const fileKeys = Object.keys(projectGraph.files || {});
            const symbolIndex = projectGraph.symbolIndex || {};
            const importSymbols = this._buildImportSymbolTable(currentImports);

            const filteredCalls = calls.filter(call => {
                const cleanCall = call.replace(/^await\s+/, '');
                const rawCall = cleanCall.includes('.') ? cleanCall.split('.').pop() : cleanCall;
                return !this.ignoredBuiltins.has(cleanCall) && !this.ignoredBuiltins.has(rawCall);
            });

            filteredCalls.forEach((call, index) => {
                const isLast = index === filteredCalls.length - 1;
                const prefix = isLast ? '└── ' : '├── ';
                const childIndent = isLast ? '    ' : '│   ';

                mapLines.push(`${indent}${prefix}${call}()`);

                // Find defining file
                let definedIn = null;
                let targetFileData = null;
                const cleanCall = call.replace(/^await\s+/, '');
                const rawCall = cleanCall.includes('.') ? cleanCall.split('.').pop() : cleanCall;

                // 1. Resolve through Import Symbol Table if applicable
                const pkgPrefix = cleanCall.includes('.') ? cleanCall.split('.')[0] : cleanCall;
                if (importSymbols[pkgPrefix]) {
                    const targetPath = importSymbols[pkgPrefix].path;
                    for (const fk of fileKeys) {
                        if (fk.includes(targetPath) || fk.endsWith(targetPath) || fk.endsWith(targetPath + '.js') || fk.endsWith(targetPath + '.ts')) {
                            definedIn = fk;
                            targetFileData = projectGraph.files[fk];
                            break;
                        }
                    }
                }

                // 2. Lookup in O(1) symbolIndex
                if (!definedIn) {
                    const candidates = symbolIndex[cleanCall] || symbolIndex[rawCall];
                    if (candidates && candidates.size > 0) {
                        definedIn = Array.from(candidates)[0];
                        targetFileData = projectGraph.files[definedIn];
                    }
                }

                // 3. Fallback to global index matching
                if (!definedIn) {
                    for (const fk of fileKeys) {
                        const fData = projectGraph.files[fk];
                        if (
                            fData.functions.includes(cleanCall) || 
                            fData.functions.includes(rawCall) || 
                            fData.methods.some(m => m.name === cleanCall || m.name === rawCall || `${m.className}.${m.name}` === cleanCall)
                        ) {
                            definedIn = fk;
                            targetFileData = fData;
                            break;
                        }
                    }
                }

                if (definedIn) {
                    mapLines.push(`${indent}${childIndent}└── ${definedIn}`);
                    const visitKey = `${definedIn}::${cleanCall}`;
                    if (!visited.has(visitKey)) {
                        const nextVisited = new Set(visited).add(visitKey);
                        const nestedCalls = (targetFileData.functionCallsMap && (targetFileData.functionCallsMap[cleanCall] || targetFileData.functionCallsMap[rawCall])) || [];
                        if (nestedCalls.length > 0) {
                            this._appendCallsTree(mapLines, nestedCalls, projectGraph, indent + childIndent, nextVisited, targetFileData.imports || []);
                        }
                    }
                } else if (cleanCall.includes('.')) {
                    // Match import alias resolution
                    const matchedImpObj = currentImports.find(imp => {
                        if (imp.path.endsWith('/' + pkgPrefix) || imp.path === pkgPrefix) return true;
                        if (imp.clause && (imp.clause.includes(pkgPrefix) || imp.clause.includes(`as ${pkgPrefix}`))) return true;
                        return false;
                    });

                    if (matchedImpObj) {
                        mapLines.push(`${indent}${childIndent}└── ${matchedImpObj.path}`);
                    } else {
                        mapLines.push(`${indent}${childIndent}└── ${pkgPrefix}`);
                    }
                }
            });
        }
    }

    // Register instance to BackendParserRegistry
    if (window.BackendParserRegistry) {
        window.BackendParserRegistry.register('node', new NodeParser());
    }
})();
