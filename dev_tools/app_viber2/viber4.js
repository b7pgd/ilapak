/**
 * viber4.js - Lossless Intermediate Representation (LIR) Extension Layer
 * 
 * Objective: Enhance LIR generation toward true Lossless Extraction by 
 * capturing complete CSS declaration values, media query rules, keyframes, 
 * inline styles, DOM-to-CSS relationships, external stylesheets, and preserving 
 * AST metadata without modifying core engines.
 */

(function (global) {
    'use strict';

    // ==========================================
    // 1. CSS LOSSLESS EXTRACTION HELPERS
    // ==========================================

    /**
     * Strips CSS comments while preserving structure length/position context
     */
    function stripCSSComments(cssText) {
        if (!cssText) return '';
        return cssText.replace(/\/\*[\s\S]*?\*\//g, '');
    }

    /**
     * Parses CSS declarations string into key-value map.
     */
    function parseDeclarations(declBlock) {
        const declarations = {};
        if (!declBlock) return declarations;

        const statements = declBlock.split(';');
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i].trim();
            if (!statement) continue;

            const colonIndex = statement.indexOf(':');
            if (colonIndex !== -1) {
                const property = statement.substring(0, colonIndex).trim();
                const value = statement.substring(colonIndex + 1).trim();
                if (property && value) {
                    declarations[property] = value;
                }
            }
        }
        return declarations;
    }

    /**
     * Correctly parses @keyframes and @-webkit-keyframes blocks.
     */
    function parseKeyframeBlock(blockContent, animationName, mediaContext, sourceFile) {
        const keyframeRule = {
            type: 'keyframes',
            name: animationName,
            frames: [],
            source: sourceFile || 'inline'
        };
        if (mediaContext) keyframeRule.media = mediaContext;

        let buffer = '';
        let depth = 0;
        let frameSelector = '';

        for (let i = 0; i < blockContent.length; i++) {
            const char = blockContent[i];
            if (char === '{') {
                if (depth === 0) {
                    frameSelector = buffer.trim();
                    buffer = '';
                } else {
                    buffer += char;
                }
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    const decls = parseDeclarations(buffer.trim());
                    keyframeRule.frames.push({
                        selector: frameSelector,
                        declarations: decls
                    });
                    buffer = '';
                    frameSelector = '';
                } else {
                    buffer += char;
                }
            } else {
                buffer += char;
            }
        }

        return keyframeRule;
    }

    /**
     * Parses CSS content into detailed AST rules containing selector-declaration mappings,
     * support for media queries, keyframes, pseudo-selectors, and source order.
     */
    function extractCSSDeclarations(cssText, sourceFile) {
        const cleanedCSS = stripCSSComments(cssText);
        const rules = [];

        if (!cleanedCSS.trim()) {
            return rules;
        }

        const currentSource = sourceFile || 'inline';

        function parseRuleset(cssChunk, parentContext) {
            let buffer = '';
            let depth = 0;
            let currentSelector = '';
            let blockContent = '';

            for (let i = 0; i < cssChunk.length; i++) {
                const char = cssChunk[i];

                if (char === '{') {
                    if (depth === 0) {
                        currentSelector = buffer.trim();
                        buffer = '';
                    } else {
                        buffer += char;
                    }
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        blockContent = buffer.trim();
                        buffer = '';

                        if (currentSelector.startsWith('@media')) {
                            // Preserve media query context without flattening
                            parseRuleset(blockContent, currentSelector);
                        } else if (currentSelector.startsWith('@keyframes') || currentSelector.startsWith('@-webkit-keyframes')) {
                            const nameMatch = currentSelector.match(/@(?:-webkit-)?keyframes\s+([a-zA-Z0-9_-]+)/);
                            const animName = nameMatch ? nameMatch[1] : currentSelector;
                            rules.push(parseKeyframeBlock(blockContent, animName, parentContext, currentSource));
                        } else if (currentSelector.startsWith('@import') || currentSelector.startsWith('@charset')) {
                            // Skip top-level non-ruleset statements
                        } else {
                            const decls = parseDeclarations(blockContent);
                            if (Object.keys(decls).length > 0) {
                                const ruleEntry = {
                                    selector: currentSelector,
                                    declarations: decls,
                                    source: currentSource
                                };
                                if (parentContext) ruleEntry.media = parentContext;
                                rules.push(ruleEntry);
                            }
                        }
                        currentSelector = '';
                        blockContent = '';
                    } else {
                        buffer += char;
                    }
                } else {
                    buffer += char;
                }
            }
        }

        try {
            parseRuleset(cleanedCSS, null);
        } catch (e) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[viber4.js] Error parsing CSS declarations:', e);
            }
        }

        return rules;
    }

    /**
     * Extracts inline styles from HTML content or DOM node AST representations.
     */
    function extractInlineStyles(contentOrAST) {
        const inlineStyles = [];

        if (typeof contentOrAST === 'string') {
            const inlineStyleRegex = /<([a-zA-Z0-9-]+)\s+[^>]*?style\s*=\s*(["'])([\s\S]*?)\2[^>]*>/gi;
            let match;
            while ((match = inlineStyleRegex.exec(contentOrAST)) !== null) {
                const tag = match[1];
                const styleString = match[3];
                const decls = parseDeclarations(styleString);
                if (Object.keys(decls).length > 0) {
                    inlineStyles.push({
                        element: tag,
                        raw: styleString,
                        declarations: decls
                    });
                }
            }
        }

        return inlineStyles;
    }

    // ==========================================
    // 2. EXTERNAL CSS & SOURCE ORDER RESOLVER
    // ==========================================

    /**
     * Resolves external stylesheet content from file storage using flexible path matching.
     */
    function lookupFileInStorage(fileStore, href) {
        if (!fileStore || !href) return null;

        // Clean href for comparison
        const normalizedHref = href.replace(/^(\.\/|\/)/, '');

        // 1. Direct path matches
        if (fileStore[href]) return fileStore[href];
        if (fileStore['/' + normalizedHref]) return fileStore['/' + normalizedHref];
        if (fileStore['./' + normalizedHref]) return fileStore['./' + normalizedHref];
        if (fileStore[normalizedHref]) return fileStore[normalizedHref];

        // 2. Loose key suffix / base filename match
        const keys = Object.keys(fileStore);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const cleanKey = key.replace(/^(\.\/|\/)/, '');
            if (cleanKey === normalizedHref || cleanKey.endsWith('/' + normalizedHref)) {
                return fileStore[key];
            }
        }

        return null;
    }

    /**
     * Resolves external stylesheet references from HTML content and file stores while
     * preserving strict cascade source order.
     */
    function resolveAllStylesheets(htmlContent) {
        const resolvedSources = [];
        const unresolvedSources = [];
        const allRules = [];

        if (typeof htmlContent !== 'string') {
            return { rules: allRules, resolved: resolvedSources, unresolved: unresolvedSources };
        }

        const tagRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>|<style[\s\S]*?>[\s\S]*?<\/style>/gi;
        let match;

        // Safely inspect all potential project file containers without modifying core
        const fileStore = global.projectFiles || global.globalFileStorage || global.viberFiles || (typeof window !== 'undefined' ? window.projectFiles : null) || {};

        while ((match = tagRegex.exec(htmlContent)) !== null) {
            const tag = match[0];

            if (tag.toLowerCase().startsWith('<link')) {
                const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
                if (hrefMatch) {
                    const href = hrefMatch[1];
                    let fileContent = lookupFileInStorage(fileStore, href);

                    if (!fileContent && typeof document !== 'undefined') {
                        // Check inline DOM cache or script text nodes if in browser runtime
                        const fileNode = document.querySelector(`script[data-filename="${href}"], template[data-filename="${href}"]`);
                        if (fileNode) fileContent = fileNode.textContent || fileNode.innerHTML;
                    }

                    if (fileContent) {
                        resolvedSources.push(href);
                        const rules = extractCSSDeclarations(fileContent, href);
                        allRules.push(...rules);
                    } else {
                        unresolvedSources.push(href);
                    }
                }
            } else {
                // Internal <style> block
                const styleContent = tag.replace(/<style[\s\S]*?>/i, '').replace(/<\/style>/i, '');
                const rules = extractCSSDeclarations(styleContent, 'inline <style>');
                allRules.push(...rules);
            }
        }

        return {
            rules: allRules,
            resolved: resolvedSources,
            unresolved: unresolvedSources
        };
    }

    // ==========================================
    // 3. DOM NODE ↔ CSS SELECTOR MAPPING
    // ==========================================

    /**
     * Maps extracted CSS rules to DOM nodes identified in HTML content.
     */
    function mapDOMCSSRelationships(htmlContent, rules) {
        const relationships = [];
        if (typeof htmlContent !== 'string' || !Array.isArray(rules)) return relationships;

        // Extract element tokens (tag, id, classes, inline style)
        const elementRegex = /<([a-zA-Z0-9-]+)(\s+[^>]*?)?>/g;
        let match;

        while ((match = elementRegex.exec(htmlContent)) !== null) {
            const tag = match[1];
            const attrs = match[2] || '';

            if (tag.toLowerCase() === 'script' || tag.toLowerCase() === 'style' || tag.toLowerCase() === 'link') continue;

            const idMatch = attrs.match(/id=["']([^"']+)["']/i);
            const classMatch = attrs.match(/class=["']([^"']+)["']/i);

            const elementId = idMatch ? idMatch[1] : null;
            const elementClasses = classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [];

            if (!elementId && elementClasses.length === 0) continue;

            const matchedRules = [];
            const combinedDeclarations = {};

            rules.forEach(rule => {
                if (rule.type === 'keyframes' || !rule.selector) return;

                // Simple intent selector matching engine
                const sel = rule.selector.trim();
                let isMatch = false;

                if (elementId && sel.includes(`#${elementId}`)) {
                    isMatch = true;
                } else {
                    for (let i = 0; i < elementClasses.length; i++) {
                        if (sel.includes(`.${elementClasses[i]}`)) {
                            isMatch = true;
                            break;
                        }
                    }
                }

                if (!isMatch && sel === tag) {
                    isMatch = true;
                }

                if (isMatch) {
                    matchedRules.push(rule.selector);
                    if (rule.declarations) {
                        Object.assign(combinedDeclarations, rule.declarations);
                    }
                }
            });

            if (matchedRules.length > 0) {
                relationships.push({
                    tag,
                    id: elementId,
                    classes: elementClasses,
                    attributes: attrs.trim(),
                    matchedSelectors: matchedRules,
                    declarations: combinedDeclarations
                });
            }
        }

        return relationships;
    }

    // ==========================================
    // 4. COMPUTED STYLE SNAPSHOTTER
    // ==========================================

    /**
     * Captures computed style snapshot if running in a browser environment with mounted DOM.
     * Fully optional: non-blocking safety wrapper.
     */
    function captureComputedStyleSnapshot(relationships) {
        const snapshots = [];
        try {
            if (typeof window === 'undefined' || typeof document === 'undefined') return snapshots;

            relationships.forEach(rel => {
                let selector = '';
                if (rel.id) selector = `#${rel.id}`;
                else if (rel.classes.length > 0) selector = `.${rel.classes[0]}`;
                else selector = rel.tag;

                try {
                    const el = document.querySelector(selector);
                    if (el) {
                        const comp = window.getComputedStyle(el);
                        snapshots.push({
                            selector,
                            computed: {
                                width: comp.getPropertyValue('width'),
                                height: comp.getPropertyValue('height'),
                                color: comp.getPropertyValue('color'),
                                backgroundColor: comp.getPropertyValue('background-color'),
                                position: comp.getPropertyValue('position'),
                                transform: comp.getPropertyValue('transform'),
                                display: comp.getPropertyValue('display')
                            }
                        });
                    }
                } catch (e) {
                    // Non-blocking query/parsing error isolation
                }
            });
        } catch (globalErr) {
            // Guard against environment restrictions or DOM access issues
        }

        return snapshots;
    }

    // ==========================================
    // 5. CSS PARSER WRAPPER (parseCSS)
    // ==========================================

    function applyCSSWrapper() {
        if (typeof global.parseCSS === 'function') {
            const originalParseCSS = global.parseCSS;

            global.parseCSS = function (content) {
                const result = originalParseCSS.apply(this, arguments) || {};

                result.classes = result.classes || [];
                result.ids = result.ids || [];
                result.selectors = result.selectors || [];

                const stylesheetData = resolveAllStylesheets(content || '');
                result.rules = stylesheetData.rules;
                result.inlineStyles = extractInlineStyles(content || '');
                result.resolvedStylesheets = stylesheetData.resolved;
                result.unresolvedStylesheets = stylesheetData.unresolved;
                result.domRelationships = mapDOMCSSRelationships(content || '', stylesheetData.rules);
                result.computedSnapshots = captureComputedStyleSnapshot(result.domRelationships);

                return result;
            };
        } else {
            global.parseCSS = function (content) {
                const stylesheetData = resolveAllStylesheets(content || '');
                const domRelationships = mapDOMCSSRelationships(content || '', stylesheetData.rules);
                return {
                    classes: [],
                    ids: [],
                    selectors: [],
                    rules: stylesheetData.rules,
                    inlineStyles: extractInlineStyles(content || ''),
                    resolvedStylesheets: stylesheetData.resolved,
                    unresolvedStylesheets: stylesheetData.unresolved,
                    domRelationships,
                    computedSnapshots: captureComputedStyleSnapshot(domRelationships)
                };
            };
        }
    }

    // ==========================================
    // 6. AST ENHANCEMENT HOOK (parseAST / buildAST)
    // ==========================================

    function enhanceAST(ast, rawContent) {
        if (!ast) return ast;

        if (typeof rawContent === 'string') {
            const stylesheetData = resolveAllStylesheets(rawContent);
            if (!ast.css) ast.css = {};

            ast.css.rules = stylesheetData.rules;
            ast.css.resolvedStylesheets = stylesheetData.resolved;
            ast.css.unresolvedStylesheets = stylesheetData.unresolved;

            ast.inlineStyles = extractInlineStyles(rawContent);
            ast.domCSSRelationships = mapDOMCSSRelationships(rawContent, stylesheetData.rules);
            ast.computedSnapshots = captureComputedStyleSnapshot(ast.domCSSRelationships);
        }

        return ast;
    }

    function applyASTWrapper() {
        if (typeof global.parseAST === 'function') {
            const originalParseAST = global.parseAST;
            global.parseAST = function (content) {
                const ast = originalParseAST.apply(this, arguments);
                return enhanceAST(ast, content);
            };
        }
        if (typeof global.buildAST === 'function') {
            const originalBuildAST = global.buildAST;
            global.buildAST = function (content) {
                const ast = originalBuildAST.apply(this, arguments);
                return enhanceAST(ast, content);
            };
        }
    }

    // ==========================================
    // 7. LIR GENERATOR WRAPPER (buildLIR)
    // ==========================================

    function applyLIRWrapper() {
        if (typeof global.buildLIR === 'function') {
            const originalBuildLIR = global.buildLIR;

            global.buildLIR = function (ast) {
                let lirOutput = originalBuildLIR.apply(this, arguments);
                if (typeof lirOutput !== 'string') {
                    lirOutput = String(lirOutput || '');
                }

                const extendedSections = [];

                // 1. CSS SOURCE FILE MAP
                if (ast && ast.css && ((ast.css.resolvedStylesheets && ast.css.resolvedStylesheets.length > 0) || (ast.css.unresolvedStylesheets && ast.css.unresolvedStylesheets.length > 0))) {
                    let sourceMapSection = '\n\n## CSS SOURCE FILE MAP\n';
                    if (ast.css.resolvedStylesheets && ast.css.resolvedStylesheets.length > 0) {
                        sourceMapSection += '\nResolved Stylesheets:\n';
                        ast.css.resolvedStylesheets.forEach(file => {
                            sourceMapSection += `- ${file}\n`;
                        });
                    }
                    if (ast.css.unresolvedStylesheets && ast.css.unresolvedStylesheets.length > 0) {
                        sourceMapSection += '\nUnresolved Stylesheet References:\n';
                        ast.css.unresolvedStylesheets.forEach(file => {
                            sourceMapSection += `- ${file} (WARNING: Asset content not found in file store)\n`;
                        });
                    }
                    extendedSections.push(sourceMapSection);
                }

                // 2. CSS DECLARATION MAP
                if (ast && ast.css && Array.isArray(ast.css.rules) && ast.css.rules.length > 0) {
                    let cssMapSection = '\n\n## CSS DECLARATION MAP\n';
                    const standardRules = ast.css.rules.filter(r => r.type !== 'keyframes');

                    standardRules.forEach(rule => {
                        cssMapSection += `\nSource:\n${rule.source || 'inline'}\n`;
                        cssMapSection += `Selector:\n${rule.selector}\n`;
                        if (rule.media) {
                            cssMapSection += `Context: ${rule.media}\n`;
                        }
                        cssMapSection += `Properties:\n`;
                        Object.keys(rule.declarations || {}).forEach(prop => {
                            cssMapSection += `- ${prop}:${rule.declarations[prop]}\n`;
                        });
                    });

                    extendedSections.push(cssMapSection);
                }

                // 3. KEYFRAME DEFINITIONS
                if (ast && ast.css && Array.isArray(ast.css.rules)) {
                    const keyframeRules = ast.css.rules.filter(r => r.type === 'keyframes');
                    if (keyframeRules.length > 0) {
                        let keyframeSection = '\n\n## KEYFRAME DEFINITIONS\n';
                        keyframeRules.forEach(kf => {
                            keyframeSection += `\nKeyframe Name: ${kf.name}\n`;
                            keyframeSection += `Source: ${kf.source || 'inline'}\n`;
                            if (kf.media) keyframeSection += `Context: ${kf.media}\n`;
                            keyframeSection += `Frames:\n`;
                            kf.frames.forEach(frame => {
                                keyframeSection += `  Frame ${frame.selector}:\n`;
                                Object.keys(frame.declarations || {}).forEach(prop => {
                                    keyframeSection += `  - ${prop}:${frame.declarations[prop]}\n`;
                                });
                            });
                        });
                        extendedSections.push(keyframeSection);
                    }
                }

                // 4. DOM CSS RELATIONSHIP MAP
                if (ast && Array.isArray(ast.domCSSRelationships) && ast.domCSSRelationships.length > 0) {
                    let relSection = '\n\n## DOM CSS RELATIONSHIP MAP\n';
                    ast.domCSSRelationships.forEach(rel => {
                        relSection += `\nElement:\n${rel.tag}\n`;
                        if (rel.id) relSection += `ID: #${rel.id}\n`;
                        if (rel.classes.length > 0) relSection += `Classes: .${rel.classes.join(' .')}\n`;
                        relSection += `Selector Match:\n${rel.matchedSelectors.join(', ')}\n`;
                        relSection += `Applied CSS Rules:\n`;
                        Object.keys(rel.declarations).forEach(prop => {
                            relSection += `- ${prop}:${rel.declarations[prop]}\n`;
                        });
                    });
                    extendedSections.push(relSection);
                }

                // 5. COMPUTED STYLE SNAPSHOT
                if (ast && Array.isArray(ast.computedSnapshots) && ast.computedSnapshots.length > 0) {
                    let snapSection = '\n\n## COMPUTED STYLE SNAPSHOT\n';
                    ast.computedSnapshots.forEach(snap => {
                        snapSection += `\nSelector: ${snap.selector}\nComputed:\n`;
                        Object.keys(snap.computed).forEach(prop => {
                            snapSection += `- ${prop}:${snap.computed[prop]}\n`;
                        });
                    });
                    extendedSections.push(snapSection);
                }

                // 6. INLINE STYLE DECLARATIONS
                if (ast && Array.isArray(ast.inlineStyles) && ast.inlineStyles.length > 0) {
                    let inlineSection = '\n\n## INLINE STYLE DECLARATIONS\n';
                    ast.inlineStyles.forEach((item, index) => {
                        inlineSection += `\nInline Element [${index + 1}] (${item.element}):\nProperties:\n`;
                        Object.keys(item.declarations).forEach(prop => {
                            inlineSection += `- ${prop}:${item.declarations[prop]}\n`;
                        });
                    });
                    extendedSections.push(inlineSection);
                }

                return lirOutput + extendedSections.join('');
            };
        }
    }

    // ==========================================
    // 8. SCRIPT LOAD SAFETY & INITIALIZATION
    // ==========================================

    function initViber4() {
        applyCSSWrapper();
        applyASTWrapper();
        applyLIRWrapper();
    }

    // Safe execution hook
    if (typeof global.buildLIR === 'function' || typeof global.parseCSS === 'function') {
        initViber4();
    } else {
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('DOMContentLoaded', initViber4);
            window.addEventListener('load', initViber4);
        } else {
            initViber4();
        }
    }

    // Expose initialization hook for manual engine re-sync
    global.__initViber4 = initViber4;

})(typeof window !== 'undefined' ? window : this);
