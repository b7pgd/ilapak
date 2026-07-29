(function () {
    'use strict';

    /**
     * Senior Node.js Static Analyzer and JavaScript Parser Engineer implementation
     * Parser for Node.js Backend Graph LIR Engine
     */
    class NodeParser {
        constructor() {
            this.name = 'node';
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

            const cleanCode = this._removeCommentsAndStrings(content);

            const imports = this._parseImports(cleanCode, content);
            const exports = this._parseExports(cleanCode);
            const framework = this._detectFramework(content, imports);
            const { functions, classes, methods } = this._parseStructure(cleanCode);
            const endpoints = this._parseEndpoints(cleanCode, content);
            const calls = this._parseCalls(cleanCode);
            const typeAndPurpose = this._inferTypeAndPurpose(filePath, functions, classes, endpoints, content);

            // Populate projectGraph
            projectGraph.imports[filePath] = imports;
            projectGraph.functions[filePath] = functions;
            projectGraph.classes[filePath] = classes;
            projectGraph.methods[filePath] = methods;
            projectGraph.endpointGraph[filePath] = endpoints;
            projectGraph.callGraph[filePath] = calls;

            if (endpoints.length > 0) {
                projectGraph.handlers[filePath] = functions.concat(methods.map(m => m.name));
            }

            if (filePath.toLowerCase().includes('service')) {
                projectGraph.services[filePath] = functions.concat(methods.map(m => m.name));
            }

            if (filePath.toLowerCase().includes('repo') || filePath.toLowerCase().includes('model') || filePath.toLowerCase().includes('db')) {
                projectGraph.repositories[filePath] = functions.concat(methods.map(m => m.name));
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
                calls: calls
            };
        }

        /**
         * Cross-reference links after all files are parsed.
         * Builds reverseCallGraph and caller relationship maps.
         * @param {Object} projectGraph 
         */
        buildCrossReferences(projectGraph) {
            const files = Object.keys(projectGraph.callGraph || {});

            files.forEach(srcFile => {
                const calls = projectGraph.callGraph[srcFile] || [];
                calls.forEach(callName => {
                    files.forEach(targetFile => {
                        const funcs = projectGraph.functions[targetFile] || [];
                        const methods = (projectGraph.methods[targetFile] || []).map(m => m.name);
                        
                        if (funcs.includes(callName) || methods.includes(callName)) {
                            if (!projectGraph.reverseCallGraph[targetFile]) {
                                projectGraph.reverseCallGraph[targetFile] = [];
                            }
                            projectGraph.reverseCallGraph[targetFile].push({
                                callerFile: srcFile,
                                functionName: callName
                            });
                        }
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
            const calls = fileData.calls || [];

            const reverseCalls = projectGraph.reverseCallGraph[filePath] || [];
            const callers = Array.from(new Set(reverseCalls.map(rc => rc.callerFile)));

            let mapLines = [];

            if (endpoints.length > 0) {
                endpoints.forEach((ep) => {
                    mapLines.push(`${ep.method} ${ep.path}`);
                    mapLines.push('│');
                    mapLines.push('├── Called By');
                    if (callers.length > 0) {
                        callers.forEach(c => mapLines.push(`│   └── ${c}`));
                    } else {
                        mapLines.push('│   └── External Client / Router');
                    }
                    mapLines.push('│');

                    const primaryHandler = ep.handler || (functions[0] || (methods[0] ? methods[0].name : 'handler'));
                    mapLines.push(`└── ${primaryHandler}()`);
                    
                    this._appendCallsTree(mapLines, calls, projectGraph, '    ');
                });
            } else {
                const rootName = functions[0] || (methods[0] ? `${methods[0].className}.${methods[0].name}` : 'Module');
                mapLines.push(`${rootName}`);
                mapLines.push('│');
                mapLines.push('├── Called By');
                if (callers.length > 0) {
                    callers.forEach(c => mapLines.push(`│   └── ${c}`));
                } else {
                    mapLines.push('│   └── Internal / Unindexed Caller');
                }
                mapLines.push('│');

                if (calls.length > 0) {
                    mapLines.push('└── Operations');
                    this._appendCallsTree(mapLines, calls, projectGraph, '    ');
                } else {
                    mapLines.push('└── [No internal/external calls detected]');
                }
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
                .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
        }

        _parseImports(code, rawCode) {
            const imports = [];
            
            // ES6 Imports: import ... from 'module'
            const es6ImportRegex = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
            let match;
            while ((match = es6ImportRegex.exec(rawCode)) !== null) {
                imports.push(match[1]);
            }

            // CommonJS require: require('module')
            const cjsRequireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
            while ((match = cjsRequireRegex.exec(rawCode)) !== null) {
                imports.push(match[1]);
            }

            return Array.from(new Set(imports));
        }

        _parseExports(code) {
            const exports = [];
            const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+([a-zA-Z0-9_]+)/g;
            let match;
            while ((match = exportRegex.exec(code)) !== null) {
                exports.push(match[1]);
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

            return Array.from(new Set(exports));
        }

        _detectFramework(content, imports) {
            const impStr = imports.join(' ').toLowerCase();
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

            // Match functions: function name() or const name = () =>
            const funcRegex = /(?:function\s+([a-zA-Z0-9_]+)|(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
            let match;
            while ((match = funcRegex.exec(code)) !== null) {
                const name = match[1] || match[2];
                if (name) functions.push(name);
            }

            // Match classes and methods
            const classRegex = /class\s+([a-zA-Z0-9_]+)/g;
            while ((match = classRegex.exec(code)) !== null) {
                classes.push(match[1]);
            }

            const methodRegex = /(?:async\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/g;
            while ((match = methodRegex.exec(code)) !== null) {
                const name = match[1];
                const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor']);
                if (!reserved.has(name) && !functions.includes(name)) {
                    methods.push({ className: classes[0] || 'AnonymousClass', name: name });
                }
            }

            return { functions: Array.from(new Set(functions)), classes, methods };
        }

        _parseEndpoints(code, rawCode) {
            const endpoints = [];

            // Match app.get('/path', handler), router.post('/path', handler), fastify.put('/path', handler), hono.delete('/path', handler)
            const routeRegex = /(?:app|router|fastify|hono|server)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z0-9_\.]+)?/gi;
            let match;
            while ((match = routeRegex.exec(rawCode)) !== null) {
                endpoints.push({
                    method: match[1].toUpperCase(),
                    path: match[2],
                    handler: match[3] || 'anonymousHandler'
                });
            }

            // NestJS Decorators: @Get('/path'), @Post('/path')
            const nestRouteRegex = /@(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']?([^"']*)["']?\s*\)/gi;
            while ((match = nestRouteRegex.exec(rawCode)) !== null) {
                endpoints.push({
                    method: match[1].toUpperCase(),
                    path: match[2] || '/',
                    handler: 'NestControllerMethod'
                });
            }

            return endpoints;
        }

        _parseCalls(code) {
            const calls = [];
            // Match func() or obj.method() or res.json()
            const callRegex = /([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/g;
            let match;
            const reserved = new Set(['if', 'for', 'while', 'switch', 'require', 'import', 'catch', 'return', 'function']);

            while ((match = callRegex.exec(code)) !== null) {
                const call = match[1];
                if (!reserved.has(call) && !calls.includes(call)) {
                    calls.push(call);
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

        _appendCallsTree(mapLines, calls, projectGraph, indent) {
            const fileKeys = Object.keys(projectGraph.files || {});

            calls.forEach((call, index) => {
                const isLast = index === calls.length - 1;
                const prefix = isLast ? '└── ' : '├── ';
                const childIndent = isLast ? '    ' : '│   ';

                mapLines.push(`${indent}${prefix}${call}()`);

                // Find defining file
                let definedIn = null;
                for (const fk of fileKeys) {
                    const fData = projectGraph.files[fk];
                    if (fData.functions.includes(call) || fData.methods.some(m => m.name === call || `${m.className}.${m.name}` === call)) {
                        definedIn = fk;
                        break;
                    }
                }

                if (definedIn) {
                    mapLines.push(`${indent}${childIndent}└── ${definedIn}`);
                }
            });
        }
    }

    // Register instance to BackendParserRegistry
    if (window.BackendParserRegistry) {
        window.BackendParserRegistry.register('node', new NodeParser());
    }
})();
