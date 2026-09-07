/**
 * engine6.js - DATA PROCESSING, INSPECTION, & FILE MUTATION LAYER
 *
 * Extension layer providing data aggregation, inspection,
 * and file mutation commands on top of engine1-5 runtime infrastructure.
 *
 * Commands registered:
 * - Data/Pipeline: Sort-Object, Group-Object, Measure-Object
 * - Utility/Inspection: Get-Member, Compare-Object
 * - File Mutation: Set-Content, Add-Content, Clear-Content
 * - Filesystem: Test-Path
 */
(function () {
    'use strict';

    // Defensive check: Essential runtime components from engine4 must exist
    if (!window.PSWeb || !window.PSWeb.Commands || !window.PSWeb.Runtime || !window.PSWeb.Pipeline || !window.PSWeb.Output) {
        throw new Error("[Engine6] Critical Initialization Error: window.PSWeb infrastructure is missing. Load engine4.js first.");
    }

    if (!window.SearchAPI) {
        throw new Error("[Engine6] Critical Initialization Error: window.SearchAPI is not defined. Load engine2.js first.");
    }

    const PSWeb = window.PSWeb;

    // =========================================================================
    // PRIVATE INTERNAL HELPERS
    // =========================================================================

    function unwrapPipelineItem(item) {
        if (PSWeb.Output && typeof PSWeb.Output.unwrap === 'function') {
            return PSWeb.Output.unwrap(item);
        }
        return item;
    }

    function resolvePathTarget(pathArg) {
        const currentLoc = (PSWeb.Runtime.session && PSWeb.Runtime.session.location) || '/';
        const rawPath = typeof pathArg === 'string' && pathArg.trim() !== '' ? pathArg.trim() : currentLoc;

        if (window.SearchAPI && typeof window.SearchAPI.resolveTarget === 'function') {
            return window.SearchAPI.resolveTarget(rawPath);
        }
        return rawPath;
    }

    function pathExists(targetPath) {
        if (window.SearchAPI && typeof window.SearchAPI.testPath === 'function') {
            return window.SearchAPI.testPath(targetPath);
        }
        return false;
    }

    function makeSearchError(errorType, message) {
        if (typeof PSWeb.createSearchError === 'function') {
            return PSWeb.createSearchError(errorType, message);
        }
        return { isError: true, type: 'error', message: message, __searchError: true };
    }

    function findFile(targetPath) {
        const state = PSWeb.state || window.state;
        if (!state || !Array.isArray(state.files)) return null;
        return state.files.find(file => file.path === targetPath) || null;
    }

    function extractContentValue(input, valueArg) {
        let content = '';

        if (valueArg !== undefined && valueArg !== null) {
            if (Array.isArray(valueArg)) {
                content = valueArg.map(unwrapPipelineItem).join('\n');
            } else {
                content = String(unwrapPipelineItem(valueArg));
            }
        } else if (input !== undefined && input !== null) {
            const inputArr = PSWeb.Pipeline.toArray(input).map(unwrapPipelineItem);
            content = inputArr.join('\n');
        }

        return content;
    }

    // =========================================================================
    // COMMAND IMPLEMENTATIONS
    // =========================================================================

    // 1. Sort-Object
    function sortObjectHandler(input, args) {
        const items = PSWeb.Pipeline.toArray(input).map(unwrapPipelineItem);
        if (items.length === 0) return [];

        const propArg =
            args?.flags?.['property'] ??
            args?.positional?.[0];

        const descending =
            args?.flags?.['descending'] === true ||
            args?.flags?.['descending'] === 'true';

        const sorted = items.slice().sort((a, b) => {
            let valA = propArg ? PSWeb.Pipeline.getProperty(a, propArg) : a;
            let valB = propArg ? PSWeb.Pipeline.getProperty(b, propArg) : b;

            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';

            if (typeof valA === 'number' && typeof valB === 'number') {
                return descending ? valB - valA : valA - valB;
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();

            if (strA < strB) return descending ? 1 : -1;
            if (strA > strB) return descending ? -1 : 1;
            return 0;
        });

        return PSWeb.Pipeline.fromArray(sorted);
    }

    // 2. Group-Object
    function groupObjectHandler(input, args) {
        const items = PSWeb.Pipeline.toArray(input).map(unwrapPipelineItem);
        if (items.length === 0) return [];

        const propArg =
            args?.flags?.['property'] ??
            args?.positional?.[0];

        const groupsMap = new Map();

        items.forEach(item => {
            const rawKey = propArg ? PSWeb.Pipeline.getProperty(item, propArg) : item;
            const keyStr = rawKey !== undefined && rawKey !== null ? String(rawKey) : '';

            if (!groupsMap.has(keyStr)) {
                groupsMap.set(keyStr, {
                    Values: rawKey !== undefined ? [rawKey] : [],
                    Count: 0,
                    Group: [],
                    Name: keyStr
                });
            }

            const groupObj = groupsMap.get(keyStr);
            groupObj.Count += 1;
            groupObj.Group.push(item);
        });

        return Array.from(groupsMap.values());
    }

    // 3. Measure-Object
    function measureObjectHandler(input, args) {
        const items = PSWeb.Pipeline.toArray(input).map(unwrapPipelineItem);
        const count = items.length;

        const measureProperty =
            args?.flags?.['property'] ??
            args?.positional?.[0];

        const calculateSum =
            args?.flags?.['sum'] === true;

        const calculateAverage =
            args?.flags?.['average'] === true;

        const calculateMin =
            args?.flags?.['minimum'] === true;

        const calculateMax =
            args?.flags?.['maximum'] === true;

        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        let numericCount = 0;

        if (calculateSum || calculateAverage || calculateMin || calculateMax) {
            items.forEach(item => {
                const rawVal = measureProperty ? PSWeb.Pipeline.getProperty(item, measureProperty) : item;
                const numVal =
                    typeof rawVal === 'number'
                        ? rawVal
                        : Number(rawVal);

                if (Number.isFinite(numVal)) {
                    numericCount++;
                    sum += numVal;
                    if (numVal < min) min = numVal;
                    if (numVal > max) max = numVal;
                }
            });
        }

        const result = { Count: count };

        if (calculateSum) result.Sum = numericCount > 0 ? sum : null;
        if (calculateAverage) result.Average = numericCount > 0 ? sum / numericCount : null;
        if (calculateMin) result.Minimum = numericCount > 0 ? min : null;
        if (calculateMax) result.Maximum = numericCount > 0 ? max : null;
        if (measureProperty) result.Property = String(measureProperty);

        return [result];
    }

    // 4. Get-Member
    function getMemberHandler(input, args) {
        const items = PSWeb.Pipeline.toArray(input).map(unwrapPipelineItem);
        if (items.length === 0) return [];

        const target = items[0];
        const members = [];

        if (target !== null && target !== undefined) {
            const targetType = typeof target === 'object'
                ? (Array.isArray(target) ? 'System.Array' : (target.constructor ? target.constructor.name : 'System.Object'))
                : typeof target;

            if (typeof target === 'object') {
                Object.keys(target).forEach(key => {
                    const val = target[key];
                    members.push({
                        TypeName: targetType,
                        Name: key,
                        MemberType: typeof val === 'function' ? 'Method' : 'NoteProperty',
                        Value: typeof val === 'function' ? `[Method]` : val
                    });
                });
            } else {
                members.push({
                    TypeName: targetType,
                    Name: 'Value',
                    MemberType: 'Primitive',
                    Value: target
                });
            }
        }

        return members;
    }

    // 5. Compare-Object (MVP Version)
    function compareObjectHandler(input, args) {
        const reference = PSWeb.Pipeline.toArray(
            args?.flags?.['referenceobject'] ?? input
        ).map(unwrapPipelineItem);

        const difference = PSWeb.Pipeline.toArray(
            args?.flags?.['differenceobject']
        ).map(unwrapPipelineItem);

        const propArg =
            args?.flags?.['property'];

        const results = [];
        const getKey = (obj) => propArg ? String(PSWeb.Pipeline.getProperty(obj, propArg) || '') : String(obj);

        const refKeys = new Set(reference.map(getKey));
        const diffKeys = new Set(difference.map(getKey));

        reference.forEach(item => {
            const key = getKey(item);
            if (!diffKeys.has(key)) {
                results.push({
                    InputObject: item,
                    SideIndicator: '<='
                });
            }
        });

        difference.forEach(item => {
            const key = getKey(item);
            if (!refKeys.has(key)) {
                results.push({
                    InputObject: item,
                    SideIndicator: '=>'
                });
            }
        });

        return results;
    }

    // 6. Set-Content
    async function setContentHandler(input, args) {
        const pathArg =
            args?.flags?.['path'] ??
            args?.positional?.[0];

        if (!pathArg) {
            return [makeSearchError('InvalidArgument', 'Set-Content: Path parameter is missing.')];
        }

        const targetPath = resolvePathTarget(pathArg);
        const fileItem = findFile(targetPath);

        if (!fileItem || !fileItem.handle) {
            return [makeSearchError('ItemNotFound', `Set-Content: Cannot find file '${targetPath}'.`)];
        }

        const positional = args?.positional || [];
        const valueArg =
            args?.flags?.['value'] ??
            (positional.length > 1 ? positional.slice(1) : undefined);

        const contentToWrite = extractContentValue(input, valueArg);

        try {
            const writable = await fileItem.handle.createWritable();
            await writable.write(contentToWrite);
            await writable.close();
            return [];
        } catch (err) {
            return [makeSearchError('WriteError', `Set-Content: Failed to write to file '${targetPath}': ${err.message}`)];
        }
    }

    // 7. Add-Content
    async function addContentHandler(input, args) {
        const pathArg =
            args?.flags?.['path'] ??
            args?.positional?.[0];

        if (!pathArg) {
            return [makeSearchError('InvalidArgument', 'Add-Content: Path parameter is missing.')];
        }

        const targetPath = resolvePathTarget(pathArg);
        const fileItem = findFile(targetPath);

        if (!fileItem || !fileItem.handle) {
            return [makeSearchError('ItemNotFound', `Add-Content: Cannot find file '${targetPath}'.`)];
        }

        const positional = args?.positional || [];
        const valueArg =
            args?.flags?.['value'] ??
            (positional.length > 1 ? positional.slice(1) : undefined);

        const contentToAppend = extractContentValue(input, valueArg);

        try {
            const existingFile = await fileItem.handle.getFile();
            const existingText = await existingFile.text();
            const newText = existingText ? `${existingText}\n${contentToAppend}` : contentToAppend;

            const writable = await fileItem.handle.createWritable();
            await writable.write(newText);
            await writable.close();
            return [];
        } catch (err) {
            return [makeSearchError('WriteError', `Add-Content: Failed to append to file '${targetPath}': ${err.message}`)];
        }
    }

    // 8. Clear-Content
    async function clearContentHandler(input, args) {
        const pathArg =
            args?.flags?.['path'] ??
            args?.positional?.[0];

        if (!pathArg) {
            return [makeSearchError('InvalidArgument', 'Clear-Content: Path parameter is missing.')];
        }

        const targetPath = resolvePathTarget(pathArg);
        if (!pathExists(targetPath)) {
            return [makeSearchError('ItemNotFound', `Clear-Content: Cannot find path '${targetPath}' because it does not exist.`)];
        }

        const fileItem = findFile(targetPath);

        if (!fileItem || !fileItem.handle) {
            return [makeSearchError('ItemNotFound', `Clear-Content: Cannot find file '${targetPath}'.`)];
        }

        try {
            const writable = await fileItem.handle.createWritable();
            await writable.write('');
            await writable.close();
            return [];
        } catch (err) {
            return [makeSearchError('WriteError', `Clear-Content: Failed to clear file '${targetPath}': ${err.message}`)];
        }
    }

    // =========================================================================
    // SAFE COMMAND REGISTRATION
    // =========================================================================

    const commandsToRegister = [
        {
            name: 'sort-object',
            aliases: ['sort'],
            category: 'pipeline',
            description: 'Sorts objects by property values.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine6',
            handler: sortObjectHandler
        },
        {
            name: 'group-object',
            aliases: ['group'],
            category: 'pipeline',
            description: 'Groups objects that contain the same value for specified properties.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine6',
            handler: groupObjectHandler
        },
        {
            name: 'measure-object',
            aliases: ['measure'],
            category: 'pipeline',
            description: 'Counts input objects and calculates numeric properties such as sum, average, minimum, and maximum.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine6',
            handler: measureObjectHandler
        },
        {
            name: 'get-member',
            aliases: ['gm'],
            category: 'utility',
            description: 'Gets the properties and methods of objects.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine6',
            handler: getMemberHandler
        },
        {
            name: 'compare-object',
            aliases: ['compare', 'diff'],
            category: 'utility',
            description: 'Compares two sets of objects.',
            acceptsPipeline: true,
            producesPipeline: true,
            source: 'engine6',
            handler: compareObjectHandler
        },
        {
            name: 'set-content',
            aliases: ['sc'],
            category: 'filesystem',
            description: 'Writes new content or replaces the content in a file.',
            acceptsPipeline: true,
            producesPipeline: false,
            source: 'engine6',
            handler: setContentHandler
        },
        {
            name: 'add-content',
            aliases: ['ac'],
            category: 'filesystem',
            description: 'Appends content to the specified items or file.',
            acceptsPipeline: true,
            producesPipeline: false,
            source: 'engine6',
            handler: addContentHandler
        },
        {
            name: 'clear-content',
            aliases: ['clc'],
            category: 'filesystem',
            description: 'Deletes the contents of an item, but does not delete the item.',
            acceptsPipeline: false,
            producesPipeline: false,
            source: 'engine6',
            handler: clearContentHandler
        },
        {
            name: 'test-path',
            aliases: [],
            category: 'filesystem',
            description: 'Tests whether a path exists.',
            acceptsPipeline: false,
            producesPipeline: true,
            source: 'engine6',
            handler: async function (input, args) {
                const pathArg =
                    args?.flags?.['path'] ??
                    args?.positional?.[0];

                if (!pathArg) {
                    return [makeSearchError(
                        'InvalidArgument',
                        'Test-Path: Path parameter is missing.'
                    )];
                }

                const targetPath = resolvePathTarget(pathArg);

                return [pathExists(targetPath)];
            }
        }
    ];

    // Attempt safe registration via Engine4
    commandsToRegister.forEach(cmdDef => {
        // Engine4 automatically checks legacy hooks and prevents unwanted overwrites
        const result = PSWeb.Commands.register(cmdDef);
        if (!result.success && !result.isLegacy) {
            // Safe logging without interrupting initialization
            console.warn(`[Engine6] Skipping command '${cmdDef.name}': ${result.error}`);
        }
    });

    // Register engine metadata into Runtime
    PSWeb.Runtime.registerEngine('engine6', {
        version: '1.0.0',
        role: 'data processing, inspection, & file mutation layer'
    });

})();
