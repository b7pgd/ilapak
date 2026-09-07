/**
 * engine5.js - FUNDAMENTAL COMMAND EXTENSION LAYER
 *
 * Provides essential developer shell commands on top of engine4 runtime infrastructure.
 * Commands registered: Get-Item, Get-Location, Get-Command, Resolve-Path,
 * ForEach-Object, Write-Output, and Write-Host.
 */
(function () {
    'use strict';

    // Defensive check: PSWeb runtime & command infrastructure must exist
    if (!window.PSWeb || !window.PSWeb.Commands || !window.PSWeb.Runtime) {
        throw new Error("[Engine5] Critical Initialization Error: window.PSWeb.Runtime or Commands is not defined. Load engine4.js first.");
    }

    if (!window.SearchAPI) {
        throw new Error("[Engine5] Critical Initialization Error: window.SearchAPI is not defined. Load engine2.js first.");
    }

    const PSWeb = window.PSWeb;

    // Helper: Normalize Path string using SearchAPI resolveTarget if available
    function resolvePathTarget(pathArg) {
        const currentLoc = (PSWeb.Runtime.session && PSWeb.Runtime.session.location) || '/';
        const rawPath = typeof pathArg === 'string' && pathArg.trim() !== '' ? pathArg.trim() : currentLoc;

        if (window.SearchAPI && typeof window.SearchAPI.resolveTarget === 'function') {
            return window.SearchAPI.resolveTarget(rawPath);
        }
        return rawPath;
    }

    // Helper: Lookup item in global state
    function findItem(targetPath) {
        if (!window.state) return null;

        const file = Array.isArray(window.state.files)
            ? window.state.files.find(file => file.path === targetPath)
            : null;

        if (file) {
            return file;
        }

        const folder = Array.isArray(window.state.folders)
            ? window.state.folders.find(folder => folder.path === targetPath)
            : null;

        return folder || null;
    }

    // Helper: Check path existence safely via SearchAPI.testPath
    function pathExists(targetPath) {
        if (window.SearchAPI && typeof window.SearchAPI.testPath === 'function') {
            return window.SearchAPI.testPath(targetPath);
        }
        return false;
    }

    // =========================================================================
    // COMMAND IMPLEMENTATIONS
    // =========================================================================

    // 1. Get-Item
    function getItemHandler(input, args, operation) {
        const pathArg =
            args?.flags?.['literalpath'] ??
            args?.flags?.['path'] ??
            args?.positional?.[0] ??
            '.';

        const targetPath = resolvePathTarget(pathArg);
        const item = findItem(targetPath);

        if (!item) {
            const errorMsg = `Get-Item: Cannot find path '${targetPath}' because it does not exist.`;
            return [
                typeof PSWeb.createSearchError === 'function'
                    ? PSWeb.createSearchError('ItemNotFound', errorMsg)
                    : {
                        isError: true,
                        type: 'error',
                        message: errorMsg,
                        __searchError: true
                    }
            ];
        }

        return [item];
    }

    // 2. Get-Location
    function getLocationHandler(input, args, operation) {
        const currentLoc = (PSWeb.Runtime.session && PSWeb.Runtime.session.location) || '/';
        const locObj = {
            Path: currentLoc,
            Provider: 'PSWebFileSystem',
            toString: function () { return currentLoc; }
        };
        return [locObj];
    }

    // 3. Get-Command
    function getCommandHandler(input, args, operation) {
        const nameArg =
            args?.flags?.['name'] ??
            args?.positional?.[0];

        const allCommands = PSWeb.Commands.list();
        const results = [];

        if (nameArg) {
            const searchName = String(nameArg).trim().toLowerCase();
            const resolved = PSWeb.Commands.resolveAlias(searchName) || searchName;

            if (allCommands[resolved]) {
                const cmd = allCommands[resolved];
                results.push({
                    Name: cmd.name,
                    CommandType: cmd.source === 'engine2/engine3' ? 'Cmdlet' : 'Function',
                    Source: cmd.source,
                    Category: cmd.category,
                    Description: cmd.description
                });
            } else {
                // Search partial match if exact match fails
                Object.keys(allCommands).forEach(key => {
                    if (key.includes(searchName)) {
                        const cmd = allCommands[key];
                        results.push({
                            Name: cmd.name,
                            CommandType: cmd.source === 'engine2/engine3' ? 'Cmdlet' : 'Function',
                            Source: cmd.source,
                            Category: cmd.category,
                            Description: cmd.description
                        });
                    }
                });
            }
        } else {
            Object.keys(allCommands).forEach(key => {
                const cmd = allCommands[key];
                results.push({
                    Name: cmd.name,
                    CommandType: cmd.source === 'engine2/engine3' ? 'Cmdlet' : 'Function',
                    Source: cmd.source,
                    Category: cmd.category,
                    Description: cmd.description
                });
            });
        }

        return results;
    }

    // 4. Resolve-Path
    function resolvePathHandler(input, args, operation) {
        const pathArg =
            args?.flags?.['path'] ??
            args?.positional?.[0] ??
            '.';

        const targetPath = resolvePathTarget(pathArg);

        if (!pathExists(targetPath)) {
            const errorMsg = `Resolve-Path: Cannot find path '${targetPath}' because it does not exist.`;
            return [
                typeof PSWeb.createSearchError === 'function'
                    ? PSWeb.createSearchError('PathNotFound', errorMsg)
                    : {
                        isError: true,
                        type: 'error',
                        message: errorMsg,
                        __searchError: true
                    }
            ];
        }

        return [{
            Path: targetPath,
            Provider: 'PSWebFileSystem',
            toString() {
                return targetPath;
            }
        }];
    }

    // 5. ForEach-Object
    function forEachObjectHandler(input, args, operation) {
        const items = PSWeb.Pipeline
            .toArray(input)
            .map(item => PSWeb.Output.unwrap(item));

        if (items.length === 0) {
            return [];
        }

        const positional = args?.positional || [];

        if (positional.length === 0) {
            return items;
        }

        let scriptBlock = positional.join(' ').trim();

        if (scriptBlock.startsWith('{') && scriptBlock.endsWith('}')) {
            scriptBlock = scriptBlock.slice(1, -1).trim();
        }

        const results = [];

        for (const item of items) {
            if (
                window.PowerShellCompat &&
                typeof window.PowerShellCompat.evaluateScriptBlock === 'function'
            ) {
                try {
                    const value =
    window.PowerShellCompat.evaluateScriptBlock(
        item,
        scriptBlock
    );

                    if (value !== undefined) {
                        results.push(value);
                    }

                    continue;
                } catch (err) {
                    // Fallback below
                }
            }

            // Minimal fallback: $_.Property
            const propertyMatch =
                scriptBlock.match(/^\$_\.([A-Za-z_][\w]*)$/);

            if (propertyMatch) {
                const value = PSWeb.Pipeline.getProperty(
                    item,
                    propertyMatch[1]
                );

                results.push(
                    value !== undefined ? value : item
                );
            } else {
                results.push(item);
            }
        }

        return PSWeb.Pipeline.fromArray(results);
    }

    // 6. Write-Output
    function writeOutputHandler(input, args, operation) {
        const positional = args?.positional || [];

        if (positional.length > 0) {
            return positional.map(value =>
                PSWeb.Output.unwrap(value)
            );
        }

        if (input !== undefined && input !== null) {
            return PSWeb.Pipeline.toArray(
                PSWeb.Output.unwrap(input)
            );
        }

        return [];
    }

    // 7. Write-Host
    function writeHostHandler(input, args, operation) {
        const positional = args?.positional || [];

        if (positional.length > 0) {
            return [positional.join(' ')];
        }

        if (input !== undefined && input !== null) {
            return [
                String(
                    PSWeb.Output.unwrap(input)
                )
            ];
        }

        return [];
    }

    // =========================================================================
    // SAFE REGISTRATION TO ENGINE4
    // =========================================================================

    const commandsToRegister = [
        {
            name: 'get-item',
            aliases: ['gi'],
            category: 'filesystem',
            description: 'Gets the item at the specified location.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine5',
            handler: getItemHandler
        },
        {
            name: 'get-location',
            aliases: ['pwd', 'gl'],
            category: 'filesystem',
            description: 'Gets information about the current working location.',
            acceptsPipeline: false,
            producesPipeline: true,
            source: 'engine5',
            handler: getLocationHandler
        },
        {
            name: 'get-command',
            aliases: ['gcm'],
            category: 'utility',
            description: 'Gets basic information about commands and aliases registered in the shell.',
            acceptsPipeline: false,
            producesPipeline: true,
            source: 'engine5',
            handler: getCommandHandler
        },
        {
            name: 'resolve-path',
            aliases: ['rvpa'],
            category: 'filesystem',
            description: 'Resolves an existing path in the PSWeb virtual file system.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine5',
            handler: resolvePathHandler
        },
        {
            name: 'foreach-object',
            aliases: ['foreach', '%'],
            category: 'pipeline',
            description: 'Performs an operation against each item in a collection of input objects.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine5',
            handler: forEachObjectHandler
        },
        {
            name: 'write-output',
            aliases: ['write', 'echo'],
            category: 'output',
            description: 'Sends the specified objects to the next command in the pipeline or to the terminal.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine5',
            handler: writeOutputHandler
        },
        {
            name: 'write-host',
            aliases: [],
            category: 'output',
            description: 'Writes customized output to a host user interface.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine5',
            handler: writeHostHandler
        }
    ];

    commandsToRegister.forEach(cmdDef => {
        const result = PSWeb.Commands.register(cmdDef);
        if (!result.success && !result.isLegacy) {
            console.warn(`[Engine5] Failed to register command '${cmdDef.name}':`, result.error);
        }
    });

    // Register engine metadata into Runtime
    PSWeb.Runtime.registerEngine('engine5', {
        version: '1.0.0',
        role: 'fundamental command extension layer'
    });

})();
