/**
 * viber4.js — Project-Level Semantic Knowledge Graph Database & Reasoning Engine
 *
 * Consolidates output from viber3.js into a multi-layered, evidence-based
 * Graph Database. Provides graph traversal execution, change impact analysis,
 * state tracing, alias resolution, value-flow analysis, and architecture reasoning 
 * without re-reading source code.
 */

const Viber4Engine = {
    /**
     * Deterministic hashing helper for stable node/edge identity.
     * Uses FNV-1a (32-bit) converted to hex.
     */
    _hash: function(str) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    },

    /**
     * Normalizes confidence score based on evidence type/quality.
     */
    _rankEvidenceQuality: function(evidence, fallbackConfidence) {
        if (!evidence || evidence === "None" || evidence === "Unknown") {
            return { rank: "Unknown", score: "0%", level: 0 };
        }
        if (evidence.includes(" (") || evidence.includes("Line ") || evidence.includes(" -> ")) {
            return { rank: "Direct Declaration / Call", score: "100%", level: 100 };
        }
        if (evidence.includes("Transitive") || evidence.includes("Reachability")) {
            return { rank: "Indirect Reference", score: "75%", level: 75 };
        }
        return { rank: "Dependency Link", score: fallbackConfidence || "100%", level: 90 };
    },

    /**
     * Helper to construct a fully populated, evidence-first node object.
     */
    _createNode: function(options) {
        const file = options.file || "Unknown";
        const kind = options.kind || options.type || "Unknown";
        const label = options.label || options.id;
        const line = options.line || "Unknown";
        const rawId = `${kind}::${file}::${label}::${line}`;
        const stableHash = options.stableHash || this._hash(rawId);

        return {
            NodeID: options.id || `node_${stableHash}`,
            Kind: kind,
            type: kind, // Compatibility mapping
            label: label,
            id: options.id || `node_${stableHash}`, // Compatibility mapping
            Language: options.language || "Unknown",
            File: file,
            fileKey: file, // Compatibility mapping
            StartLine: options.startLine || line,
            EndLine: options.endLine || line,
            StableHash: stableHash,
            Evidence: options.evidence || "None",
            evidence: options.evidence || "None", // Compatibility mapping
            Confidence: options.confidence || "100%",
            confidence: options.confidence || "100%", // Compatibility mapping
            Status: options.status || (options.confidence === "0%" ? "Unresolved" : "Resolved"),
            status: options.status || (options.confidence === "0%" ? "Unresolved" : "Resolved"), // Compatibility mapping
            Reason: options.reason || null,
            reason: options.reason || null, // Compatibility mapping
            role: options.role || "Unknown",
            symbolKind: options.symbolKind || null,
            targetTable: options.targetTable || null,
            endpoint: options.endpoint || null,
            method: options.method || null,
            aliases: options.aliases || [],
            valueFlow: options.valueFlow || null,
            layer: options.layer || "Unknown"
        };
    },

    /**
     * Helper to construct an evidence-first edge object.
     */
    _createEdge: function(options) {
        const rawKey = `${options.source}->${options.relation || options.type}->${options.target}`;
        const rankInfo = this._rankEvidenceQuality(options.evidence, options.confidence);

        return {
            id: options.id || `edge_${this._hash(rawKey)}`,
            source: options.source,
            target: options.target,
            destination: options.target, // Compatibility
            relation: options.relation || options.type || "USES",
            type: options.type || options.relation || "USES", // Compatibility
            payload: options.payload || null,
            symbol: options.symbol || null,
            Evidence: options.evidence || "None",
            evidence: options.evidence || "None", // Compatibility
            Confidence: rankInfo.score,
            confidence: rankInfo.score, // Compatibility
            EvidenceRank: rankInfo.rank,
            Status: options.status || (rankInfo.score === "0%" ? "Unresolved" : "Resolved"),
            status: options.status || (rankInfo.score === "0%" ? "Unresolved" : "Resolved"), // Compatibility
            Reason: options.reason || null,
            reason: options.reason || null, // Compatibility
            details: options.details || null
        };
    },

    /**
     * Primary entry point to build the Knowledge Graph and initialize the Query/Reasoning Engine.
     * 
     * @param {Object} viber3Output - Raw object output from Viber3Engine.analyzeProject()
     * @returns {Object} Graph, Indexes, Query Engine, Reasoning Engine, and Formatted Report
     */
    buildKnowledgeGraph: function(viber3Output) {
        const raw = viber3Output.raw || viber3Output;

        // STAGE 1: SUB-GRAPH GENERATION
        const graphs = {
            dataFlowGraph: this.buildDataFlowGraph(raw),
            symbolUsageGraph: this.buildSymbolUsageGraph(raw),
            typeGraph: this.buildTypeGraph(raw),
            configurationGraph: this.buildConfigurationGraph(raw),
            stateMutationGraph: this.buildStateMutationGraph(raw),
            impactGraph: this.buildImpactGraph(raw),
            reverseDependencyGraph: this.buildReverseDependencyGraph(raw),
            aliasGraph: this.buildAliasGraph(raw),
            valueFlowGraph: this.buildValueFlowGraph(raw),
            knowledgeGraph: null // Built after sub-graphs are assembled
        };

        // Assemble Multi-Layer Knowledge Graph Database
        graphs.knowledgeGraph = this.buildUnifiedKnowledgeGraph(raw, graphs);

        // STAGE 2: GRAPH INDEXING (DATABASE LAYER)
        const indexes = this.buildGraphIndexes(graphs.knowledgeGraph);

        // STAGE 3: REASONING ENGINE INITIALIZATION
        const reasoningEngine = this.createReasoningEngine(graphs.knowledgeGraph, indexes, raw);

        // STAGE 4: QUERY ENGINE INITIALIZATION (TRAVERSAL-BASED)
        const queryEngine = this.createQueryEngine(graphs.knowledgeGraph, indexes, reasoningEngine);

        // STAGE 5: REPORT GENERATION
        const formattedReport = this.formatReport(graphs, indexes, reasoningEngine);

        return {
            KnowledgeGraph: graphs.knowledgeGraph,
            SubGraphs: graphs,
            GraphIndexes: indexes,
            QueryEngine: queryEngine,
            ReasoningEngine: reasoningEngine,
            FormattedReport: formattedReport
        };
    },

    // --- SUB-GRAPH GENERATORS (EVIDENCE-FIRST) ---

    buildDataFlowGraph: function(raw) {
        const nodes = [];
        const edges = [];

        (raw.frontendBackendCalls || []).forEach(call => {
            edges.push(this._createEdge({
                id: `df_fe_be_${call.frontendFile}_${call.calledEndpoint}`,
                type: "DATA_FLOW",
                relation: "CONSUMES",
                source: call.frontendFile,
                target: call.calledEndpoint,
                payload: call.method,
                confidence: call.confidence || "100%",
                evidence: call.evidence || call.frontendFile,
                status: call.status || "Resolved",
                reason: call.reason || null
            }));
        });

        (raw.crossFileApiContracts || []).forEach(contract => {
            if (contract.handler && contract.handler !== "Unknown") {
                edges.push(this._createEdge({
                    id: `df_route_handler_${contract.endpoint}_${contract.handler}`,
                    type: "DATA_FLOW",
                    relation: "SERVES",
                    source: contract.endpoint,
                    target: contract.handler,
                    payload: contract.requestPayload,
                    confidence: contract.confidence || "100%",
                    evidence: contract.evidence,
                    status: contract.status,
                    reason: contract.reason || null
                }));
            }

            if (contract.databaseAction && contract.databaseAction !== "Unknown") {
                edges.push(this._createEdge({
                    id: `df_handler_db_${contract.handler}_${contract.databaseAction}`,
                    type: "DATA_MUTATION_FLOW",
                    relation: "WRITES",
                    source: contract.handler,
                    target: contract.databaseAction,
                    payload: contract.responsePayload,
                    confidence: contract.confidence || "100%",
                    evidence: contract.evidence,
                    status: contract.status,
                    reason: contract.reason || null
                }));
            }
        });

        return { nodes, edges };
    },

    buildSymbolUsageGraph: function(raw) {
        const symbolMap = new Map();

        (raw.dependencyGraph || []).forEach(node => {
            (node.dependencies || []).forEach(dep => {
                if (dep.symbol && dep.symbol !== "Unknown") {
                    if (!symbolMap.has(dep.symbol)) symbolMap.set(dep.symbol, []);
                    symbolMap.get(dep.symbol).push({
                        location: node.fileKey,
                        target: dep.target,
                        role: "CALLER",
                        evidence: dep.evidence
                    });
                }
            });

            (node.referencedBy || []).forEach(ref => {
                if (ref.symbol && ref.symbol !== "Unknown") {
                    if (!symbolMap.has(ref.symbol)) symbolMap.set(ref.symbol, []);
                    symbolMap.get(ref.symbol).push({
                        location: node.fileKey,
                        source: ref.source,
                        role: "TARGET",
                        evidence: ref.evidence
                    });
                }
            });
        });

        return { symbols: symbolMap };
    },

    buildTypeGraph: function(raw) {
        const typeEdges = [];

        (raw.databaseMap || []).forEach(db => {
            typeEdges.push({
                sourceType: db.model,
                targetEntity: db.targetTable,
                relationship: "MAPS_TO_TABLE",
                confidence: db.confidence,
                evidence: db.evidence,
                status: db.status,
                reason: db.reason
            });
        });

        return { typeEdges };
    },

    buildConfigurationGraph: function(raw) {
        const configEdges = [];

        (raw.middlewareChain || []).forEach(mw => {
            configEdges.push({
                configSource: mw.middlewareFile,
                appliedScope: mw.appliedTo,
                relationship: "CONFIGURES_MIDDLEWARE",
                confidence: mw.confidence,
                evidence: mw.evidence,
                status: mw.status,
                reason: mw.reason
            });
        });

        return { configEdges };
    },

    buildStateMutationGraph: function(raw) {
        const mutations = [];

        (raw.crossFileApiContracts || []).forEach(contract => {
            if (contract.method && ["POST", "PUT", "PATCH", "DELETE"].includes(contract.method.toUpperCase())) {
                mutations.push({
                    action: contract.handler,
                    targetEndpoint: contract.endpoint,
                    mutationType: contract.method,
                    dbAction: contract.databaseAction,
                    confidence: contract.confidence,
                    evidence: contract.evidence,
                    status: contract.status,
                    reason: contract.reason
                });
            }
        });

        return { mutations };
    },

    buildImpactGraph: function(raw) {
        const impactMap = new Map();

        (raw.dependencyGraph || []).forEach(node => {
            const affectedNodes = (node.referencedBy || []).map(r => r.source);
            impactMap.set(node.fileKey, {
                file: node.fileKey,
                role: node.role,
                directDependents: affectedNodes,
                totalImpactRadius: affectedNodes.length,
                evidence: node.fileKey
            });
        });

        return { impactMap };
    },

    buildReverseDependencyGraph: function(raw) {
        const reverseGraph = new Map();

        (raw.dependencyGraph || []).forEach(node => {
            reverseGraph.set(node.fileKey, {
                dependents: node.referencedBy || [],
                evidence: node.fileKey
            });
        });

        return { reverseGraph };
    },

    buildAliasGraph: function(raw) {
        const aliases = [];
        // Extract alias links strictly if alias assignment evidence exists
        (raw.parsedFiles || []).forEach(file => {
            (file.functions || []).forEach(fn => {
                if (fn.read && fn.read !== "Unknown" && fn.process && fn.process !== "Unknown") {
                    if (fn.process.includes("=") || fn.process.includes("as ")) {
                        aliases.push({
                            sourceSymbol: fn.read,
                            aliasSymbol: fn.name,
                            file: file.fileKey,
                            location: fn.location,
                            confidence: "100%",
                            evidence: `${file.fileKey} (${fn.location})`
                        });
                    }
                }
            });
        });
        return { aliases };
    },

    buildValueFlowGraph: function(raw) {
        const valueFlows = [];
        (raw.parsedFiles || []).forEach(file => {
            (file.functions || []).forEach(fn => {
                if (fn.input && fn.input !== "Unknown" && fn.output && fn.output !== "Unknown") {
                    valueFlows.push({
                        functionName: fn.name,
                        input: fn.input,
                        process: fn.process,
                        output: fn.output,
                        file: file.fileKey,
                        evidence: `${file.fileKey} (${fn.location})`,
                        confidence: "100%"
                    });
                }
            });
        });
        return { valueFlows };
    },

    // --- MULTI-LAYER UNIFIED KNOWLEDGE GRAPH DATABASE ---

    buildUnifiedKnowledgeGraph: function(raw, subGraphs) {
        const nodes = new Map();
        const edges = [];

        // 1. Multi-Layer Module & Multi-Layer Granular Nodes
        (raw.parsedFiles || []).forEach(file => {
            // File / Module Layer Node
            const fileNode = this._createNode({
                id: file.fileKey,
                file: file.fileKey,
                kind: "File",
                role: file.role,
                evidence: file.fileKey,
                confidence: "100%",
                layer: "Module"
            });
            nodes.set(file.fileKey, fileNode);

            // Detailed Functions / Symbols Layer
            (file.functions || []).forEach(fn => {
                const fnNodeId = `FN::${file.fileKey}::${fn.name}`;
                const fnNode = this._createNode({
                    id: fnNodeId,
                    label: fn.name,
                    file: file.fileKey,
                    kind: "Function",
                    line: fn.location,
                    evidence: fn.evidence ? `${fn.evidence.source} (${fn.evidence.location})` : file.fileKey,
                    confidence: "100%",
                    layer: "Service"
                });
                nodes.set(fnNodeId, fnNode);

                // Edge: File SERVES/CONTAINS Function
                edges.push(this._createEdge({
                    source: file.fileKey,
                    target: fnNodeId,
                    relation: "CONTAINS",
                    evidence: fnNode.evidence,
                    confidence: "100%"
                }));

                // Symbol Nodes & Value Flow Edges (SSA-Style representation)
                if (fn.input && fn.input !== "Unknown" && fn.input !== "None") {
                    const inputSymId = `SYM::${file.fileKey}::${fn.input}`;
                    if (!nodes.has(inputSymId)) {
                        nodes.set(inputSymId, this._createNode({
                            id: inputSymId,
                            label: fn.input,
                            file: file.fileKey,
                            kind: "Symbol",
                            symbolKind: "Parameter",
                            evidence: fnNode.evidence,
                            confidence: "100%",
                            layer: "Value"
                        }));
                    }
                    edges.push(this._createEdge({
                        source: inputSymId,
                        target: fnNodeId,
                        relation: "MUTATES",
                        evidence: fnNode.evidence,
                        confidence: "100%"
                    }));
                }
            });
        });

        // 2. Add Route / Endpoint Nodes (Router / Controller Layer)
        (raw.routeMapping || []).forEach(route => {
            const routeId = `ENDPOINT::${route.method}::${route.endpoint}`;
            const routeNode = this._createNode({
                id: routeId,
                label: `${route.method} ${route.endpoint}`,
                kind: "Endpoint",
                endpoint: route.endpoint,
                method: route.method,
                file: route.declaredIn,
                evidence: route.evidence,
                confidence: route.confidence,
                status: route.status,
                reason: route.reason,
                layer: "Router"
            });
            nodes.set(routeId, routeNode);

            if (route.declaredIn && nodes.has(route.declaredIn)) {
                edges.push(this._createEdge({
                    source: route.declaredIn,
                    target: routeId,
                    relation: "SERVES",
                    evidence: route.evidence,
                    confidence: route.confidence,
                    status: route.status,
                    reason: route.reason
                }));
            }
        });

        // 3. Add Controller & Middleware Layers
        (raw.controllerMapping || []).forEach(ctrl => {
            const ctrlId = `CTRL::${ctrl.controllerFile}`;
            if (!nodes.has(ctrlId)) {
                nodes.set(ctrlId, this._createNode({
                    id: ctrlId,
                    label: ctrl.controllerFile,
                    kind: "Controller",
                    file: ctrl.controllerFile,
                    evidence: ctrl.evidence,
                    confidence: ctrl.confidence,
                    status: ctrl.status,
                    reason: ctrl.reason,
                    layer: "Controller"
                }));
            }
        });

        (raw.middlewareChain || []).forEach(mw => {
            const mwId = `MW::${mw.middlewareFile}`;
            if (!nodes.has(mwId)) {
                nodes.set(mwId, this._createNode({
                    id: mwId,
                    label: mw.middlewareFile,
                    kind: "Middleware",
                    file: mw.middlewareFile,
                    evidence: mw.evidence,
                    confidence: mw.confidence,
                    status: mw.status,
                    reason: mw.reason,
                    layer: "Middleware"
                }));
            }
        });

        // 4. Add Model, ORM & Database Layers
        (raw.databaseMap || []).forEach(db => {
            const modelId = `MODEL::${db.model}`;
            nodes.set(modelId, this._createNode({
                id: modelId,
                label: db.model,
                kind: "Model",
                targetTable: db.targetTable,
                file: db.definitionSource || "Unknown",
                evidence: db.evidence,
                confidence: db.confidence,
                status: db.status,
                reason: db.reason,
                layer: "Model"
            }));

            if (db.targetTable && db.targetTable !== "Unknown") {
                const tableId = `DB_TABLE::${db.targetTable}`;
                nodes.set(tableId, this._createNode({
                    id: tableId,
                    label: db.targetTable,
                    kind: "Database Table",
                    evidence: db.evidence,
                    confidence: db.confidence,
                    layer: "Database"
                }));

                edges.push(this._createEdge({
                    source: modelId,
                    target: tableId,
                    relation: "WRITES",
                    evidence: db.evidence,
                    confidence: db.confidence,
                    status: db.status,
                    reason: db.reason
                }));
            }
        });

        // 5. Cross-File Invocations & Calls
        (raw.crossRelations || []).forEach((rel, idx) => {
            edges.push(this._createEdge({
                id: `edge_rel_${idx}`,
                source: rel.sourceFile,
                target: rel.targetFile,
                relation: "CALLS",
                symbol: rel.targetSymbol,
                evidence: rel.evidence,
                confidence: rel.confidence
            }));
        });

        // 6. Frontend -> Backend Consumes Edges
        (raw.frontendBackendCalls || []).forEach((call, idx) => {
            const endpointNodeId = `ENDPOINT::${call.method}::${call.calledEndpoint}`;
            edges.push(this._createEdge({
                id: `edge_fe_be_${idx}`,
                source: call.frontendFile,
                target: nodes.has(endpointNodeId) ? endpointNodeId : call.calledEndpoint,
                relation: "CONSUMES",
                evidence: call.evidence,
                confidence: call.confidence,
                status: call.status,
                reason: call.reason,
                details: call.details
            }));
        });

        // 7. Alias Edges
        (subGraphs.aliasGraph.aliases || []).forEach((alias, idx) => {
            const srcId = `SYM::${alias.file}::${alias.sourceSymbol}`;
            const aliasId = `SYM::${alias.file}::${alias.aliasSymbol}`;
            edges.push(this._createEdge({
                id: `edge_alias_${idx}`,
                source: srcId,
                target: aliasId,
                relation: "REFERENCES",
                evidence: alias.evidence,
                confidence: alias.confidence
            }));
        });

        return { nodes, edges };
    },

    // --- STAGE 2: GRAPH DATABASE INDEXES ---

    buildGraphIndexes: function(knowledgeGraph) {
        const indexes = {
            byNodeID: new Map(),
            byKind: new Map(),
            byType: new Map(), // Compatibility
            bySymbol: new Map(),
            byEndpoint: new Map(),
            byFile: new Map(),
            byRole: new Map(),
            byLanguage: new Map(),
            byHash: new Map(),
            byModel: new Map(),
            byTable: new Map(),
            outgoingEdges: new Map(),
            incomingEdges: new Map()
        };

        knowledgeGraph.nodes.forEach(node => {
            indexes.byNodeID.set(node.NodeID, node);
            indexes.byHash.set(node.StableHash, node);

            if (!indexes.byKind.has(node.Kind)) indexes.byKind.set(node.Kind, []);
            indexes.byKind.get(node.Kind).push(node);

            // Compatibility mapping
            if (!indexes.byType.has(node.type)) indexes.byType.set(node.type, []);
            indexes.byType.get(node.type).push(node);

            if (node.File && node.File !== "Unknown") {
                if (!indexes.byFile.has(node.File)) indexes.byFile.set(node.File, []);
                indexes.byFile.get(node.File).push(node);
            }

            if (node.role && node.role !== "Unknown") {
                if (!indexes.byRole.has(node.role)) indexes.byRole.set(node.role, []);
                indexes.byRole.get(node.role).push(node);
            }

            if (node.Kind === "Endpoint") {
                indexes.byEndpoint.set(node.endpoint, node);
            }

            if (node.Kind === "Model") {
                indexes.byModel.set(node.label, node);
            }

            if (node.Kind === "Database Table") {
                indexes.byTable.set(node.label, node);
            }
        });

        knowledgeGraph.edges.forEach(edge => {
            if (!indexes.outgoingEdges.has(edge.source)) indexes.outgoingEdges.set(edge.source, []);
            indexes.outgoingEdges.get(edge.source).push(edge);

            if (!indexes.incomingEdges.has(edge.target)) indexes.incomingEdges.set(edge.target, []);
            indexes.incomingEdges.get(edge.target).push(edge);

            if (edge.symbol) {
                if (!indexes.bySymbol.has(edge.symbol)) indexes.bySymbol.set(edge.symbol, []);
                indexes.bySymbol.get(edge.symbol).push(edge);
            }
        });

        return indexes;
    },

    // --- INCREMENTAL GRAPH UPDATE SUPPORT ---

    mergeGraphSnapshot: function(baseGraph, updatedGraph) {
        const mergedNodes = new Map(baseGraph.nodes);
        const mergedEdges = [...baseGraph.edges];

        // Perform Hash Comparison & Node Replacement
        updatedGraph.nodes.forEach((newNode, key) => {
            const existingNode = mergedNodes.get(key);
            if (!existingNode || existingNode.StableHash !== newNode.StableHash) {
                mergedNodes.set(key, newNode);
            }
        });

        // Edge Replacement by ID
        updatedGraph.edges.forEach(newEdge => {
            const idx = mergedEdges.findIndex(e => e.id === newEdge.id);
            if (idx >= 0) {
                mergedEdges[idx] = newEdge;
            } else {
                mergedEdges.push(newEdge);
            }
        });

        const newKnowledgeGraph = { nodes: mergedNodes, edges: mergedEdges };
        const newIndexes = this.buildGraphIndexes(newKnowledgeGraph);

        return {
            KnowledgeGraph: newKnowledgeGraph,
            GraphIndexes: newIndexes
        };
    },

    // --- STAGE 3: GRAPH-BASED REASONING PIPELINE ENGINE ---

    createReasoningEngine: function(knowledgeGraph, indexes, raw) {
        const self = this;

        return {
            /**
             * Generic Reasoning Pipeline: Goal -> Planner -> Traversal -> Evidence -> Result
             */
            runPipeline: function(goal, constraint, target) {
                const candidates = self.traverseGraph(knowledgeGraph, indexes, {
                    startNodeId: target,
                    direction: constraint.direction || "BOTH",
                    maxDepth: constraint.maxDepth || 10
                });

                const rankedEvidence = candidates.path.map(step => ({
                    step: step.node.label || step.node.NodeID,
                    evidence: step.node.Evidence || step.node.evidence,
                    rank: self._rankEvidenceQuality(step.node.Evidence || step.node.evidence, step.node.Confidence)
                }));

                return {
                    goal: goal,
                    target: target,
                    candidatesFound: candidates.visitedNodes.length,
                    executionPath: candidates.path.map(p => p.node.NodeID),
                    rankedEvidence: rankedEvidence,
                    conclusion: candidates.visitedNodes.length > 0 ? "Resolved" : "Unresolved",
                    confidence: candidates.visitedNodes.length > 0 ? "100%" : "0%",
                    explanation: candidates.visitedNodes.length > 0 ? 
                        `Pipeline traversed ${candidates.visitedNodes.length} nodes successfully with traceable evidence.` :
                        `No evidence found in graph traversal for target '${target}'.`
                };
            },

            explainUnresolvedRoute: function(endpointStr) {
                const targetCall = (raw.frontendBackendCalls || []).find(c => c.calledEndpoint.includes(endpointStr));
                if (targetCall) {
                    return {
                        query: `WHY unresolved route ${endpointStr}`,
                        status: targetCall.status,
                        confidence: targetCall.confidence,
                        evidence: targetCall.evidence,
                        reason: targetCall.reason || targetCall.details,
                        affectedNodes: [targetCall.frontendFile],
                        affectedFiles: [targetCall.frontendFile],
                        affectedFrontend: [targetCall.frontendFile],
                        affectedBackend: [],
                        affectedDatabase: []
                    };
                }

                const targetRoute = (raw.routeMapping || []).find(r => r.endpoint.includes(endpointStr));
                if (targetRoute) {
                    return {
                        query: `WHY unresolved route ${endpointStr}`,
                        status: targetRoute.status,
                        confidence: targetRoute.confidence,
                        evidence: targetRoute.evidence,
                        reason: targetRoute.reason || "Route status derived directly from evidence.",
                        affectedNodes: [targetRoute.declaredIn],
                        affectedFiles: [targetRoute.declaredIn],
                        affectedEndpoints: [targetRoute.endpoint]
                    };
                }

                return {
                    query: `WHY unresolved route ${endpointStr}`,
                    status: "Unresolved",
                    confidence: "0%",
                    evidence: "None",
                    reason: `No evidence of endpoint '${endpointStr}' exists in the analyzed project output.`,
                    affectedNodes: [],
                    affectedFiles: []
                };
            },

            calculateImpact: function(targetNodeId) {
                const traversalResult = self.traverseGraph(knowledgeGraph, indexes, {
                    startNodeId: targetNodeId,
                    direction: "INCOMING",
                    maxDepth: 50
                });

                const affectedFiles = new Set();
                const affectedEndpoints = new Set();
                const affectedModels = new Set();
                const affectedFrontend = new Set();
                const affectedBackend = new Set();
                const affectedDatabase = new Set();

                traversalResult.visitedNodes.forEach(nodeId => {
                    const node = knowledgeGraph.nodes.get(nodeId);
                    if (node) {
                        if (node.File && node.File !== "Unknown") affectedFiles.add(node.File);
                        if (node.Kind === "Endpoint") affectedEndpoints.add(node.label);
                        if (node.Kind === "Model") affectedModels.add(node.label);
                        if (node.role === "UI Component") affectedFrontend.add(node.NodeID);
                        if (node.role === "Backend Controller") affectedBackend.add(node.NodeID);
                        if (node.Kind === "Database Table") affectedDatabase.add(node.label);
                    }
                });

                return {
                    target: targetNodeId,
                    totalImpactedNodes: traversalResult.visitedNodes.length - 1,
                    affectedFiles: Array.from(affectedFiles),
                    affectedEndpoints: Array.from(affectedEndpoints),
                    affectedModels: Array.from(affectedModels),
                    affectedFrontend: Array.from(affectedFrontend),
                    affectedBackend: Array.from(affectedBackend),
                    affectedDatabase: Array.from(affectedDatabase),
                    confidence: "100%",
                    evidence: `Graph traversal reachability from node '${targetNodeId}'`,
                    traversalHistory: traversalResult.path
                };
            }
        };
    },

    // --- STAGE 4: GRAPH TRAVERSAL ENGINE ---

    traverseGraph: function(knowledgeGraph, indexes, options) {
        const startNodeId = options.startNodeId;
        const direction = options.direction || "OUTGOING"; // "OUTGOING", "INCOMING", "BOTH"
        const maxDepth = options.maxDepth || 20;
        const evidenceOnly = options.evidenceOnly || false;

        const visited = new Set();
        const queue = [{ nodeId: startNodeId, depth: 0, path: [] }];
        const fullPath = [];

        // Match start node directly or via fuzzy ID lookup
        let resolvedStartId = startNodeId;
        if (!knowledgeGraph.nodes.has(startNodeId)) {
            for (let [id, node] of knowledgeGraph.nodes.entries()) {
                if (id.includes(startNodeId) || (node.label && node.label.includes(startNodeId))) {
                    resolvedStartId = id;
                    break;
                }
            }
        }

        while (queue.length > 0) {
            const { nodeId, depth, path } = queue.shift();
            if (visited.has(nodeId) || depth > maxDepth) continue;

            visited.add(nodeId);
            const currentNode = knowledgeGraph.nodes.get(nodeId);

            if (currentNode) {
                const currentStep = { depth, node: currentNode, edge: path[path.length - 1] || null };
                fullPath.push(currentStep);

                let nextEdges = [];
                if (direction === "OUTGOING" || direction === "BOTH") {
                    const out = indexes.outgoingEdges.get(nodeId) || [];
                    nextEdges.push(...out);
                }
                if (direction === "INCOMING" || direction === "BOTH") {
                    const inc = indexes.incomingEdges.get(nodeId) || [];
                    nextEdges.push(...inc);
                }

                nextEdges.forEach(edge => {
                    if (evidenceOnly && (!edge.Evidence || edge.Evidence === "None")) return;
                    const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
                    if (!visited.has(nextNodeId)) {
                        queue.push({ nodeId: nextNodeId, depth: depth + 1, path: [...path, edge] });
                    }
                });
            }
        }

        return {
            startNode: resolvedStartId,
            visitedNodes: Array.from(visited),
            path: fullPath,
            maxDepthReached: fullPath.reduce((max, p) => Math.max(max, p.depth), 0)
        };
    },

    // --- STAGE 5: TRAVERSAL-BASED ADVANCED QUERY ENGINE ---

    createQueryEngine: function(knowledgeGraph, indexes, reasoningEngine) {
        const self = this;

        return {
            query: function(queryString) {
                const parts = queryString.trim().split(/\s+/);
                const command = parts[0].toUpperCase();
                const subCommand = parts[1] ? parts[1].toUpperCase() : null;
                
                let targetIndex = 1;
                if (subCommand && ["ENDPOINT", "SYMBOL", "MODEL", "CONFIG", "DATAFLOW", "STATE", "VALUE", "TYPE", "ALIAS"].includes(subCommand)) {
                    targetIndex = 2;
                }
                const target = parts.slice(targetIndex).join(" ");

                if (command === "TRACE") {
                    if (subCommand === "ENDPOINT") return this.traceEndpoint(target);
                    if (subCommand === "SYMBOL") return this.traceSymbol(target);
                    if (subCommand === "MODEL") return this.traceModel(target);
                    if (subCommand === "CONFIG") return this.traceConfig(target);
                    if (subCommand === "DATAFLOW") return this.traceDataFlow(target);
                    if (subCommand === "STATE") return this.traceState(target);
                    if (subCommand === "VALUE") return this.traceValue(target);
                    if (subCommand === "TYPE") return this.traceType(target);
                    if (subCommand === "ALIAS") return this.traceAlias(target);
                }

                if (command === "WHY") {
                    return reasoningEngine.explainUnresolvedRoute(target);
                }

                if (command === "IMPACT") {
                    return reasoningEngine.calculateImpact(target);
                }

                if (command === "DEPENDENTS") {
                    return this.getDependents(target);
                }

                if (command === "DEPENDENCIES") {
                    return this.getDependencies(target);
                }

                if (command === "PATH" || command === "REACHABLE") {
                    return this.tracePath(parts[1], parts[2]);
                }

                if (command === "SHOW") {
                    if (subCommand === "DATAFLOW") return this.showDataFlow(target);
                    if (subCommand === "STATE") return this.showState(target);
                }

                return {
                    query: queryString,
                    status: "Unresolved",
                    confidence: "0%",
                    evidence: "None",
                    reason: `Unsupported query syntax '${queryString}'.`
                };
            },

            traceEndpoint: function(endpoint) {
                const traversal = self.traverseGraph(knowledgeGraph, indexes, {
                    startNodeId: `ENDPOINT::`,
                    direction: "BOTH"
                });

                const matches = traversal.path.filter(p => p.node.Kind === "Endpoint" && p.node.endpoint && p.node.endpoint.includes(endpoint));

                if (matches.length === 0) {
                    return {
                        query: `TRACE ENDPOINT ${endpoint}`,
                        status: "Unresolved",
                        confidence: "0%",
                        evidence: "None",
                        reason: `Endpoint '${endpoint}' not found in Knowledge Graph evidence.`
                    };
                }

                return {
                    query: `TRACE ENDPOINT ${endpoint}`,
                    status: "Resolved",
                    confidence: "100%",
                    results: matches.map(m => m.node),
                    traversalPath: matches,
                    evidence: matches.map(m => m.node.Evidence || m.node.evidence).join(", ")
                };
            },

            traceSymbol: function(symbol) {
                const hits = indexes.bySymbol.get(symbol) || [];
                const symbolNodes = [];
                knowledgeGraph.nodes.forEach(node => {
                    if (node.label === symbol || node.NodeID.includes(symbol)) symbolNodes.push(node);
                });

                if (hits.length === 0 && symbolNodes.length === 0) {
                    return {
                        query: `TRACE SYMBOL ${symbol}`,
                        status: "Unresolved",
                        confidence: "0%",
                        evidence: "None",
                        reason: `Symbol '${symbol}' not found in graph nodes, edges, or symbols.`
                    };
                }

                return {
                    query: `TRACE SYMBOL ${symbol}`,
                    status: "Resolved",
                    confidence: "100%",
                    symbolNodes: symbolNodes,
                    occurrences: hits,
                    evidence: [...symbolNodes.map(n => n.Evidence), ...hits.map(h => h.evidence)].join(", ")
                };
            },

            traceModel: function(modelName) {
                const modelNode = indexes.byModel.get(modelName) || knowledgeGraph.nodes.get(`MODEL::${modelName}`);
                if (!modelNode) {
                    return {
                        query: `TRACE MODEL ${modelName}`,
                        status: "Unresolved",
                        confidence: "0%",
                        evidence: "None",
                        reason: `Model '${modelName}' not found in Knowledge Graph.`
                    };
                }

                const traversal = self.traverseGraph(knowledgeGraph, indexes, {
                    startNodeId: modelNode.NodeID,
                    direction: "BOTH"
                });

                return {
                    query: `TRACE MODEL ${modelName}`,
                    status: modelNode.status || "Resolved",
                    confidence: modelNode.confidence || "100%",
                    model: modelNode,
                    reachableNodes: traversal.visitedNodes,
                    evidence: modelNode.Evidence || modelNode.evidence,
                    reason: modelNode.Reason || modelNode.reason
                };
            },

            traceConfig: function(configKey) {
                const matches = [];
                knowledgeGraph.nodes.forEach(node => {
                    if (node.NodeID.includes(configKey) || (node.label && node.label.includes(configKey))) {
                        matches.push(node);
                    }
                });

                return {
                    query: `TRACE CONFIG ${configKey}`,
                    status: matches.length > 0 ? "Resolved" : "Unresolved",
                    confidence: matches.length > 0 ? "100%" : "0%",
                    results: matches,
                    evidence: matches.length > 0 ? matches.map(m => m.Evidence || m.evidence).join(", ") : "None",
                    reason: matches.length === 0 ? `Configuration symbol '${configKey}' not found.` : null
                };
            },

            traceDataFlow: function(target) {
                return this.showDataFlow(target);
            },

            traceState: function(target) {
                return this.showState(target);
            },

            traceValue: function(target) {
                const valueNodes = [];
                knowledgeGraph.nodes.forEach(node => {
                    if (node.Kind === "Symbol" && node.label.includes(target)) {
                        valueNodes.push(node);
                    }
                });
                return {
                    query: `TRACE VALUE ${target}`,
                    status: valueNodes.length > 0 ? "Resolved" : "Unresolved",
                    confidence: valueNodes.length > 0 ? "100%" : "0%",
                    valueNodes: valueNodes,
                    reason: valueNodes.length === 0 ? `No SSA value flow node matching '${target}'` : null
                };
            },

            traceType: function(target) {
                return this.traceModel(target);
            },

            traceAlias: function(target) {
                const aliasEdges = knowledgeGraph.edges.filter(e => e.relation === "REFERENCES" && (e.source.includes(target) || e.target.includes(target)));
                return {
                    query: `TRACE ALIAS ${target}`,
                    status: aliasEdges.length > 0 ? "Resolved" : "Unresolved",
                    confidence: aliasEdges.length > 0 ? "100%" : "0%",
                    aliasEdges: aliasEdges,
                    reason: aliasEdges.length === 0 ? `Alias evidence not found for symbol '${target}'.` : null
                };
            },

            tracePath: function(sourceId, targetId) {
                const traversal = self.traverseGraph(knowledgeGraph, indexes, {
                    startNodeId: sourceId,
                    direction: "OUTGOING"
                });

                const isReachable = traversal.visitedNodes.includes(targetId);
                return {
                    query: `PATH ${sourceId} -> ${targetId}`,
                    status: isReachable ? "Resolved" : "Unresolved",
                    confidence: isReachable ? "100%" : "0%",
                    reachable: isReachable,
                    path: isReachable ? traversal.path : [],
                    reason: !isReachable ? `No deterministic path exists between '${sourceId}' and '${targetId}'.` : null
                };
            },

            getDependents: function(nodeId) {
                const incoming = indexes.incomingEdges.get(nodeId) || [];
                return {
                    query: `DEPENDENTS ${nodeId}`,
                    status: incoming.length > 0 ? "Resolved" : "Unresolved",
                    confidence: incoming.length > 0 ? "100%" : "0%",
                    dependents: incoming.map(e => ({ source: e.source, relation: e.relation, evidence: e.Evidence || e.evidence })),
                    reason: incoming.length === 0 ? `No incoming dependencies found for node '${nodeId}'.` : null
                };
            },

            getDependencies: function(nodeId) {
                const outgoing = indexes.outgoingEdges.get(nodeId) || [];
                return {
                    query: `DEPENDENCIES ${nodeId}`,
                    status: outgoing.length > 0 ? "Resolved" : "Unresolved",
                    confidence: outgoing.length > 0 ? "100%" : "0%",
                    dependencies: outgoing.map(e => ({ target: e.target, relation: e.relation, evidence: e.Evidence || e.evidence })),
                    reason: outgoing.length === 0 ? `No outgoing dependencies found for node '${nodeId}'.` : null
                };
            },

            showDataFlow: function(symbolOrHandler) {
                const matches = knowledgeGraph.edges.filter(e => e.relation === "CONSUMES" || e.relation === "SERVES" || e.relation === "CALLS");
                const filtered = matches.filter(e => e.source.includes(symbolOrHandler) || e.target.includes(symbolOrHandler) || (e.symbol && e.symbol.includes(symbolOrHandler)));
                return {
                    query: `SHOW DATAFLOW ${symbolOrHandler}`,
                    status: filtered.length > 0 ? "Resolved" : "Unresolved",
                    confidence: filtered.length > 0 ? "100%" : "0%",
                    dataFlowEdges: filtered,
                    reason: filtered.length === 0 ? `No dataflow edges matching '${symbolOrHandler}'.` : null
                };
            },

            showState: function(handler) {
                const mutatorEdges = knowledgeGraph.edges.filter(e => e.relation === "WRITES" || e.relation === "MUTATES");
                const filtered = mutatorEdges.filter(e => e.source.includes(handler) || e.target.includes(handler));
                return {
                    query: `SHOW STATE ${handler}`,
                    status: filtered.length > 0 ? "Resolved" : "Unresolved",
                    confidence: filtered.length > 0 ? "100%" : "0%",
                    stateEdges: filtered,
                    reason: filtered.length === 0 ? `No state mutation operations recorded for '${handler}'.` : null
                };
            }
        };
    },

    // --- STAGE 6: REPORT GENERATOR ---

    formatReport: function(graphs, indexes, reasoningEngine) {
        let out = [];

        out.push("================================================================================");
        out.push("VIBER4 — EVIDENCE-BASED SEMANTIC KNOWLEDGE GRAPH DATABASE REPORT");
        out.push("================================================================================\n");

        out.push("1. GRAPH DATABASE INDEX SUMMARY:");
        out.push(`- Total Database Nodes: ${graphs.knowledgeGraph.nodes.size}`);
        out.push(`- Total Database Edges: ${graphs.knowledgeGraph.edges.length}`);
        out.push(`- Indexed Kinds: ${Array.from(indexes.byKind.keys()).join(", ")}`);
        out.push(`- Indexed Files: ${indexes.byFile.size}`);
        out.push(`- Indexed Endpoints: ${indexes.byEndpoint.size}`);
        out.push(`- Indexed Models: ${indexes.byModel.size}`);
        out.push("");

        out.push("2. MULTI-LAYER DATA FLOW & STATE MUTATION TRAVERSAL:");
        if (graphs.dataFlowGraph.edges.length > 0) {
            graphs.dataFlowGraph.edges.forEach(edge => {
                out.push(`- [${edge.relation || edge.type}] ${edge.source} -> ${edge.target}`);
                out.push(`  CONFIDENCE: ${edge.Confidence} | RANK: ${edge.EvidenceRank || 'Direct'} | STATUS: ${edge.Status} | EVIDENCE: ${edge.Evidence}`);
                if (edge.Reason) out.push(`  REASON: ${edge.Reason}`);
            });
        } else {
            out.push("- STATUS: Unresolved | CONFIDENCE: 0% | REASON: No explicit data flow edges recorded in evidence graph.");
        }
        out.push("");

        out.push("3. DATABASE & TYPE GRAPH RESOLUTION:");
        if (graphs.typeGraph.typeEdges.length > 0) {
            graphs.typeGraph.typeEdges.forEach(te => {
                out.push(`- MODEL: ${te.sourceType} -> TABLE: ${te.targetEntity}`);
                out.push(`  STATUS: ${te.status} | CONFIDENCE: ${te.confidence} | EVIDENCE: ${te.evidence}`);
                if (te.reason) out.push(`  REASON: ${te.reason}`);
            });
        } else {
            out.push("- STATUS: Unresolved | CONFIDENCE: 0% | REASON: No model-to-table mappings resolved.");
        }
        out.push("");

        out.push("================================================================================");

        return out.join("\n");
    }
};

// Global expose for browser or Node environment
if (typeof window !== 'undefined') {
    window.Viber4Engine = Viber4Engine;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = Viber4Engine;
}
