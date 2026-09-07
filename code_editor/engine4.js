/**
 * engine4.js - RUNTIME & EXTENSION INFRASTRUCTURE
 * 
 * Extension infrastructure layer built on top of engine1, engine2, and engine3.
 * Provides safe command registration, command metadata, variable/session storage,
 * pipeline helpers, and output abstractions without altering legacy engines.
 */
(function () {
    'use strict';

    // Defensive check: PSWeb baseline must exist (initialized by engine1)
    if (!window.PSWeb) {
        throw new Error("[Engine4] Critical Initialization Error: window.PSWeb is not defined. Load engine1.js first.");
    }

    // Defensive check: SearchAPI must exist (initialized by engine2)
    if (!window.SearchAPI) {
        throw new Error("[Engine4] Critical Initialization Error: window.SearchAPI is not defined. Load engine2.js first.");
    }

    // Namespace Initialization (Preserve existing PSWeb objects)
    const PSWeb = window.PSWeb;
    PSWeb.Runtime = PSWeb.Runtime || {};
    PSWeb.Commands = PSWeb.Commands || {};
    PSWeb.Pipeline = PSWeb.Pipeline || {};
    PSWeb.Output = PSWeb.Output || {};

    // Internal Registries & State Storage
    const loadedEngines = new Map();
    const commandRegistry = new Map();
    const aliasRegistry = new Map();
    const bridgeRegistry = new Map();
    const variableStorage = new Map();

    // Session State (Isolated from engine1's application state)
    const sessionState = {
        variables: variableStorage,
        location: '/',
        lastCommand: null,
        lastResult: null
    };

    // Helper: Variable Name Normalization ($foo, foo, FOO -> foo)
    function normalizeVariableName(name) {
        if (typeof name !== 'string') return '';
        let cleaned = name.trim();
        if (cleaned.startsWith('$')) {
            cleaned = cleaned.substring(1);
        }
        return cleaned.toLowerCase();
    }

    // Helper: Command Name Normalization
    function normalizeCommandName(name) {
        if (typeof name !== 'string') return '';
        return name.trim().toLowerCase();
    }

    // Helper: Alias List Normalization
    function normalizeAliasList(aliases) {
        if (!Array.isArray(aliases)) return [];
        const normalized = [];
        const seen = new Set();
        aliases.forEach(alias => {
            const value = normalizeCommandName(alias);
            if (!value || seen.has(value)) return;
            seen.add(value);
            normalized.push(value);
        });
        return normalized;
    }

    // Helper: Legacy Command Detection
    function isLegacyHook(commandName) {
        const normalized = normalizeCommandName(commandName);
        return Boolean(
            normalized &&
            window.SearchAPI &&
            window.SearchAPI.hooks &&
            Object.prototype.hasOwnProperty.call(window.SearchAPI.hooks, normalized)
        );
    }

    // =========================================================================
    // 1. ENGINE REGISTRATION SYSTEM
    // =========================================================================
    PSWeb.Runtime.registerEngine = function (engineId, details) {
        if (!engineId || typeof engineId !== 'string') {
            return { success: false, error: "Invalid engine identifier." };
        }
        const id = engineId.trim().toLowerCase();
        if (!id) {
            return { success: false, error: "Invalid engine identifier." };
        }
        const info = Object.assign({
            version: '1.0.0',
            role: 'unknown',
            registeredAt: new Date().toISOString()
        }, details || {});

        loadedEngines.set(id, info);
        return { success: true, engine: id, info: Object.assign({}, info) };
    };

    PSWeb.Runtime.getEngines = function () {
        const engines = {};
        loadedEngines.forEach((value, key) => {
            engines[key] = Object.assign({}, value);
        });
        return engines;
    };

    // Auto-register legacy engines and self upon initialization
    PSWeb.Runtime.registerEngine('engine1', { role: 'core application/editor/filesystem' });
    PSWeb.Runtime.registerEngine('engine2', { role: 'parser/executor/search' });
    if (window.PowerShellCompat) {
        PSWeb.Runtime.registerEngine('engine3', { role: 'powershell compatibility augmentation' });
    }
    PSWeb.Runtime.registerEngine('engine4', { version: '1.0.0', role: 'runtime & extension infrastructure' });

    // =========================================================================
    // 2. RUNTIME & VARIABLE STORAGE API
    // =========================================================================
    PSWeb.Runtime.variables = {
        setVariable: function (name, value) {
            const normalized = normalizeVariableName(name);
            if (!normalized) {
                return { success: false, error: "Invalid variable name." };
            }
            variableStorage.set(normalized, value);
            return { success: true, name: normalized, value: value };
        },
        getVariable: function (name) {
            const normalized = normalizeVariableName(name);
            if (!normalized) return undefined;
            return variableStorage.get(normalized);
        },
        hasVariable: function (name) {
            const normalized = normalizeVariableName(name);
            if (!normalized) return false;
            return variableStorage.has(normalized);
        },
        removeVariable: function (name) {
            const normalized = normalizeVariableName(name);
            if (!normalized) return false;
            return variableStorage.delete(normalized);
        },
        clearVariables: function () {
            variableStorage.clear();
            return { success: true };
        },
        listVariables: function () {
            const vars = {};
            variableStorage.forEach((value, key) => {
                vars[key] = value;
            });
            return vars;
        }
    };

    PSWeb.Runtime.session = sessionState;

    PSWeb.Runtime.inspect = function () {
        return {
            version: '1.0.0',
            loadedEngines: PSWeb.Runtime.getEngines(),
            registeredCommandsCount: commandRegistry.size,
            aliasesCount: aliasRegistry.size,
            bridgedCommandsCount: bridgeRegistry.size,
            variablesCount: variableStorage.size,
            sessionLocation: sessionState.location
        };
    };

    // =========================================================================
    // 3. COMMAND REGISTRY & ALIAS SYSTEM
    // =========================================================================
    PSWeb.Commands.register = function (commandDef) {
        if (!commandDef || typeof commandDef !== 'object') {
            return { success: false, error: "Command definition must be an object." };
        }

        const normalizedName = normalizeCommandName(commandDef.name);

        if (!normalizedName) {
            return { success: false, error: "Command definition missing valid 'name'." };
        }

        // Ownership Protection: Check engine4 registry collision
        if (commandRegistry.has(normalizedName)) {
            return {
                success: false,
                error: `Command '${normalizedName}' is already registered in PSWeb.Commands.`
            };
        }

        // Ownership Protection: Check engine2 / engine3 SearchAPI.hooks collision
        if (isLegacyHook(normalizedName)) {
            return {
                success: false,
                error: `Command '${normalizedName}' is owned by a legacy/external engine (SearchAPI.hooks). Registration rejected to prevent breaking core logic.`,
                isLegacy: true
            };
        }

        if (typeof commandDef.handler !== 'function') {
            return { success: false, error: `Command '${normalizedName}' requires a valid handler function.` };
        }

        const aliases = normalizeAliasList(commandDef.aliases);

        // Validate aliases atomically BEFORE modifying registries
        for (const alias of aliases) {
            if (alias === normalizedName) {
                return { success: false, error: `Alias '${alias}' cannot point to the command itself.` };
            }
            if (commandRegistry.has(alias)) {
                return { success: false, error: `Alias '${alias}' conflicts with an existing PSWeb command.` };
            }
            if (isLegacyHook(alias)) {
                return { success: false, error: `Alias '${alias}' conflicts with a legacy SearchAPI command.` };
            }
            if (aliasRegistry.has(alias)) {
                return { success: false, error: `Alias '${alias}' is already registered.` };
            }
        }

        const metadata = {
            name: normalizedName,
            aliases: aliases.slice(),
            category: commandDef.category || 'general',
            description: commandDef.description || '',
            acceptsPipeline: Boolean(commandDef.acceptsPipeline),
            producesPipeline: Boolean(commandDef.producesPipeline),
            source: commandDef.source || 'engine5+',
            handler: commandDef.handler
        };

        // Save command definition
        commandRegistry.set(normalizedName, metadata);

        // Safe Bridge to SearchAPI.registerSearchCommand if available
        if (window.SearchAPI && typeof window.SearchAPI.registerSearchCommand === 'function') {
            window.SearchAPI.registerSearchCommand(normalizedName, metadata.handler);
            bridgeRegistry.set(normalizedName, { type: 'command', handler: metadata.handler });
        }

        // Register associated aliases
        for (const alias of aliases) {
            aliasRegistry.set(alias, normalizedName);
            if (window.SearchAPI && typeof window.SearchAPI.registerSearchCommand === 'function') {
                window.SearchAPI.registerSearchCommand(alias, metadata.handler);
                bridgeRegistry.set(alias, { type: 'alias', target: normalizedName, handler: metadata.handler });
            }
        }

        return {
            success: true,
            command: normalizedName,
            metadata: Object.assign({}, metadata, { aliases: aliases.slice() })
        };
    };

    PSWeb.Commands.has = function (name) {
        const normalized = normalizeCommandName(name);
        if (!normalized) return false;
        const resolved = PSWeb.Commands.resolveAlias(normalized) || normalized;
        return commandRegistry.has(resolved) || isLegacyHook(resolved);
    };

    PSWeb.Commands.get = function (name) {
        const normalized = normalizeCommandName(name);
        if (!normalized) return null;
        const resolved = PSWeb.Commands.resolveAlias(normalized) || normalized;

        if (commandRegistry.has(resolved)) {
            return commandRegistry.get(resolved);
        }

        // Fallback info for legacy commands (engine2 / engine3)
        if (isLegacyHook(resolved)) {
            return {
                name: resolved,
                aliases: [],
                category: 'legacy',
                description: 'Legacy search/powershell command registered via SearchAPI.',
                acceptsPipeline: true,
                producesPipeline: true,
                source: 'engine2/engine3',
                handler: window.SearchAPI.hooks[resolved]
            };
        }

        return null;
    };

    PSWeb.Commands.unregister = function (name) {
        const normalized = normalizeCommandName(name);
        if (!normalized) {
            return { success: false, error: "Invalid command name." };
        }

        if (isLegacyHook(normalized) && !commandRegistry.has(normalized)) {
            return { success: false, error: `Cannot unregister legacy command '${normalized}' owned by engine2/engine3.` };
        }

        if (!commandRegistry.has(normalized)) {
            return { success: false, error: `Command '${normalized}' not found.` };
        }

        const meta = commandRegistry.get(normalized);

        // Remove aliases belonging to this command
        meta.aliases.forEach(alias => {
            aliasRegistry.delete(alias);
            if (bridgeRegistry.has(alias) && window.SearchAPI && window.SearchAPI.hooks) {
                delete window.SearchAPI.hooks[alias];
            }
            bridgeRegistry.delete(alias);
        });

        // Remove primary SearchAPI hook if created by engine4
        if (bridgeRegistry.has(normalized) && window.SearchAPI && window.SearchAPI.hooks) {
            delete window.SearchAPI.hooks[normalized];
        }

        bridgeRegistry.delete(normalized);
        commandRegistry.delete(normalized);

        return { success: true, name: normalized };
    };

    PSWeb.Commands.registerAlias = function (alias, commandName) {
        const normAlias = normalizeCommandName(alias);
        const normCommand = normalizeCommandName(commandName);

        if (!normAlias || !normCommand) {
            return { success: false, error: "Invalid alias or command name." };
        }

        if (normAlias === normCommand) {
            return { success: false, error: "Alias cannot point to itself." };
        }

        if (aliasRegistry.has(normAlias)) {
            return { success: false, error: `Alias '${normAlias}' is already registered.` };
        }

        if (commandRegistry.has(normAlias)) {
            return { success: false, error: `Alias '${normAlias}' conflicts with an existing PSWeb command.` };
        }

        if (isLegacyHook(normAlias)) {
            return { success: false, error: `Cannot register alias '${normAlias}'; it conflicts with a legacy SearchAPI command.` };
        }

        const targetCmd = PSWeb.Commands.get(normCommand);
        if (!targetCmd || typeof targetCmd.handler !== 'function') {
            return { success: false, error: `Cannot register alias '${normAlias}'; target command '${normCommand}' does not exist.` };
        }

        aliasRegistry.set(normAlias, normCommand);

        if (window.SearchAPI && typeof window.SearchAPI.registerSearchCommand === 'function') {
            window.SearchAPI.registerSearchCommand(normAlias, targetCmd.handler);
            bridgeRegistry.set(normAlias, { type: 'alias', target: normCommand, handler: targetCmd.handler });
        }

        return { success: true, alias: normAlias, target: normCommand };
    };

    PSWeb.Commands.resolveAlias = function (alias) {
        const normAlias = normalizeCommandName(alias);
        if (!normAlias) return null;
        return aliasRegistry.get(normAlias) || null;
    };

    PSWeb.Commands.getAliases = function (commandName) {
        const normalized = normalizeCommandName(commandName);
        if (!normalized) return [];

        const resolvedTarget = PSWeb.Commands.resolveAlias(normalized) || normalized;
        const aliases = [];

        aliasRegistry.forEach((target, alias) => {
            if (target === resolvedTarget) {
                aliases.push(alias);
            }
        });

        return aliases;
    };

    PSWeb.Commands.resolve = function (name) {
        const normalized = normalizeCommandName(name);
        if (!normalized) return null;
        const targetName = PSWeb.Commands.resolveAlias(normalized) || normalized;
        return PSWeb.Commands.get(targetName);
    };

    PSWeb.Commands.list = function () {
        const list = {};

        // Include legacy commands from SearchAPI
        if (window.SearchAPI && window.SearchAPI.hooks) {
            Object.keys(window.SearchAPI.hooks).forEach(hookName => {
                list[hookName] = {
                    name: hookName,
                    aliases: [],
                    category: 'legacy',
                    description: 'Legacy command registered via SearchAPI.',
                    source: 'engine2/engine3',
                    acceptsPipeline: true,
                    producesPipeline: true
                };
            });
        }

        // Merge modern commands from engine4+
        commandRegistry.forEach((meta, name) => {
            list[name] = {
                name: meta.name,
                aliases: Array.from(meta.aliases),
                category: meta.category,
                description: meta.description,
                source: meta.source,
                acceptsPipeline: meta.acceptsPipeline,
                producesPipeline: meta.producesPipeline
            };
        });

        return list;
    };

    PSWeb.Commands.debug = function () {
        return {
            registeredCommands: Array.from(commandRegistry.keys()),
            aliases: Object.fromEntries(aliasRegistry),
            bridgedCommands: Object.fromEntries(bridgeRegistry),
            legacyHooks: window.SearchAPI && window.SearchAPI.hooks ? Object.keys(window.SearchAPI.hooks) : []
        };
    };

    // =========================================================================
    // 4. PIPELINE HELPERS
    // =========================================================================
    PSWeb.Pipeline.isPipelineValue = function (value) {
        return value !== null && value !== undefined;
    };

    PSWeb.Pipeline.toArray = function (value) {
        if (value === null || value === undefined) {
            return [];
        }
        if (Array.isArray(value)) {
            return value;
        }
        return [value];
    };

    PSWeb.Pipeline.fromArray = function (array) {
        if (!Array.isArray(array)) {
            return array;
        }
        return array;
    };

    PSWeb.Pipeline.isError = function (value) {
        if (!value || typeof value !== 'object') return false;
        if (value instanceof Error) return true;
        if (value.isError === true || value.type === 'error' || value.__searchError === true) return true;
        return false;
    };

    // Safe property getter delegating to PowerShellCompat if present
    PSWeb.Pipeline.getProperty = function (obj, propertyName) {
        if (obj === null || obj === undefined || !propertyName) {
            return undefined;
        }

        if (window.PowerShellCompat && typeof window.PowerShellCompat.getPropertyValue === 'function') {
            return window.PowerShellCompat.getPropertyValue(obj, propertyName);
        }

        // Fallback implementation if PowerShellCompat is missing
        if (typeof obj !== 'object') return undefined;

        if (Object.prototype.hasOwnProperty.call(obj, propertyName)) {
            return obj[propertyName];
        }

        const lowerProp = String(propertyName).toLowerCase();
        const foundKey = Object.keys(obj).find(key => key.toLowerCase() === lowerProp);
        if (foundKey) {
            return obj[foundKey];
        }

        return undefined;
    };

    // =========================================================================
    // 5. OUTPUT ABSTRACTION
    // =========================================================================
    const OUTPUT_SYMBOL = '__pswebOutput';

    PSWeb.Output.create = function (value, streamType) {
        return {
            [OUTPUT_SYMBOL]: true,
            stream: streamType || 'output',
            value: value,
            timestamp: Date.now()
        };
    };

    PSWeb.Output.isOutput = function (value) {
        return Boolean(value && typeof value === 'object' && value[OUTPUT_SYMBOL] === true);
    };

    PSWeb.Output.unwrap = function (value) {
        if (PSWeb.Output.isOutput(value)) {
            return value.value;
        }
        return value;
    };

    // Ready signal
    PSWeb.Runtime.ready = true;

})();
