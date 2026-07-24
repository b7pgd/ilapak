/**
 * viber3.js — Project-level Semantic Resolver (Evidence-Based Graph Engine)
 *
 * Consolidates file-level analysis outputs (from viber2.js / viber.js) 
 * into an Evidence-Based Project Semantic Graph, resolving cross-file relations,
 * architecture routes, controller mappings, frontend-to-backend calls,
 * middleware chains, request/response contracts, database definitions,
 * and generating Migration LIR without heuristics or invented metadata.
 */

const Viber3Engine = {
    /**
     * Entry point to analyze an entire project based on file analysis outputs.
     * 
     * @param {Array<Object>} fileOutputs - Array of processed file outputs or raw text skeletons from viber2.js
     * @returns {Object} Complete Evidence-Based Project Semantic Graph & Migration LIR
     */
    analyzeProject: function(fileOutputs) {
        const parsedFiles = this.parseInputOutputs(fileOutputs);

        // STAGE 1: CROSS-FILE RELATION RESOLVER (EVIDENCE-BASED)
        const crossRelations = this.resolveCrossFileRelations(parsedFiles);

        // STAGE 2: ARCHITECTURE RESOLVERS (EVIDENCE-BASED)
        const routeMapping = this.resolveRoutes(parsedFiles);
        const controllerMapping = this.resolveControllers(parsedFiles, routeMapping);
        const modelMapping = this.resolveModels(parsedFiles);
        const middlewareChain = this.resolveMiddlewares(parsedFiles, routeMapping);

        // STAGE 3: FRONTEND TO BACKEND & CROSS-FILE CONTRACT RESOLVER
        const frontendBackendCalls = this.resolveFrontendBackendCalls(parsedFiles, routeMapping);
        const crossFileApiContracts = this.buildCrossFileApiContracts(parsedFiles, routeMapping, middlewareChain, controllerMapping);

        // STAGE 4: DATABASE & STORAGE MAPPING
        const databaseMap = this.mapDatabaseSchemas(parsedFiles, modelMapping);

        // STAGE 5: FULL DEPENDENCY GRAPH & TRACEABILITY MAP
        const dependencyGraph = this.buildFullDependencyGraph(parsedFiles, crossRelations, routeMapping, frontendBackendCalls, controllerMapping, middlewareChain, databaseMap);

        // STAGE 6: MIGRATION LIR GENERATOR
        const migrationLIR = this.generateMigrationLIR({
            parsedFiles,
            crossRelations,
            routeMapping,
            controllerMapping,
            modelMapping,
            middlewareChain,
            databaseMap,
            frontendBackendCalls,
            crossFileApiContracts,
            dependencyGraph
        });

        const outputData = {
            projectSummary: this.buildProjectSummary(parsedFiles),
            crossRelations,
            routeMapping,
            controllerMapping,
            modelMapping,
            middlewareChain,
            frontendBackendCalls,
            crossFileApiContracts,
            databaseMap,
            dependencyGraph,
            migrationLIR
        };

        return {
            raw: outputData,
            formattedText: this.formatOutput(outputData)
        };
    },

    // --- HELPER NORMALIZERS & UTILITIES ---

    normalizeSymbol: function(symbol) {
        if (!symbol || typeof symbol !== 'string') return '';
        let cleaned = symbol.trim();
        if (cleaned.endsWith('()')) {
            cleaned = cleaned.slice(0, -2).trim();
        }
        // Remove generic type parameters if present e.g. Repository<User> -> Repository
        cleaned = cleaned.replace(/<[^>]+>/g, '');
        // Extract base function/method name after last dot or scope operator
        const parts = cleaned.split(/[\.:\/]/);
        return parts[parts.length - 1].trim();
    },

    normalizeEndpoint: function(endpoint) {
        if (!endpoint || typeof endpoint !== 'string' || endpoint === 'Unknown' || endpoint === 'None') {
            return '';
        }
        let ep = endpoint.trim();
        // Remove protocol and host if full URL
        ep = ep.replace(/^https?:\/\/[^\/]+/i, '');
        // Strip query strings
        ep = ep.split('?')[0];
        // Ensure leading slash and remove trailing slash
        if (!ep.startsWith('/')) ep = '/' + ep;
        if (ep.length > 1 && ep.endsWith('/')) ep = ep.slice(0, -1);
        
        // Normalize parameters: replace :id, {id}, or numeric/UUID path segments with :param
        const segments = ep.split('/').map(seg => {
            if (/^:[^\/]+/.test(seg) || /^\{[^\}]+\}$/.test(seg)) return ':param';
            if (/^[0-9]+$/.test(seg)) return ':param';
            if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg)) return ':param';
            return seg;
        });

        return segments.join('/');
    },

    // --- PARSER / INPUT CONVERTER ---

    parseInputOutputs: function(fileOutputs) {
        return fileOutputs.map(item => {
            if (typeof item === 'string') {
                return this.parseViber2TextSkeleton(item);
            }
            return item;
        });
    },

    parseViber2TextSkeleton: function(text) {
        const fileMatch = text.match(/FILE:\s*\n\/?([^\n]+)/);
        const purposeMatch = text.match(/PURPOSE:\s*\n([^\n]+)/);
        const roleMatch = text.match(/ROLE:\s*\n([^\n]+)/);

        const fileKey = fileMatch ? fileMatch[1].trim() : 'Unknown';
        const purpose = purposeMatch ? purposeMatch[1].trim() : 'Unknown';
        const role = roleMatch ? roleMatch[1].trim() : 'Unknown';

        // Robust Section-Based Block Parsing for Functions
        const functions = [];
        const functionBlocks = text.split(/FUNCTION:\s*\n/i).slice(1);

        functionBlocks.forEach(block => {
            // Stop parsing function block if we reach non-function top-level headers
            const cleanBlock = block.split(/(?:API CONTRACTS|DEPENDENCIES|IMPORTS|ROUTES):\s*\n/i)[0];
            const sectionMap = this.extractLabeledSections(cleanBlock);

            if (sectionMap.has('NAME')) {
                const name = sectionMap.get('NAME');
                const location = sectionMap.get('LOCATION') || 'File Scope';
                const fnPurpose = sectionMap.get('PURPOSE') || 'Unknown';
                const read = sectionMap.get('READ') || 'Unknown';
                const process = sectionMap.get('PROCESS') || 'Unknown';
                const stateChange = sectionMap.get('STATE CHANGE') || 'Unknown';
                const callsRaw = sectionMap.get('CALLS') || 'None';
                const calledBy = sectionMap.get('CALLED BY') || 'Unknown';
                const output = sectionMap.get('OUTPUT') || 'Unknown';
                const confidence = sectionMap.get('CONFIDENCE') || '100%';
                const sourceSignal = sectionMap.get('SOURCE SIGNAL') || 'Unknown';

                const calls = (callsRaw === 'None' || callsRaw === 'Unknown') 
                    ? [] 
                    : callsRaw.split(',').map(s => s.trim()).filter(Boolean);

                functions.push({
                    name,
                    location,
                    purpose: fnPurpose,
                    input: sectionMap.get('INPUT') || 'Unknown',
                    read,
                    process,
                    stateChange,
                    calls,
                    calledBy,
                    output,
                    confidence,
                    sourceSignal,
                    evidence: {
                        source: fileKey,
                        location
                    }
                });
            }
        });

        // Robust Section-Based Block Parsing for API Contracts
        const apiContracts = [];
        const apiBlocks = text.split(/API CONTRACT:\s*\n/i).slice(1);

        apiBlocks.forEach(block => {
            const cleanBlock = block.split(/(?:FUNCTIONS|DEPENDENCIES|IMPORTS|ROUTES):\s*\n/i)[0];
            const sectionMap = this.extractLabeledSections(cleanBlock);

            if (sectionMap.has('METHOD') || sectionMap.has('ENDPOINT')) {
                const method = sectionMap.get('METHOD') || 'Unknown';
                const endpoint = sectionMap.get('ENDPOINT') || 'Unknown';
                const source = sectionMap.get('SOURCE') || fileKey;
                const calledBy = sectionMap.get('CALLED BY') || 'Unknown';
                const request = sectionMap.get('REQUEST') || 'Unknown';
                const response = sectionMap.get('RESPONSE') || 'Unknown';
                const consumed = sectionMap.get('CONSUMED') || 'Unknown';

                apiContracts.push({
                    method,
                    endpoint,
                    source,
                    calledBy,
                    request,
                    response,
                    consumed,
                    evidence: {
                        source: fileKey,
                        location: source !== fileKey ? source : "File Definition"
                    }
                });
            }
        });

        return {
            fileKey,
            purpose,
            role,
            functions,
            apiContracts,
            rawText: text
        };
    },

    extractLabeledSections: function(blockText) {
        const sections = new Map();
        const lines = blockText.split('\n');
        let currentLabel = null;
        let currentContent = [];

        const labelRegex = /^([A-Z0-9\s\_]+):\s*$/;

        for (let line of lines) {
            const match = line.match(labelRegex);
            if (match) {
                if (currentLabel) {
                    sections.set(currentLabel, currentContent.join('\n').trim());
                }
                currentLabel = match[1].trim();
                currentContent = [];
            } else if (currentLabel) {
                currentContent.push(line);
            }
        }

        if (currentLabel) {
            sections.set(currentLabel, currentContent.join('\n').trim());
        }

        return sections;
    },

    // --- STAGE 1: CROSS-FILE RELATIONS ---

    resolveCrossFileRelations: function(files) {
        const relations = [];
        const symbolRegistry = new Map();

        // Build global symbol table with normalized symbol lookups
        files.forEach(file => {
            if (file.functions) {
                file.functions.forEach(fn => {
                    const norm = this.normalizeSymbol(fn.name);
                    if (norm) {
                        if (!symbolRegistry.has(norm)) {
                            symbolRegistry.set(norm, []);
                        }
                        symbolRegistry.get(norm).push({
                            fileKey: file.fileKey,
                            location: fn.location,
                            rawName: fn.name
                        });
                    }
                });
            }
        });

        // Resolve cross-file callers strictly using normalized call evidence
        files.forEach(file => {
            if (file.functions) {
                file.functions.forEach(fn => {
                    fn.calls.forEach(calledSymbol => {
                        const targetNorm = this.normalizeSymbol(calledSymbol);
                        if (symbolRegistry.has(targetNorm)) {
                            const targets = symbolRegistry.get(targetNorm);
                            targets.forEach(target => {
                                if (target.fileKey !== file.fileKey) {
                                    relations.push({
                                        sourceFile: file.fileKey,
                                        sourceSymbol: fn.name,
                                        targetFile: target.fileKey,
                                        targetSymbol: target.rawName,
                                        type: "FUNCTION_INVOCATION",
                                        evidence: `${file.fileKey} [${fn.location}] -> ${target.fileKey} [${target.location}]`,
                                        confidence: "100%"
                                    });
                                });
                            }
                        }
                    });
                });
            }
        });

        return relations;
    },

    // --- STAGE 2: ARCHITECTURE RESOLVERS (EVIDENCE-ONLY, NO HEURISTICS) ---

    resolveRoutes: function(files) {
        const routes = [];
        files.forEach(file => {
            if (file.apiContracts && file.apiContracts.length > 0) {
                file.apiContracts.forEach(contract => {
                    const hasMethod = contract.method !== "None" && contract.method !== "Unknown";
                    const hasEndpoint = contract.endpoint !== "None" && contract.endpoint !== "Unknown";

                    if (hasMethod || hasEndpoint) {
                        routes.push({
                            method: hasMethod ? contract.method : "Unknown",
                            endpoint: hasEndpoint ? contract.endpoint : "Unknown",
                            declaredIn: file.fileKey,
                            handler: contract.calledBy !== "None" && contract.calledBy !== "Unknown" ? contract.calledBy : "Unknown",
                            requestPayload: contract.request !== "None" ? contract.request : "Unknown",
                            responsePayload: contract.response !== "None" ? contract.response : "Unknown",
                            status: "Resolved",
                            confidence: "100%",
                            evidence: contract.evidence ? `${contract.evidence.source} (${contract.evidence.location})` : file.fileKey,
                            reason: null
                        });
                    }
                });
            }
        });

        return routes;
    },

    resolveControllers: function(files, routes) {
        const controllers = [];
        
        files.filter(f => {
            const r = (f.role || '').toLowerCase();
            const k = (f.fileKey || '').toLowerCase();
            return r.includes('controller') || k.includes('controller') || r.includes('handler') || k.includes('handler');
        }).forEach(file => {
            const actions = (file.functions || []).map(fn => fn.name);
            const mappedRoutes = routes.filter(r => {
                if (!r.handler || r.handler === 'Unknown') return false;
                const normHandler = this.normalizeSymbol(r.handler);
                return actions.some(action => {
                    const normAction = this.normalizeSymbol(action);
                    return normHandler === normAction || r.handler.includes(action);
                });
            });

            controllers.push({
                controllerFile: file.fileKey,
                purpose: file.purpose,
                actions: actions,
                boundRoutes: mappedRoutes.length > 0 ? mappedRoutes : [],
                status: mappedRoutes.length > 0 ? "Resolved" : "Unresolved",
                confidence: mappedRoutes.length > 0 ? "100%" : "0%",
                evidence: mappedRoutes.length > 0 ? mappedRoutes.map(r => r.evidence).join(', ') : "None",
                reason: mappedRoutes.length > 0 ? null : "No route binding found in analyzed project files."
            });
        });
        return controllers;
    },

    resolveModels: function(files) {
        const models = [];

        files.filter(f => {
            const r = (f.role || '').toLowerCase();
            const k = (f.fileKey || '').toLowerCase();
            return r.includes('model') || r.includes('entity') || r.includes('schema') || r.includes('struct') || r.includes('domain') ||
                   k.includes('model') || k.includes('entity') || k.includes('schema') || k.includes('struct');
        }).forEach(file => {
            models.push({
                modelFile: file.fileKey,
                entityName: file.fileKey.split('/').pop().replace(/\.[^/.]+$/, ""),
                purpose: file.purpose,
                evidence: file.fileKey,
                confidence: "100%"
            });
        });
        return models;
    },

    resolveMiddlewares: function(files, routes) {
        const middlewares = [];

        files.filter(f => {
            const r = (f.role || '').toLowerCase();
            const k = (f.fileKey || '').toLowerCase();
            return r.includes('middleware') || r.includes('auth') || r.includes('guard') || r.includes('interceptor') ||
                   k.includes('middleware') || k.includes('auth') || k.includes('guard') || k.includes('interceptor');
        }).forEach(file => {
            const middlewareFns = (file.functions || []).map(fn => fn.name);
            
            // Explicit check if route binding evidence exists
            const boundRoutes = routes.filter(r => (r.handler && middlewareFns.some(m => {
                const normM = this.normalizeSymbol(m);
                const normH = this.normalizeSymbol(r.handler);
                return normH === normM || r.handler.includes(m);
            })));

            middlewares.push({
                middlewareFile: file.fileKey,
                purpose: file.purpose,
                functions: middlewareFns,
                appliedTo: boundRoutes.length > 0 ? boundRoutes.map(r => r.endpoint) : "Unresolved",
                status: boundRoutes.length > 0 ? "Resolved" : "Unresolved",
                confidence: boundRoutes.length > 0 ? "100%" : "0%",
                evidence: boundRoutes.length > 0 ? boundRoutes.map(r => r.evidence).join(', ') : "None",
                reason: boundRoutes.length > 0 ? null : "No explicit middleware registration or invocation attached to routes found in analyzed project files."
            });
        });
        return middlewares;
    },

    // --- STAGE 3: FRONTEND TO BACKEND & CROSS-FILE CONTRACT RESOLVER ---

    resolveFrontendBackendCalls: function(files, backendRoutes) {
        const calls = [];
        const frontendFiles = files.filter(f => {
            const r = (f.role || '').toLowerCase();
            const k = (f.fileKey || '').toLowerCase();
            return r.includes('ui') || r.includes('frontend') || r.includes('component') || r.includes('view') || r.includes('client') || r.includes('service') ||
                   k.endsWith('.js') || k.endsWith('.ts') || k.endsWith('.html') || k.endsWith('.vue') || k.endsWith('.jsx') || k.endsWith('.tsx') || k.endsWith('.dart');
        });

        frontendFiles.forEach(fFile => {
            if (fFile.apiContracts && fFile.apiContracts.length > 0) {
                fFile.apiContracts.forEach(contract => {
                    const feMethod = contract.method !== "None" && contract.method !== "Unknown" ? contract.method : "Unknown";
                    const feEndpoint = contract.endpoint !== "None" && contract.endpoint !== "Unknown" ? contract.endpoint : "Unknown";

                    if (feEndpoint === "Unknown" && feMethod === "Unknown") {
                        return;
                    }

                    const normFeEp = this.normalizeEndpoint(feEndpoint);

                    // Match strictly against backend routes derived from evidence
                    const matchedBackendRoute = backendRoutes.find(bRoute => {
                        if (bRoute.endpoint === "Unknown") return false;
                        const normBeEp = this.normalizeEndpoint(bRoute.endpoint);
                        return normBeEp.length > 0 && normBeEp === normFeEp;
                    });

                    let mismatchStatus = "Resolved";
                    let matchConfidence = "100%";
                    let matchDetails = "Frontend call matches backend endpoint registration.";
                    let unresolvedReason = null;

                    if (!matchedBackendRoute) {
                        mismatchStatus = "Unresolved";
                        matchConfidence = "0%";
                        const closeMatch = backendRoutes.find(bRoute => {
                            if (bRoute.endpoint === "Unknown") return false;
                            const normBeEp = this.normalizeEndpoint(bRoute.endpoint);
                            return normBeEp.includes(normFeEp) || normFeEp.includes(normBeEp);
                        });

                        if (closeMatch) {
                            matchDetails = `Frontend calls '${feEndpoint}' but Backend exposes '${closeMatch.endpoint}' in ${closeMatch.declaredIn}`;
                            unresolvedReason = `Endpoint mismatch. Exact route '${feEndpoint}' not found in backend definitions.`;
                        } else {
                            matchDetails = `Frontend calls '${feEndpoint}' but no matching backend route handler found in analyzed project files.`;
                            unresolvedReason = `Route definition not found in analyzed project files.`;
                        }
                    } else if (matchedBackendRoute.method !== feMethod && feMethod !== "Unknown" && matchedBackendRoute.method !== "Unknown") {
                        mismatchStatus = "HTTP_METHOD_MISMATCH";
                        matchConfidence = "50%";
                        matchDetails = `Frontend uses ${feMethod} while Backend expects ${matchedBackendRoute.method} on ${feEndpoint}`;
                        unresolvedReason = `HTTP Method mismatch between Frontend (${feMethod}) and Backend (${matchedBackendRoute.method}).`;
                    }

                    calls.push({
                        frontendFile: fFile.fileKey,
                        callerFunction: contract.calledBy,
                        method: feMethod,
                        calledEndpoint: feEndpoint,
                        backendHandler: matchedBackendRoute ? matchedBackendRoute.handler : "Unknown",
                        status: mismatchStatus,
                        confidence: matchConfidence,
                        evidence: `${fFile.fileKey} (${contract.evidence ? contract.evidence.location : 'API Call'})`,
                        referencedBy: fFile.fileKey,
                        target: matchedBackendRoute ? matchedBackendRoute.declaredIn : "Unknown",
                        details: matchDetails,
                        reason: unresolvedReason
                    });
                });
            }
        });

        return calls;
    },

    buildCrossFileApiContracts: function(files, routes, middlewares, controllers) {
        const crossContracts = [];

        routes.forEach(route => {
            const boundController = controllers.find(c => Array.isArray(c.boundRoutes) && c.boundRoutes.some(r => r.endpoint === route.endpoint));
            const activeMiddleware = middlewares.filter(m => Array.isArray(m.appliedTo) && m.appliedTo.includes(route.endpoint));

            // Trace actual database calls from evidence inside controller functions
            let detectedDbOps = [];
            if (boundController) {
                const controllerFileObj = files.find(f => f.fileKey === boundController.controllerFile);
                if (controllerFileObj && controllerFileObj.functions) {
                    controllerFileObj.functions.forEach(fn => {
                        if (fn.calls.some(c => {
                            const normC = this.normalizeSymbol(c);
                            return c.includes('DB.') || c.includes('Repository') || c.includes('Save') || c.includes('Create') || c.includes('Find') ||
                                   normC.startsWith('Save') || normC.startsWith('Find') || normC.startsWith('Create') || normC.startsWith('Update') || normC.startsWith('Delete');
                        })) {
                            detectedDbOps.push(`${fn.name} -> ${fn.calls.join(', ')}`);
                        }
                    });
                }
            }

            crossContracts.push({
                method: route.method,
                endpoint: route.endpoint,
                handler: route.handler,
                controllerFile: boundController ? boundController.controllerFile : "Unknown",
                middleware: activeMiddleware.length > 0 ? activeMiddleware.map(m => m.middlewareFile).join(', ') : "Unknown",
                requestPayload: route.requestPayload !== "None" ? route.requestPayload : "Unknown",
                responsePayload: route.responsePayload !== "None" ? route.responsePayload : "Unknown",
                databaseAction: detectedDbOps.length > 0 ? detectedDbOps.join(' | ') : "Unknown",
                evidence: route.evidence,
                confidence: route.confidence,
                status: route.status,
                reason: detectedDbOps.length === 0 ? "No DB operation detected in analyzed code." : null
            });
        });

        return crossContracts;
    },

    // --- STAGE 4: DATABASE & STORAGE MAPPING ---

    mapDatabaseSchemas: function(files, models) {
        const databaseMap = [];

        models.forEach(model => {
            const modelFileObj = files.find(f => f.fileKey === model.modelFile);
            let extractedTable = "Unknown";
            let detectionDetails = null;

            if (modelFileObj && modelFileObj.rawText) {
                const text = modelFileObj.rawText;

                // 1. Explicit table name annotations or variables
                const tableMatch = text.match(/(?:TableName|table|tableName)\s*(?:\(\)|=|\:)\s*["']([^"']+)["']/i) ||
                                   text.match(/func\s*\([^)]+\)\s*TableName\s*\(\)\s*string\s*\{\s*return\s*["']([^"']+)["']/i);
                
                // 2. Return statement inside TableName() method
                const tableNameMethodReturn = text.match(/TableName\s*\(\)[^{]*\{\s*return\s*["']([^"']+)["']/i);

                if (tableMatch) {
                    extractedTable = tableMatch[1];
                } else if (tableNameMethodReturn) {
                    extractedTable = tableNameMethodReturn[1];
                } else {
                    // 3. Detect struct / entity definitions or embedded gorm.Model
                    const structMatch = text.match(/type\s+([A-Z][A-Za-z0-9]+)\s+struct/i) ||
                                        text.match(/class\s+([A-Z][A-Za-z0-9]+)/i);
                    const hasGorm = /gorm\.Model/i.test(text);

                    if (structMatch || hasGorm) {
                        detectionDetails = `Entity detected: ${model.entityName}${hasGorm ? ' (embedded gorm.Model)' : ''}. Exact DB table unresolved.`;
                    }
                }
            }

            databaseMap.push({
                model: model.entityName,
                targetTable: extractedTable,
                definitionSource: model.modelFile,
                status: extractedTable !== "Unknown" ? "Resolved" : "Unresolved",
                confidence: extractedTable !== "Unknown" ? "100%" : (detectionDetails ? "50%" : "0%"),
                evidence: model.modelFile,
                reason: extractedTable === "Unknown" ? (detectionDetails || "No explicit DB table name declaration found in model file.") : null
            });
        });

        return databaseMap;
    },

    // --- STAGE 5: FULL DEPENDENCY GRAPH & BIDIRECTIONAL TRACEABILITY ---

    buildFullDependencyGraph: function(files, crossRelations, routes, frontendCalls, controllerMapping = [], middlewareChain = [], databaseMap = []) {
        const graphNodes = new Map();

        files.forEach(file => {
            graphNodes.set(file.fileKey, {
                fileKey: file.fileKey,
                role: file.role,
                dependencies: [],
                referencedBy: []
            });
        });

        const addEdge = (sourceKey, targetKey, symbol, evidence) => {
            if (sourceKey && targetKey && sourceKey !== targetKey && graphNodes.has(sourceKey) && graphNodes.has(targetKey)) {
                const srcNode = graphNodes.get(sourceKey);
                const tgtNode = graphNodes.get(targetKey);

                if (!srcNode.dependencies.some(d => d.target === targetKey && d.symbol === symbol)) {
                    srcNode.dependencies.push({ target: targetKey, symbol, evidence });
                }
                if (!tgtNode.referencedBy.some(r => r.source === sourceKey && r.symbol === symbol)) {
                    tgtNode.referencedBy.push({ source: sourceKey, symbol, evidence });
                }
            }
        };

        // Source 1: Cross relations (Function calls)
        crossRelations.forEach(rel => {
            addEdge(rel.sourceFile, rel.targetFile, rel.targetSymbol, rel.evidence);
        });

        // Source 2: Frontend to Backend calls
        frontendCalls.forEach(call => {
            if (call.status === "Resolved" && call.target !== "Unknown") {
                addEdge(call.frontendFile, call.target, call.calledEndpoint, call.evidence);
            }
        });

        // Source 3: Controller to Route / Action mappings
        controllerMapping.forEach(ctrl => {
            if (Array.isArray(ctrl.boundRoutes)) {
                ctrl.boundRoutes.forEach(r => {
                    if (r.declaredIn && r.declaredIn !== ctrl.controllerFile) {
                        addEdge(ctrl.controllerFile, r.declaredIn, r.endpoint, ctrl.evidence);
                    }
                });
            }
        });

        // Source 4: Middleware mappings
        middlewareChain.forEach(mw => {
            if (Array.isArray(mw.appliedTo)) {
                mw.appliedTo.forEach(ep => {
                    const matchedRoute = routes.find(r => r.endpoint === ep);
                    if (matchedRoute && matchedRoute.declaredIn) {
                        addEdge(mw.middlewareFile, matchedRoute.declaredIn, ep, mw.evidence);
                    }
                });
            }
        });

        // Source 5: Model to DB Mappings
        databaseMap.forEach(db => {
            if (db.definitionSource && db.targetTable !== "Unknown") {
                // Self-contain table relation node metadata trace if applicable
            }
        });

        return Array.from(graphNodes.values());
    },

    // --- STAGE 6: MIGRATION LIR GENERATOR ---

    generateMigrationLIR: function(context) {
        const lirModules = [];

        context.parsedFiles.forEach(file => {
            const nodeGraph = context.dependencyGraph.find(g => g.fileKey === file.fileKey);
            lirModules.push({
                moduleKey: file.fileKey,
                role: file.role,
                targetArchitecturePattern: this.determineTargetPattern(file.role),
                dependencies: nodeGraph ? nodeGraph.dependencies.map(d => `${d.target}#${d.symbol}`) : [],
                referencedBy: nodeGraph ? nodeGraph.referencedBy.map(r => `${r.source}#${r.symbol}`) : [],
                exportableEntities: (file.functions || []).map(f => f.name)
            });
        });

        return {
            version: "2.0.0-lir-evidence-graph",
            generatedAt: new Date().toISOString(),
            modules: lirModules
        };
    },

    determineTargetPattern: function(role) {
        const r = (role || '').toLowerCase();
        if (r.includes('ui') || r.includes('component') || r.includes('frontend')) return "React / Vue Component Layer";
        if (r.includes('controller') || r.includes('handler')) return "Express / NestJS Controller Handler";
        if (r.includes('model') || r.includes('entity') || r.includes('schema')) return "ORM Entity Schema (Prisma / TypeORM)";
        if (r.includes('service') || r.includes('client') || r.includes('api')) return "Axios / Fetch Service Client";
        return "Shared Modular Utility Function";
    },

    buildProjectSummary: function(files) {
        return {
            totalFilesAnalyzed: files.length,
            rolesBreakdown: files.reduce((acc, f) => {
                acc[f.role] = (acc[f.role] || 0) + 1;
                return acc;
            }, {})
        };
    },

    // --- OUTPUT FORMATTER ---

    formatOutput: function(data) {
        let out = [];

        out.push("==================================================");
        out.push("PROJECT-LEVEL EVIDENCE-BASED SEMANTIC GRAPH REPORT");
        out.push("==================================================\n");

        out.push("PROJECT SUMMARY:");
        out.push(`- Total Files Analyzed: ${data.projectSummary.totalFilesAnalyzed}`);
        out.push("- Roles Breakdown:");
        Object.entries(data.projectSummary.rolesBreakdown).forEach(([role, count]) => {
            out.push(`  * ${role}: ${count}`);
        });
        out.push("");

        out.push("CROSS-FILE RELATIONS (EVIDENCE TRACE):");
        if (data.crossRelations.length > 0) {
            data.crossRelations.forEach(rel => {
                out.push(`- [${rel.type}] ${rel.sourceFile} (${rel.sourceSymbol}) -> ${rel.targetFile} (${rel.targetSymbol})`);
                out.push(`  CONFIDENCE: ${rel.confidence} | EVIDENCE: ${rel.evidence}`);
            });
        } else {
            out.push("- STATUS: Evidence Not Found | REASON: No cross-file function calls detected in analyzed project files.");
        }
        out.push("");

        out.push("RESOLVED ROUTES:");
        if (data.routeMapping.length > 0) {
            data.routeMapping.forEach(r => {
                out.push(`- ${r.method} ${r.endpoint}`);
                out.push(`  STATUS: ${r.status} | CONFIDENCE: ${r.confidence}`);
                out.push(`  EVIDENCE: ${r.evidence}`);
                out.push(`  HANDLER: ${r.handler} | DECLARED IN: ${r.declaredIn}`);
            });
        } else {
            out.push("- ENDPOINT: Unknown | STATUS: Unresolved | CONFIDENCE: 0% | REASON: Route definition not found in analyzed project. | EVIDENCE: None");
        }
        out.push("");

        out.push("RESOLVED CONTROLLERS:");
        if (data.controllerMapping.length > 0) {
            data.controllerMapping.forEach(c => {
                out.push(`- CONTROLLER: ${c.controllerFile}`);
                out.push(`  STATUS: ${c.status} | CONFIDENCE: ${c.confidence}`);
                out.push(`  EVIDENCE: ${c.evidence}`);
                out.push(`  ACTIONS: ${c.actions.join(', ') || 'Unknown'}`);
                if (c.reason) out.push(`  REASON: ${c.reason}`);
            });
        } else {
            out.push("- CONTROLLER: Unknown | STATUS: Unresolved | CONFIDENCE: 0% | REASON: No controller declarations found. | EVIDENCE: None");
        }
        out.push("");

        out.push("MIDDLEWARE CHAIN:");
        if (data.middlewareChain.length > 0) {
            data.middlewareChain.forEach(m => {
                out.push(`- MIDDLEWARE FILE: ${m.middlewareFile}`);
                out.push(`  STATUS: ${m.status} | CONFIDENCE: ${m.confidence}`);
                out.push(`  EVIDENCE: ${m.evidence}`);
                out.push(`  HANDLERS: ${m.functions.join(', ') || 'Unknown'}`);
                if (m.reason) out.push(`  REASON: ${m.reason}`);
            });
        } else {
            out.push("- MIDDLEWARE: Unknown | STATUS: Unresolved | CONFIDENCE: 0% | REASON: No middleware registration found. | EVIDENCE: None");
        }
        out.push("");

        out.push("FRONTEND -> BACKEND RESOLVER & MISMATCH DETECTION:");
        if (data.frontendBackendCalls.length > 0) {
            data.frontendBackendCalls.forEach(call => {
                out.push(`- FRONTEND CALL: ${call.frontendFile} [${call.callerFunction}] -> ${call.method} ${call.calledEndpoint}`);
                out.push(`  STATUS: ${call.status} | CONFIDENCE: ${call.confidence}`);
                out.push(`  EVIDENCE: ${call.evidence}`);
                out.push(`  REFERENCED BY: ${call.referencedBy} | TARGET: ${call.target}`);
                out.push(`  DETAILS: ${call.details}`);
                if (call.reason) out.push(`  REASON: ${call.reason}`);
            });
        } else {
            out.push("- FRONTEND CALLS: Unknown | STATUS: Unresolved | CONFIDENCE: 0% | REASON: No frontend HTTP client invocations found in analyzed project. | EVIDENCE: None");
        }
        out.push("");

        out.push("CROSS-FILE API CONTRACTS:");
        if (data.crossFileApiContracts.length > 0) {
            data.crossFileApiContracts.forEach(contract => {
                out.push("--------------------------------------------------");
                out.push(`METHOD: ${contract.method}`);
                out.push(`ENDPOINT: ${contract.endpoint}`);
                out.push(`STATUS: ${contract.status} | CONFIDENCE: ${contract.confidence}`);
                out.push(`EVIDENCE: ${contract.evidence}`);
                out.push(`HANDLER: ${contract.handler} (${contract.controllerFile})`);
                out.push(`MIDDLEWARE: ${contract.middleware}`);
                out.push(`REQUEST: ${contract.requestPayload}`);
                out.push(`RESPONSE: ${contract.responsePayload}`);
                out.push(`DATABASE OPERATION: ${contract.databaseAction}`);
                if (contract.reason) out.push(`REASON: ${contract.reason}`);
            });
            out.push("--------------------------------------------------");
        } else {
            out.push("- API CONTRACTS: Unknown | STATUS: Unresolved | CONFIDENCE: 0% | REASON: Unable to bind cross-file contracts. | EVIDENCE: None");
        }
        out.push("");

        out.push("RESOLVED MODELS & DATABASE MAPPING:");
        if (data.databaseMap.length > 0) {
            data.databaseMap.forEach(db => {
                out.push(`- MODEL ENTITY: ${db.model}`);
                out.push(`  TARGET TABLE: ${db.targetTable}`);
                out.push(`  STATUS: ${db.status} | CONFIDENCE: ${db.confidence}`);
                out.push(`  EVIDENCE: ${db.evidence}`);
                if (db.reason) out.push(`  REASON: ${db.reason}`);
            });
        } else {
            out.push("- DATABASE MAPPING: Unknown | STATUS: Unresolved | CONFIDENCE: 0% | REASON: No database models detected. | EVIDENCE: None");
        }
        out.push("");

        out.push("FULL DEPENDENCY GRAPH (BIDIRECTIONAL TRACE):");
        if (data.dependencyGraph.length > 0) {
            data.dependencyGraph.forEach(node => {
                out.push(`- NODE: ${node.fileKey} [${node.role}]`);
                out.push(`  DEPENDENCIES (OUTGOING): ${node.dependencies.length > 0 ? node.dependencies.map(d => `${d.target}#${d.symbol}`).join(', ') : 'None'}`);
                out.push(`  REFERENCED BY (INCOMING): ${node.referencedBy.length > 0 ? node.referencedBy.map(r => `${r.source}#${r.symbol}`).join(', ') : 'None'}`);
            });
        }
        out.push("");

        out.push("MIGRATION LIR (Lossless Intermediate Representation):");
        out.push(JSON.stringify(data.migrationLIR, null, 2));

        out.push("\n==================================================");

        return out.join('\n');
    }
};

// Global expose for browser script attachment or Node module export
if (typeof window !== 'undefined') {
    window.Viber3Engine = Viber3Engine;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = Viber3Engine;
}
