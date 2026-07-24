/**
 * Viber LIR Generator Engine
 * Parsers file contents using DOMParser, regex, and AST structures without hardcoded templates.
 */

let projectFiles = {};
if (typeof window !== 'undefined') {
    window.projectFiles = projectFiles;
}
let selectedFileKeys = [];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('folderPicker').addEventListener('change', readProject);
    document.getElementById('btnSelectAll').addEventListener('click', selectAllFiles);
    document.getElementById('btnUnselectAll').addEventListener('click', unselectAllFiles);
    document.getElementById('btnExtract').addEventListener('click', extractSkeleton);
    document.getElementById('btnCopy').addEventListener('click', copyToClipboard);
    document.getElementById('btnDownload').addEventListener('click', downloadAsTxt);
});

function readProject(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    projectFiles = {};
    if (typeof window !== 'undefined') {
        window.projectFiles = projectFiles;
    }
    selectedFileKeys = [];
    updateActionButtons();
    const fileListUI = document.getElementById('fileList');
    fileListUI.innerHTML = '';

    let counted = 0;
    const blacklistedExtensions = [
        '.zip', '.exe', '.bin', '.png', '.jpg', '.jpeg', '.gif', 
        '.ico', '.mp4', '.mp3', '.pdf', '.ttf', '.woff', '.woff2', '.eot'
    ];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = file.webkitRelativePath;
        const lowerFileName = file.name.toLowerCase();

        if (path.includes('/.git/') ||
            path.includes('/node_modules/') ||
            path.includes('/.idea/') ||
            path.includes('/uploads/') ||
            path.includes('/assets/')) {
            continue;
        }

        const isAnomaly = blacklistedExtensions.some(ext => lowerFileName.endsWith(ext));

        if (!isAnomaly) {
            projectFiles[path] = file;

            const li = document.createElement('li');
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = path;
            chk.onclick = function(event) { event.stopPropagation(); toggleFileSelect(this.checked, path); };

            const label = document.createElement('span');
            label.textContent = path;

            li.appendChild(chk);
            li.appendChild(label);
            li.title = path;
            li.onclick = function() { 
                const checkbox = this.querySelector('input[type="checkbox"]');
                checkbox.checked = !checkbox.checked;
                toggleFileSelect(checkbox.checked, path);
            };

            fileListUI.appendChild(li);
            counted++;
        }
    }

    document.getElementById('statusText').innerText = 'Berhasil memuat folder!';
    document.getElementById('fileCount').innerText = counted;
    
    const hasFiles = counted > 0;
    document.getElementById('btnSelectAll').disabled = !hasFiles;
    document.getElementById('btnUnselectAll').disabled = !hasFiles;
}

function toggleFileSelect(isChecked, fileKey) {
    const listItems = document.querySelectorAll('#fileList li');
    let targetLi = null;
    for (let li of listItems) {
        if (li.title === fileKey) {
            targetLi = li;
            break;
        }
    }

    if (isChecked) {
        if (!selectedFileKeys.includes(fileKey)) {
            selectedFileKeys.push(fileKey);
        }
        if (targetLi) targetLi.classList.add('active');
    } else {
        selectedFileKeys = selectedFileKeys.filter(k => k !== fileKey);
        if (targetLi) targetLi.classList.remove('active');
    }

    document.getElementById('selectedCount').innerText = selectedFileKeys.length;

    if (selectedFileKeys.length > 0) {
        document.getElementById('pathBanner').innerText = `Target Aktif: ${selectedFileKeys.length} File terpilih`;
    } else {
        document.getElementById('pathBanner').innerText = 'Pilih file dari daftar di atas...';
    }
    updateActionButtons();
}

function selectAllFiles() {
    selectedFileKeys = [];
    const checkboxes = document.querySelectorAll('#fileList li input[type="checkbox"]');
    checkboxes.forEach(chk => {
        chk.checked = true;
        const path = chk.value;
        if (!selectedFileKeys.includes(path)) {
            selectedFileKeys.push(path);
        }
    });
    const listItems = document.querySelectorAll('#fileList li');
    listItems.forEach(li => li.classList.add('active'));
    
    document.getElementById('selectedCount').innerText = selectedFileKeys.length;
    document.getElementById('pathBanner').innerText = `Target Aktif: ${selectedFileKeys.length} File terpilih`;
    updateActionButtons();
}

function unselectAllFiles() {
    selectedFileKeys = [];
    const checkboxes = document.querySelectorAll('#fileList li input[type="checkbox"]');
    checkboxes.forEach(chk => {
        chk.checked = false;
    });
    const listItems = document.querySelectorAll('#fileList li');
    listItems.forEach(li => li.classList.remove('active'));
    
    document.getElementById('selectedCount').innerText = 0;
    document.getElementById('pathBanner').innerText = 'Pilih file dari daftar di atas...';
    updateActionButtons();
}

function updateActionButtons() {
    const hasSelection = selectedFileKeys.length > 0;
    document.getElementById('btnExtract').disabled = !hasSelection;
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

async function extractSkeleton() {
    if (selectedFileKeys.length === 0) return;

    let finalOutputArray = [];
    document.getElementById('outputArea').value = "Analyzing and generating LIR from source content...";

    for (let fileKey of selectedFileKeys) {
        const file = projectFiles[fileKey];
        if (!file) continue;

        try {
            const content = await readFile(file);
            const ast = buildAST(fileKey, file, content);
            const lir = buildLIR(ast);
            finalOutputArray.push(lir);
        } catch (err) {
            console.error("Error reading file:", fileKey, err);
        }
    }

    renderOutput(finalOutputArray.join('\n\n=========================================\n\n'));
}

function buildAST(path, file, content) {
    const fileName = file.name;
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const folder = path.substring(0, path.lastIndexOf('/')) || '/';

    const ast = {
        fileInfo: {
            name: fileName,
            extension: ext,
            folder: folder,
            relativePath: path,
            size: file.size
        },
        projectInfo: detectProjectInfo(content, ext),
        imports: parseImports(content),
        metadata: parseMetadata(content),
        css: parseCSS(content),
        domTree: parseDOM(content),
        attributes: parseAttributes(content),
        events: parseEvents(content),
        javascript: parseJS(content),
        endpoints: parseEndpoints(content),
        goTemplate: parseGoTemplate(content),
        loops: parseLoops(content),
        conditions: parseConditions(content),
        forms: parseForms(content),
        tables: parseTables(content),
        links: parseLinks(content),
        images: parseImages(content),
        scripts: parseScripts(content),
        dependencies: parseDependencies(content)
    };

    return ast;
}

function detectProjectInfo(content, ext) {
    let framework = "None";
    let templateEngine = "None";
    let language = "Unknown";
    let fileType = "Unknown";
    let isFrontend = false;
    let isBackend = false;

    if (['html', 'htm', 'blade.php', 'tmpl', 'gohtml', 'ejs', 'hbs', 'jsx', 'tsx', 'vue'].includes(ext)) {
        isFrontend = true;
    }
    if (['go', 'php', 'js', 'ts', 'py', 'java', 'rb'].includes(ext)) {
        isBackend = true;
    }

    if (content.includes('import React') || content.includes('from "react"') || ['jsx', 'tsx'].includes(ext)) {
        framework = "React / Next.js";
        language = "JavaScript/TypeScript";
        isFrontend = true;
    } else if (content.includes('import Vue') || content.includes('createApp') || ext === 'vue') {
        framework = "Vue.js";
        language = "JavaScript";
        isFrontend = true;
    } else if (content.includes('gin.Context') || content.includes('github.com/gin-gonic/gin')) {
        framework = "Gin (Go)";
        language = "Go";
        isBackend = true;
    } else if (content.includes('labstack/echo') || content.includes('echo.Context')) {
        framework = "Echo (Go)";
        language = "Go";
        isBackend = true;
    } else if (content.includes('gofiber/fiber')) {
        framework = "Fiber (Go)";
        language = "Go";
        isBackend = true;
    } else if (content.includes('Illuminate\\') || content.includes('@extends') || content.includes('@section')) {
        framework = "Laravel";
        language = "PHP";
        templateEngine = "Blade";
    } else if (ext === 'go') {
        language = "Go";
        isBackend = true;
    } else if (ext === 'php') {
        language = "PHP";
    } else if (ext === 'js' || ext === 'ts') {
        language = ext === 'ts' ? "TypeScript" : "JavaScript";
    } else if (ext === 'html') {
        language = "HTML";
    }

    if (content.match(/\{\{\s*(if|range|template|define|with|\.).*?\}\}/)) {
        templateEngine = "Go Template";
    } else if (content.includes('<%') && content.includes('%>')) {
        templateEngine = "EJS";
    } else if (content.includes('{{') && content.includes('}}') && templateEngine === "None") {
        templateEngine = "Handlebars / Mustache";
    }

    fileType = isFrontend && isBackend ? "Fullstack Component" : isFrontend ? "Frontend Component/View" : isBackend ? "Backend Source" : "Config/Asset";

    return { framework, templateEngine, language, fileType, isFrontend, isBackend };
}

function parseImports(content) {
    const imports = [];
    const esImportRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /(?:const|let|var)\s+([\w\{\}\s,]+)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
    const goImportRegex = /import\s+\(\s*([\s\S]*?)\s*\)|import\s+['"]([^'"]+)['"]/g;
    const scriptSrcRegex = /<script[^>]+src=['"]([^'"]+)['"]/gi;
    const linkCssRegex = /<link[^>]+rel=['"]stylesheet['"][^>]+href=['"]([^'"]+)['"]/gi;

    let match;
    while ((match = esImportRegex.exec(content)) !== null) {
        imports.push({ type: 'ES6 Import', module: match[2], symbols: match[1].trim() });
    }
    while ((match = requireRegex.exec(content)) !== null) {
        imports.push({ type: 'CommonJS Require', module: match[2], symbols: match[1].trim() });
    }
    while ((match = goImportRegex.exec(content)) !== null) {
        const rawGroup = match[1] || match[2];
        if (rawGroup) {
            rawGroup.split('\n').map(s => s.trim().replace(/"/g, '')).filter(Boolean).forEach(pkg => {
                imports.push({ type: 'Go Package', module: pkg });
            });
        }
    }
    while ((match = scriptSrcRegex.exec(content)) !== null) {
        imports.push({ type: 'Script Tag External', module: match[1] });
    }
    while ((match = linkCssRegex.exec(content)) !== null) {
        imports.push({ type: 'Stylesheet Link', module: match[1] });
    }

    return imports;
}

function parseMetadata(content) {
    const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
    const charsetMatch = content.match(/<meta[^>]+charset=['"]?([^'"/>\s]+)/i);
    const viewportMatch = content.match(/<meta[^>]+name=['"]viewport['"][^>]+content=['"]([^'"]+)['"]/i);
    const metaMatches = [...content.matchAll(/<meta[^>]+name=['"]([^'"]+)['"][^>]+content=['"]([^'"]+)['"]/gi)];
    const faviconMatches = [...content.matchAll(/<link[^>]+rel=['"](?:shortcut )?icon['"][^>]+href=['"]([^'"]+)['"]/gi)];

    return {
        title: titleMatch ? titleMatch[1].trim() : null,
        charset: charsetMatch ? charsetMatch[1].trim() : null,
        viewport: viewportMatch ? viewportMatch[1].trim() : null,
        metas: metaMatches.map(m => ({ name: m[1], content: m[2] })),
        favicons: faviconMatches.map(m => m[1])
    };
}

function parseCSS(content) {
    const cssBlocks = [];
    const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;

    while ((match = styleTagRegex.exec(content)) !== null) {
        cssBlocks.push(match[1]);
    }

    if (cssBlocks.length === 0 && !content.includes('<html') && (content.includes('{') && content.includes(':'))) {
        cssBlocks.push(content);
    }

    const cssString = cssBlocks.join('\n');
    const selectors = new Set();
    const classes = new Set();
    const ids = new Set();
    const cssVars = new Set();
    const mediaQueries = [];
    const keyframes = [];

    const varRegex = /--[a-zA-Z0-9_-]+/g;
    while ((match = varRegex.exec(cssString)) !== null) cssVars.add(match[0]);

    const classRegex = /\.([a-zA-Z0-9_-]+)/g;
    while ((match = classRegex.exec(cssString)) !== null) classes.add(match[1]);

    const idRegex = /#([a-zA-Z0-9_-]+)/g;
    while ((match = idRegex.exec(cssString)) !== null) ids.add(match[1]);

    const mediaRegex = /@media[^{]+\{([\s\S]+?\}\s*)\}/g;
    while ((match = mediaRegex.exec(cssString)) !== null) mediaQueries.push(match[0].trim());

    const keyframeRegex = /@keyframes\s+([a-zA-Z0-9_-]+)/g;
    while ((match = keyframeRegex.exec(cssString)) !== null) keyframes.push(match[1]);

    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    while ((match = ruleRegex.exec(cssString)) !== null) {
        const sel = match[1].trim();
        if (!sel.startsWith('@')) selectors.add(sel);
    }

    return {
        selectors: Array.from(selectors),
        classes: Array.from(classes),
        ids: Array.from(ids),
        variables: Array.from(cssVars),
        mediaQueries,
        keyframes
    };
}

function parseDOM(content) {
    if (!content.includes('<') || !content.includes('>')) return null;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        function buildTree(node) {
            if (!node) return null;

            if (node.nodeType === Node.ELEMENT_NODE) {
                const attrs = {};
                for (let attr of node.attributes) {
                    attrs[attr.name] = attr.value;
                }

                const children = [];
                for (let child of node.childNodes) {
                    const parsedChild = buildTree(child);
                    if (parsedChild) children.push(parsedChild);
                }

                return {
                    type: 'element',
                    tag: node.tagName.toLowerCase(),
                    attributes: attrs,
                    children: children.filter(c => c !== null)
                };
            } else if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text.length > 0) {
                    return { type: 'text', value: text };
                }
            }
            return null;
        }

        const rootNodes = [];
        for (let child of doc.body.childNodes) {
            const parsed = buildTree(child);
            if (parsed) rootNodes.push(parsed);
        }

        if (rootNodes.length === 0 && doc.head) {
            for (let child of doc.head.childNodes) {
                const parsed = buildTree(child);
                if (parsed) rootNodes.push(parsed);
            }
        }

        return rootNodes.length > 0 ? rootNodes : null;
    } catch (e) {
        return null;
    }
}

function parseAttributes(content) {
    const attributeMap = {};
    const attrRegex = /([a-zA-Z0-9:\b_\-]+)\s*=\s*["']([^"']*)["']/g;
    let match;

    while ((match = attrRegex.exec(content)) !== null) {
        const attrName = match[1];
        const attrValue = match[2];
        if (!attributeMap[attrName]) attributeMap[attrName] = new Set();
        attributeMap[attrName].add(attrValue);
    }

    const result = {};
    for (let k in attributeMap) {
        result[k] = Array.from(attributeMap[k]);
    }

    return result;
}

function parseEvents(content) {
    const inlineEvents = [];
    const eventListeners = [];
    const customEvents = [];

    const inlineRegex = /(on[a-z]+)\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = inlineRegex.exec(content)) !== null) {
        inlineEvents.push({ event: match[1], handler: match[2] });
    }

    const listenerRegex = /\.addEventListener\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^,\)]+)/g;
    while ((match = listenerRegex.exec(content)) !== null) {
        eventListeners.push({ event: match[1], handler: match[2].trim() });
    }

    const customEventRegex = /new\s+(?:CustomEvent|Event)\s*\(\s*['"]([^'"]+)['"]/g;
    while ((match = customEventRegex.exec(content)) !== null) {
        customEvents.push(match[1]);
    }

    return { inlineEvents, eventListeners, customEvents };
}

function parseJS(content) {
    const functions = [];
    const variables = [];
    const apis = [];
    const browserAPIs = new Set();

    const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
        functions.push({ type: 'Standard Function', name: match[1], params: match[2] });
    }

    const arrowRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
        functions.push({ type: 'Arrow Function', name: match[1], params: match[2] });
    }

    const classRegex = /class\s+([a-zA-Z0-9_$]+)/g;
    while ((match = classRegex.exec(content)) !== null) {
        functions.push({ type: 'Class', name: match[1] });
    }

    const varRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/g;
    while ((match = varRegex.exec(content)) !== null) {
        variables.push(match[1]);
    }

    const browserGlobals = ['localStorage', 'sessionStorage', 'window', 'document', 'navigator', 'clipboard', 'history', 'location', 'MutationObserver', 'IntersectionObserver'];
    browserGlobals.forEach(bg => {
        if (content.includes(bg)) browserAPIs.add(bg);
    });

    return { functions, variables, browserAPIs: Array.from(browserAPIs) };
}

function parseEndpoints(content) {
    const endpoints = [];
    const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
    const axiosRegex = /axios(?:\.(?:get|post|put|patch|delete))?\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
    const xhrRegex = /\.open\s*\(\s*['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*[`'"]([^`'"]+)[`'"]/g;

    let match;
    while ((match = fetchRegex.exec(content)) !== null) {
        endpoints.push({ method: 'FETCH/GET', url: match[1] });
    }
    while ((match = axiosRegex.exec(content)) !== null) {
        endpoints.push({ method: 'AXIOS', url: match[1] });
    }
    while ((match = xhrRegex.exec(content)) !== null) {
        endpoints.push({ method: match[1], url: match[2] });
    }

    return endpoints;
}

function parseGoTemplate(content) {
    const matches = content.match(/\{\{[\s\S]*?\}\}/g) || [];
    const parsed = {
        conditions: [],
        loops: [],
        expressions: [],
        variables: [],
        functionCalls: [],
        pipelines: [],
        templateIncludes: []
    };

    matches.forEach(tag => {
        const clean = tag.replace(/^\{\{|\}\}$/g, '').trim();

        if (clean.startsWith('if ') || clean.startsWith('else if')) {
            parsed.conditions.push(clean);
        } else if (clean.startsWith('range ')) {
            parsed.loops.push(clean);
        } else if (clean.startsWith('template ') || clean.startsWith('block ') || clean.startsWith('define ')) {
            parsed.templateIncludes.push(clean);
        } else if (clean.includes('|')) {
            parsed.pipelines.push(clean);
        } else if (clean.startsWith('.')) {
            parsed.variables.push(clean);
        } else if (/\b(eq|ne|or|and|not|index|printf|add)\b/.test(clean)) {
            parsed.functionCalls.push(clean);
        } else {
            parsed.expressions.push(clean);
        }
    });

    return parsed;
}

function parseLoops(content) {
    const loops = [];
    const loopRegex = /\b(for|while|foreach|map|filter|reduce|forEach)\b\s*[\(\{\:]/g;
    let match;
    while ((match = loopRegex.exec(content)) !== null) {
        loops.push(match[1]);
    }
    return Array.from(new Set(loops));
}

function parseConditions(content) {
    const conditions = [];
    const condRegex = /\b(if|else|switch|case)\b\s*[\(\{\:]/g;
    let match;
    while ((match = condRegex.exec(content)) !== null) {
        conditions.push(match[1]);
    }
    if (content.includes('?')) conditions.push('Ternary (?)');
    return Array.from(new Set(conditions));
}

function parseForms(content) {
    const formElements = [];
    const tags = ['form', 'input', 'textarea', 'button', 'select', 'option'];

    tags.forEach(tag => {
        const tagRegex = new RegExp(`<${tag}[^>]*>`, 'gi');
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
            formElements.push(match[0]);
        }
    });

    return formElements;
}

function parseTables(content) {
    const tableElements = [];
    const tags = ['thead', 'tbody', 'tr', 'td', 'th'];

    tags.forEach(tag => {
        const tagRegex = new RegExp(`<${tag}[^>]*>`, 'gi');
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
            tableElements.push(match[0]);
        }
    });

    return tableElements;
}

function parseLinks(content) {
    const links = [];
    const linkRegex = /(?:href|src)=["']([^"']+)["']/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
        links.push(match[1]);
    }

    return Array.from(new Set(links));
}

function parseImages(content) {
    const media = [];
    const mediaRegex = /<(img|picture|svg|canvas|video|audio)[^>]*>/gi;
    let match;

    while ((match = mediaRegex.exec(content)) !== null) {
        media.push(match[0]);
    }

    return media;
}

function parseScripts(content) {
    const scripts = [];
    const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = scriptRegex.exec(content)) !== null) {
        const attrs = match[1];
        const body = match[2].trim();

        if (attrs.includes('src=')) {
            const srcMatch = attrs.match(/src=["']([^"']+)["']/);
            scripts.push({ type: 'External', src: srcMatch ? srcMatch[1] : 'Unknown' });
        } else if (attrs.includes('type="module"') || attrs.includes("type='module'")) {
            scripts.push({ type: 'Module', inlineLength: body.length });
        } else {
            scripts.push({ type: 'Internal', inlineLength: body.length });
        }
    }

    return scripts;
}

function parseDependencies(content) {
    const detected = [];
    const libs = [
        { name: 'Tailwind CSS', key: 'tailwindcss' },
        { name: 'Bootstrap', key: 'bootstrap' },
        { name: 'jQuery', key: 'jquery' },
        { name: 'Alpine.js', key: 'alpine' },
        { name: 'Vue.js', key: 'vue' },
        { name: 'React', key: 'react' },
        { name: 'HTMX', key: 'htmx' },
        { name: 'FontAwesome', key: 'fontawesome' }
    ];

    libs.forEach(lib => {
        if (content.toLowerCase().includes(lib.key)) {
            detected.push(lib.name);
        }
    });

    return detected;
}

function buildLIR(ast) {
    let lir = `# LOSSLESS INTERMEDIATE REPRESENTATION (LIR)\n`;
    lir += `**File:** ${ast.fileInfo.name}\n`;
    lir += `**Path:** ${ast.fileInfo.relativePath}\n`;
    lir += `**Size:** ${ast.fileInfo.size} bytes\n\n`;

    lir += `## 1. FILE & PROJECT INFO\n`;
    lir += ` * Framework: ${ast.projectInfo.framework}\n`;
    lir += ` * Template Engine: ${ast.projectInfo.templateEngine}\n`;
    lir += ` * Language: ${ast.projectInfo.language}\n`;
    lir += ` * File Type: ${ast.projectInfo.fileType}\n`;
    lir += ` * Frontend Target: ${ast.projectInfo.isFrontend}\n`;
    lir += ` * Backend Target: ${ast.projectInfo.isBackend}\n\n`;

    lir += `## 2. IMPORTS & DEPENDENCIES\n`;
    lir += ` * Dependencies: ${ast.dependencies.length > 0 ? ast.dependencies.join(', ') : 'None'}\n`;
    if (ast.imports.length > 0) {
        ast.imports.forEach(imp => {
            lir += ` * [${imp.type}] ${imp.module} ${imp.symbols ? '(' + imp.symbols + ')' : ''}\n`;
        });
    } else {
        lir += ` * Imports: None\n`;
    }
    lir += `\n`;

    lir += `## 3. METADATA\n`;
    lir += ` * Title: ${ast.metadata.title || 'None'}\n`;
    lir += ` * Charset: ${ast.metadata.charset || 'None'}\n`;
    lir += ` * Viewport: ${ast.metadata.viewport || 'None'}\n`;
    lir += ` * Favicons: ${ast.metadata.favicons.length > 0 ? ast.metadata.favicons.join(', ') : 'None'}\n\n`;

    lir += `## 4. CSS STRUCTURE\n`;
    lir += ` * CSS Variables: ${ast.css.variables.length > 0 ? ast.css.variables.join(', ') : 'None'}\n`;
    lir += ` * CSS Classes: ${ast.css.classes.length > 0 ? ast.css.classes.join(', ') : 'None'}\n`;
    lir += ` * CSS IDs: ${ast.css.ids.length > 0 ? ast.css.ids.join(', ') : 'None'}\n`;
    lir += ` * CSS Selectors Count: ${ast.css.selectors.length}\n`;
    lir += ` * Media Queries: ${ast.css.mediaQueries.length > 0 ? ast.css.mediaQueries.length + ' detected' : 'None'}\n`;
    lir += ` * Keyframes: ${ast.css.keyframes.length > 0 ? ast.css.keyframes.join(', ') : 'None'}\n\n`;

    lir += `## 5. DOM TREE STRUCTURE\n`;
    if (ast.domTree) {
        lir += renderDOMTreeString(ast.domTree, 0);
    } else {
        lir += ` DOM Tree: None\n`;
    }
    lir += `\n`;

    lir += `## 6. ATTRIBUTES & EVENTS\n`;
    lir += ` * Detected Attributes: ${Object.keys(ast.attributes).length > 0 ? Object.keys(ast.attributes).join(', ') : 'None'}\n`;
    if (ast.events.inlineEvents.length > 0 || ast.events.eventListeners.length > 0) {
        ast.events.inlineEvents.forEach(e => { lir += ` * [Inline Event] ${e.event} -> ${e.handler}\n`; });
        ast.events.eventListeners.forEach(e => { lir += ` * [EventListener] ${e.event} -> ${e.handler}\n`; });
    } else {
        lir += ` * Events: None\n`;
    }
    lir += `\n`;

    lir += `## 7. JAVASCRIPT & API ENDPOINTS\n`;
    lir += ` * Functions: ${ast.javascript.functions.length > 0 ? ast.javascript.functions.map(f => f.name).join(', ') : 'None'}\n`;
    lir += ` * Variables: ${ast.javascript.variables.length > 0 ? ast.javascript.variables.join(', ') : 'None'}\n`;
    lir += ` * Browser APIs: ${ast.javascript.browserAPIs.length > 0 ? ast.javascript.browserAPIs.join(', ') : 'None'}\n`;
    if (ast.endpoints.length > 0) {
        ast.endpoints.forEach(ep => { lir += ` * [Endpoint] ${ep.method} ${ep.url}\n`; });
    } else {
        lir += ` * API Endpoints: None\n`;
    }
    lir += `\n`;

    lir += `## 8. GO TEMPLATE EXPRESSIONS\n`;
    lir += ` * Conditions: ${ast.goTemplate.conditions.length > 0 ? ast.goTemplate.conditions.join(' | ') : 'None'}\n`;
    lir += ` * Loops: ${ast.goTemplate.loops.length > 0 ? ast.goTemplate.loops.join(' | ') : 'None'}\n`;
    lir += ` * Function Calls: ${ast.goTemplate.functionCalls.length > 0 ? ast.goTemplate.functionCalls.join(' | ') : 'None'}\n`;
    lir += ` * Variables: ${ast.goTemplate.variables.length > 0 ? ast.goTemplate.variables.join(' | ') : 'None'}\n`;
    lir += ` * Includes: ${ast.goTemplate.templateIncludes.length > 0 ? ast.goTemplate.templateIncludes.join(' | ') : 'None'}\n\n`;

    lir += `## 9. CONTROL FLOW & MEDIA\n`;
    lir += ` * Loop Keywords: ${ast.loops.length > 0 ? ast.loops.join(', ') : 'None'}\n`;
    lir += ` * Condition Keywords: ${ast.conditions.length > 0 ? ast.conditions.join(', ') : 'None'}\n`;
    lir += ` * Form Elements Count: ${ast.forms.length}\n`;
    lir += ` * Table Elements Count: ${ast.tables.length}\n`;
    lir += ` * Media Assets Count: ${ast.images.length}\n`;
    lir += ` * Script Blocks: ${ast.scripts.length}\n`;

    return lir;
}

function renderDOMTreeString(nodes, indentLevel) {
    let str = '';
    const indent = '  '.repeat(indentLevel);

    nodes.forEach(node => {
        if (node.type === 'element') {
            const attrKeys = Object.keys(node.attributes);
            const attrStr = attrKeys.length > 0 ? ` [${attrKeys.map(k => `${k}="${node.attributes[k]}"`).join(', ')}]` : '';
            str += `${indent}├─ <${node.tag}>${attrStr}\n`;
            if (node.children && node.children.length > 0) {
                str += renderDOMTreeString(node.children, indentLevel + 1);
            }
        } else if (node.type === 'text') {
            str += `${indent}│  "${node.value.substring(0, 40)}${node.value.length > 40 ? '...' : ''}"\n`;
        }
    });

    return str;
}

function renderOutput(output) {
    document.getElementById('outputArea').value = output;
}

function copyToClipboard() {
    const copyText = document.getElementById("outputArea");
    if (!copyText.value) return;

    copyText.select();
    copyText.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyText.value);

    const btn = document.getElementById('btnCopy');
    const originalText = btn.innerText;
    btn.innerText = '✅ COPIED!';
    btn.style.background = '#22c55e';
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = '#4f46e5';
    }, 1500);
}

function downloadAsTxt() {
    const outputText = document.getElementById("outputArea").value;
    if (!outputText) {
        alert("Tidak ada output untuk di-download. Silakan jalankan extract terlebih dahulu.");
        return;
    }

    const blob = new Blob([outputText], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "viber_engine_output.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
