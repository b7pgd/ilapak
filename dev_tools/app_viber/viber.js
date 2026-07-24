let projectFiles = {};
let selectedFileKeys = [];

document.getElementById('folderPicker').addEventListener('change', function(e) {
    const files = e.target.files;
    if (files.length === 0) return;

    projectFiles = {};
    selectedFileKeys = [];
    updateActionButtons();
    const fileListUI = document.getElementById('fileList');
    fileListUI.innerHTML = '';

    let counted = 0;
    
    // Daftar ekstensi anomali / biner yang wajib diabaikan
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

        // Validasi apakah file bukan termasuk anomali biner
        const isAnomaly = blacklistedExtensions.some(ext => lowerFileName.endsWith(ext));

        if (!isAnomaly) {
            projectFiles[path] = file;

            const li = document.createElement('li');
            
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = path;
            chk.onclick = function(e) { e.stopPropagation(); toggleFileSelect(this.checked, path); };

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
});

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
    document.getElementById('btnExtractSemantic').disabled = !hasSelection;
    document.getElementById('btnExtractExact').disabled = !hasSelection;
}

function extractSkeleton() {
    if (selectedFileKeys.length === 0) return;

    let finalOutputArray = [];
    let processedCount = 0;

    selectedFileKeys.forEach(fileKey => {
        const file = projectFiles[fileKey];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const rawCode = e.target.result;
            const lines = rawCode.split('\n');
            let finalResultArray = [];
            finalResultArray.push("Target File: /" + fileKey);

            // --- FLOW BACKEND PARSER (GO) ---
            if (file.name.endsWith('.go')) {
                let inImport = false;
                let braceCount = 0;
                let inFunction = false;
                let funcStartLine = 0;
                let funcSignature = "";

                for (let i = 0; i < lines.length; i++) {
                    let lineNum = i + 1;
                    let line = lines[i];
                    let trimmed = line.trim();

                    if (trimmed.startsWith('package ')) {
                        finalResultArray.push("// Baris " + lineNum + "\n" + line);
                        continue;
                    }
                    if (trimmed.startsWith('import (')) {
                        inImport = true;
                        finalResultArray.push("\n// Baris " + lineNum + "\n" + line);
                        continue;
                    }
                    if (inImport) {
                        finalResultArray.push(line);
                        if (trimmed === ')') {
                            inImport = false;
                            finalResultArray.push("// ... structural details hidden ...");
                        }
                        continue;
                    }

                    if (trimmed.startsWith('func ') && !inFunction) {
                        inFunction = true;
                        funcStartLine = lineNum;
                        funcSignature = line;

                        braceCount += (line.match(/\u007B/g) || []).length;
                        braceCount -= (line.match(/\u007D/g) || []).length;

                        if (braceCount === 0 && line.includes('\u007B')) {
                            let cleanSignature = funcSignature.trim().replace(/\s*\{$/, "");
                            finalResultArray.push("// Baris " + funcStartLine + "\n" + cleanSignature + " \u007B\n\t// ... body hidden ...\n\u007D");
                            inFunction = false;
                        }
                        continue;
                    }

                    if (inFunction) {
                        braceCount += (line.match(/\u007B/g) || []).length;
                        braceCount -= (line.match(/\u007D/g) || []).length;

                        if (braceCount === 0) {
                            let cleanSignature = funcSignature.trim().replace(/\s*\{$/, "");
                            finalResultArray.push("// Baris " + funcStartLine + "-" + lineNum + "\n" + cleanSignature + " \u007B\n\t// ... body hidden ...\n\u007D");
                            inFunction = false;
                        }
                    }
                }
                finalOutputArray.push(finalResultArray.join('\n'));
            }

            // --- FLOW FRONTEND PARSER (HTML / SMART SKELETON v2) ---
            else if (file.name.endsWith('.html')) {
                let inBlock = null;
                let blockStartLine = 0;

                for (let i = 0; i < lines.length; i++) {
                    let lineNum = i + 1;
                    let line = lines[i];
                    let trimmed = line.trim();

                    if (trimmed.startsWith('\u003Cstyle\u003E') || trimmed.startsWith('\u003Cstyle ')) {
                        inBlock = 'style';
                        blockStartLine = lineNum;
                        finalResultArray.push("// Baris " + lineNum + ": \u003Cstyle\u003E (Mulai Blok CSS)");
                        continue;
                    }
                    if (trimmed.startsWith('\u003Cscript\u003E') || trimmed.startsWith('\u003Cscript ')) {
                        inBlock = 'script';
                        blockStartLine = lineNum;
                        finalResultArray.push("// Baris " + lineNum + ": \u003Cscript\u003E (Mulai Blok JS)");
                        continue;
                    }

                    if (inBlock === 'style' && trimmed.startsWith('\u003C/style\u003E')) {
                        finalResultArray.push("// Baris " + blockStartLine + "-" + lineNum + " [CSS SKELETON GENERATED]");
                        finalResultArray.push("// Baris " + lineNum + ": \u003C/style\u003E");
                        inBlock = null;
                        continue;
                    }
                    if (inBlock === 'script' && trimmed.startsWith('\u003C/script\u003E')) {
                        finalResultArray.push("// Baris " + blockStartLine + "-" + lineNum + " [JS SCRIPT SKELETON GENERATED]");
                        finalResultArray.push("// Baris " + lineNum + ": \u003C/script\u003E");
                        inBlock = null;
                        continue;
                    }

                    if (inBlock === 'style') {
                        if (trimmed.includes('\u007B')) {
                            let selector = trimmed.split('\u007B')[0].trim();
                            finalResultArray.push("  // Baris " + lineNum + ": " + selector + " \u007B ... properti kosmetik disembunyikan ... \u007D");
                        }
                        continue;
                    }

                    if (inBlock === 'script') {
                        let arrowStr = '\u003D\u003E';
                        if (trimmed.startsWith('function ') || trimmed.includes('.addEventListener(') || trimmed.includes(' \u003D function(') || (trimmed.startsWith('let ') && trimmed.includes(arrowStr)) || (trimmed.startsWith('const ') && trimmed.includes(arrowStr))) {
                            finalResultArray.push("  // Baris " + lineNum + ": " + trimmed + " \u003D\u003E [Isi logika disembunyikan]");
                        }
                        continue;
                    }

                    if (!inBlock) {
                        finalResultArray.push("// Baris " + lineNum + ": " + line);
                    }
                }
                finalOutputArray.push(finalResultArray.join('\n'));
            }

            // --- FLOW SEPARATED JS / CSS FILE TRACING ---
            else if (file.name.endsWith('.js')) {
                for (let i = 0; i < lines.length; i++) {
                    let lineNum = i + 1;
                    let line = lines[i];
                    let trimmed = line.trim();
                    let arrowStr = '\u003D\u003E';
                    if (trimmed.startsWith('function ') || trimmed.includes('.addEventListener(') || trimmed.includes(' \u003D function(') || (trimmed.startsWith('let ') && trimmed.includes(arrowStr)) || (trimmed.startsWith('const ') && trimmed.includes(arrowStr))) {
                        finalResultArray.push("// Baris " + lineNum + ": " + trimmed + " \u003D\u003E [Isi logika disembunyikan]");
                    }
                }
                finalOutputArray.push(finalResultArray.join('\n'));
            }

            else if (file.name.endsWith('.css')) {
                for (let i = 0; i < lines.length; i++) {
                    let lineNum = i + 1;
                    let line = lines[i];
                    let trimmed = line.trim();
                    if (trimmed.includes('\u007B')) {
                        let selector = trimmed.split('\u007B')[0].trim();
                        finalResultArray.push("// Baris " + lineNum + ": " + selector + " \u007B ... properti kosmetik disembunyikan ... \u007D");
                    }
                }
                finalOutputArray.push(finalResultArray.join('\n'));
            }

            // --- FLOW BACKUP (PHP, JSON, ENV, PY, XML, UI, DLL) ---
            else {
                finalResultArray.push("// Baris 1-" + lines.length);
                finalResultArray.push(rawCode);
                finalOutputArray.push(finalResultArray.join('\n'));
            }

            processedCount++;
            if (processedCount === selectedFileKeys.length) {
                document.getElementById('outputArea').value = finalOutputArray.join('\n\n=========================================\n\n');
            }
        };
        reader.readAsText(file);
    });
}

function extractSemanticSkeleton() {
    if (selectedFileKeys.length === 0) return;

    let finalOutputArray = [];
    let processedCount = 0;

    selectedFileKeys.forEach(fileKey => {
        const file = projectFiles[fileKey];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const rawCode = e.target.result;
            const lines = rawCode.split('\n');
            let out = [];

            // Helper to get line bounds for JS/Go functions
            function getScopeEnd(startIdx) {
                let braceCount = 0;
                let started = false;
                for (let j = startIdx; j < lines.length; j++) {
                    let openCount = (lines[j].match(/\{/g) || []).length;
                    let closeCount = (lines[j].match(/\}/g) || []).length;
                    if (openCount > 0) started = true;
                    braceCount += openCount - closeCount;
                    if (started && braceCount <= 0) return j;
                }
                return lines.length - 1;
            }

            let lowerPath = fileKey.toLowerCase();
            let fileName = file.name.toLowerCase();

            out.push("==================================================");
            out.push("FILE:");
            out.push(`/${fileKey}`);
            out.push("");

            // --- PURPOSE ---
            let purpose = "General Module / Utility Component";
            if (lowerPath.includes('auth') || lowerPath.includes('login')) purpose = "Authentication & User Session Management";
            else if (lowerPath.includes('controller')) purpose = "Request Handler & Business Logic Controller";
            else if (lowerPath.includes('route') || lowerPath.includes('router')) purpose = "API Routing & Endpoint Mapping";
            else if (lowerPath.includes('model') || lowerPath.includes('struct') || lowerPath.includes('entity')) purpose = "Data Schema / State Entity Definition";
            else if (lowerPath.includes('service')) purpose = "Core Business Logic & External Integration Service";
            else if (lowerPath.includes('util') || lowerPath.includes('helper')) purpose = "Shared Helper Utilities";
            else if (fileName.endsWith('.html')) purpose = "UI Template & View Presentation Structure";
            else if (fileName.endsWith('.css')) purpose = "Styling & Visual Design Rules";
            else if (fileName.endsWith('.json') || fileName.endsWith('.yaml') || fileName.endsWith('.yml') || fileName.endsWith('.env')) purpose = "Application Configuration / Environment Settings";

            out.push("PURPOSE:");
            out.push(purpose);
            out.push("");

            // --- ROLE ---
            let role = "Utility";
            if (fileName.endsWith('.html') || fileName.endsWith('.css')) role = "UI Component";
            else if (lowerPath.includes('controller') || lowerPath.includes('handler')) role = "Backend Controller";
            else if (lowerPath.includes('model') || lowerPath.includes('entity') || lowerPath.includes('struct')) role = "Database Model";
            else if (lowerPath.includes('service') || lowerPath.includes('api')) role = "API Service";
            else if (fileName.endsWith('.json') || fileName.endsWith('.env') || fileName.endsWith('.yaml') || fileName.endsWith('.yml')) role = "Configuration";
            else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.svg')) role = "Static Asset";

            out.push("ROLE:");
            out.push(role);
            out.push("");

            // --- DEPENDENCY ---
            let dependencies = [];
            lines.forEach(line => {
                let trimmed = line.trim();
                if (trimmed.startsWith('import ') || trimmed.startsWith('import(') || trimmed.includes('require(') || trimmed.includes('<script src=') || trimmed.includes('<link rel=')) {
                    dependencies.push(trimmed);
                }
            });
            out.push("DEPENDENCY:");
            if (dependencies.length > 0) {
                dependencies.forEach(d => out.push(`- ${d}`));
            } else {
                out.push("- None");
            }
            out.push("");

            // --- PARSERS BY LANGUAGE ---
            if (fileName.endsWith('.js') || fileName.endsWith('.html')) {
                let exportsList = [];
                let functionSignatures = [];
                let triggerMap = [];
                let dataFlows = [];
                let stateVariables = [];
                let apiContracts = [];
                let callGraph = [];
                let errorFlows = [];
                let migrationAnchors = [];

                let localFunctions = new Set();
                for (let i = 0; i < lines.length; i++) {
                    let trimmed = lines[i].trim();
                    if (trimmed.startsWith('function ') || (trimmed.includes('const ') && trimmed.includes('=>')) || (trimmed.includes('let ') && trimmed.includes('=>')) || trimmed.startsWith('export function ') || trimmed.startsWith('export const ')) {
                        let fnName = "";
                        if (trimmed.includes('function ')) {
                            fnName = trimmed.split('(')[0].replace('export ', '').replace('function ', '').trim();
                        } else {
                            fnName = trimmed.split('=')[0].replace('export ', '').replace('const ', '').replace('let ', '').trim();
                        }
                        if (fnName) localFunctions.add(fnName);
                    }
                }

                lines.forEach((line, idx) => {
                    let trimmed = line.trim();
                    let lineNum = idx + 1;

                    // State / Variables
                    if (trimmed.startsWith('let ') || trimmed.startsWith('var ') || trimmed.startsWith('const ')) {
                        let varName = trimmed.split(' ')[1] ? trimmed.split(' ')[1].split('=')[0].replace(';', '').trim() : '';
                        if (varName && !varName.includes('(')) {
                            stateVariables.push(`NAME: ${varName}\nCREATED: Line ${lineNum}\nMODIFIED BY: Inline execution / Handlers\nCONSUMED BY: Function Scope`);
                        }
                    }

                    // Triggers
                    if (line.includes('addEventListener(') || line.includes('onclick=') || line.includes('onchange=')) {
                        triggerMap.push(`TRIGGER: Event Listener / Inline Event\nTARGET: DOM Element (Line ${lineNum})\nHANDLER: Event Callback\nSIDE EFFECT: State mutation / UI update`);
                    }

                    // Migration Anchors
                    if (trimmed.includes('fetch') || trimmed.includes('axios') || trimmed.includes('XMLHttpRequest')) {
                        migrationAnchors.push(`SOURCE: ${fileKey}:${lineNum}\nCATEGORY: API / NETWORK`);
                    } else if (trimmed.includes('localStorage') || trimmed.includes('sessionStorage')) {
                        migrationAnchors.push(`SOURCE: ${fileKey}:${lineNum}\nCATEGORY: STORAGE / STATE`);
                    } else if (trimmed.includes('catch') || trimmed.includes('try {')) {
                        migrationAnchors.push(`SOURCE: ${fileKey}:${lineNum}\nCATEGORY: ERROR HANDLING`);
                    }
                });

                // Function Extraction Pass
                for (let i = 0; i < lines.length; i++) {
                    let trimmed = lines[i].trim();
                    if (trimmed.startsWith('function ') || (trimmed.includes('const ') && trimmed.includes('=>')) || (trimmed.includes('let ') && trimmed.includes('=>')) || trimmed.startsWith('export function ') || trimmed.startsWith('export const ')) {
                        let fnName = "";
                        if (trimmed.includes('function ')) {
                            fnName = trimmed.split('(')[0].replace('export ', '').replace('function ', '').trim();
                        } else {
                            fnName = trimmed.split('=')[0].replace('export ', '').replace('const ', '').replace('let ', '').trim();
                        }

                        if (!fnName) continue;
                        exportsList.push(fnName);

                        let endIdx = getScopeEnd(i);
                        let bodyLines = lines.slice(i, endIdx + 1);
                        let bodyText = bodyLines.join('\n');

                        // Inputs / Outputs
                        let paramsMatch = trimmed.match(/\(([^)]*)\)/);
                        let inputs = paramsMatch ? paramsMatch[1].trim() : 'None';
                        let hasReturn = bodyText.includes('return');

                        // Calls
                        let internalCalls = [];
                        let callMatches = bodyText.matchAll(/([a-zA-Z0-9_]+)\s*\(/g);
                        for (let cm of callMatches) {
                            let fn = cm[1];
                            if (fn !== fnName && localFunctions.has(fn)) {
                                if (!internalCalls.includes(fn)) internalCalls.push(fn);
                            }
                        }

                        functionSignatures.push(`NAME: ${fnName}\nLOCATION: Line ${i + 1}-${endIdx + 1}\nINPUT: ${inputs || 'None'}\nOUTPUT: ${hasReturn ? 'Value / Promise' : 'void'}\nCALLS: ${internalCalls.length > 0 ? internalCalls.join(', ') : 'None'}\nCALLED BY: External / Event Trigger`);

                        if (internalCalls.length > 0) {
                            callGraph.push(`${fnName}\n |\n +--> ${internalCalls.join('\n |\n +--> ')}`);
                        }

                        // API Contracts
                        if (bodyText.includes('fetch(') || bodyText.includes('axios')) {
                            let reqMatch = bodyText.match(/(?:fetch|axios|\$.ajax)\s*\(\s*[`'"]([^`'"]+)[`'"]/);
                            let methodMatch = bodyText.match(/method\s*:\s*['"]([A-Z]+)['"]/i);
                            apiContracts.push(`METHOD: ${methodMatch ? methodMatch[1].toUpperCase() : 'GET'}\nENDPOINT: ${reqMatch ? reqMatch[1] : 'Dynamic URL'}\nREQUEST BODY: JSON / FormData\nPARAMETERS: Function Parameters\nRESPONSE USED: JSON Promises\nFIELDS CONSUMED: DOM Updates / Internal State`);
                        }

                        // Error Flow
                        if (bodyText.includes('try') || bodyText.includes('catch')) {
                            errorFlows.push(`ERROR SOURCE: Function ${fnName}()\nHANDLER: try/catch block\nUSER EFFECT: Console alert / UI state retention`);
                        }
                    }
                }

                out.push("PUBLIC API / EXPORT:");
                out.push(exportsList.length > 0 ? exportsList.map(e => `- ${e}`).join('\n') : "- None");
                out.push("");

                out.push("FUNCTION SIGNATURE:");
                out.push(functionSignatures.length > 0 ? functionSignatures.join('\n\n') : "None");
                out.push("");

                out.push("TRIGGER MAP:");
                out.push(triggerMap.length > 0 ? triggerMap.join('\n\n') : "None");
                out.push("");

                out.push("DATA FLOW:");
                out.push(dataFlows.length > 0 ? dataFlows.join('\n\n') : "INPUT: User Input / DOM Events\nTRANSFORMATION: Pure JS Transformation / Validation\nOUTPUT: DOM Rendering / Local State");
                out.push("");

                out.push("STATE MODEL:");
                out.push(stateVariables.length > 0 ? stateVariables.join('\n\n') : "Stateless / Transient DOM State");
                if (rawCode.includes('localStorage')) out.push("STORAGE: localStorage active");
                if (rawCode.includes('sessionStorage')) out.push("STORAGE: sessionStorage active");
                out.push("");

                out.push("API CONTRACT:");
                out.push(apiContracts.length > 0 ? apiContracts.join('\n\n') : "None");
                out.push("");

                out.push("CALL GRAPH:");
                out.push(callGraph.length > 0 ? callGraph.join('\n\n') : "None");
                out.push("");

                out.push("ERROR FLOW:");
                out.push(errorFlows.length > 0 ? errorFlows.join('\n\n') : "None");
                out.push("");

                out.push("MODEL / DATABASE MAP:");
                out.push("None");
                out.push("");

                out.push("MIGRATION ANCHOR:");
                out.push(migrationAnchors.length > 0 ? migrationAnchors.join('\n\n') : `SOURCE: ${fileKey}:1\nCATEGORY: UI_LOGIC`);

            } else if (fileName.endsWith('.go')) {
                let exportsList = [];
                let functionSignatures = [];
                let structs = [];
                let apiContracts = [];
                let callGraph = [];
                let migrationAnchors = [];

                let localFunctions = new Set();
                lines.forEach(line => {
                    let trimmed = line.trim();
                    if (trimmed.startsWith('func ')) {
                        let sig = trimmed.split('{')[0].replace('func ', '').trim();
                        let nameMatch = sig.match(/([a-zA-Z0-9_]+)\s*\(/);
                        if (nameMatch) localFunctions.add(nameMatch[1]);
                    }
                });

                let currentStruct = null;
                let structFields = [];

                for (let i = 0; i < lines.length; i++) {
                    let trimmed = lines[i].trim();
                    let lineNum = i + 1;

                    // Structs / Models
                    if (trimmed.startsWith('type ') && trimmed.includes('struct {')) {
                        currentStruct = trimmed.split(' ')[1];
                        structFields = [];
                        continue;
                    }
                    if (currentStruct) {
                        if (trimmed === '}') {
                            structs.push(`ENTITY: ${currentStruct}\nFIELDS: ${structFields.join(', ')}\nRELATION: Direct Structure\nDATABASE OPERATION: CREATE, READ, UPDATE, DELETE`);
                            currentStruct = null;
                        } else if (trimmed && !trimmed.startsWith('//')) {
                            structFields.push(trimmed.split(/\s+/)[0]);
                        }
                    }

                    // Routes
                    if (trimmed.includes('.GET(') || trimmed.includes('.POST(') || trimmed.includes('.PUT(') || trimmed.includes('.DELETE(')) {
                        let epMatch = trimmed.match(/\.(GET|POST|PUT|DELETE)\s*\(\s*["']([^"']+)["']/);
                        if (epMatch) {
                            apiContracts.push(`METHOD: ${epMatch[1]}\nENDPOINT: ${epMatch[2]}\nREQUEST BODY: Struct Binding\nPARAMETERS: URL Params / Query\nRESPONSE USED: JSON Response\nFIELDS CONSUMED: API Payload`);
                        }
                    }

                    // Functions
                    if (trimmed.startsWith('func ')) {
                        let sig = trimmed.split('{')[0].replace('func ', '').trim();
                        let nameMatch = sig.match(/([a-zA-Z0-9_]+)\s*\(/);
                        let fnName = nameMatch ? nameMatch[1] : "";

                        if (fnName) {
                            exportsList.push(sig);
                            let endIdx = getScopeEnd(i);
                            let bodyText = lines.slice(i, endIdx + 1).join('\n');

                            let internalCalls = [];
                            let callMatches = bodyText.matchAll(/([a-zA-Z0-9_]+)\s*\(/g);
                            for (let cm of callMatches) {
                                let fn = cm[1];
                                if (fn !== fnName && localFunctions.has(fn)) {
                                    if (!internalCalls.includes(fn)) internalCalls.push(fn);
                                }
                            }

                            functionSignatures.push(`NAME: ${fnName}\nLOCATION: Line ${lineNum}-${endIdx + 1}\nINPUT: ${sig.includes('(') ? sig.split('(')[1].split(')')[0] : 'None'}\nOUTPUT: ${sig.includes(')') ? sig.split(')')[1] : 'void'}\nCALLS: ${internalCalls.length > 0 ? internalCalls.join(', ') : 'None'}\nCALLED BY: Router / Package Caller`);

                            if (internalCalls.length > 0) {
                                callGraph.push(`${fnName}\n |\n +--> ${internalCalls.join('\n |\n +--> ')}`);
                            }

                            migrationAnchors.push(`SOURCE: ${fileKey}:${lineNum}\nCATEGORY: BACKEND_LOGIC`);
                        }
                    }
                }

                out.push("PUBLIC API / EXPORT:");
                out.push(exportsList.length > 0 ? exportsList.map(e => `- ${e}`).join('\n') : "- None");
                out.push("");

                out.push("FUNCTION SIGNATURE:");
                out.push(functionSignatures.length > 0 ? functionSignatures.join('\n\n') : "None");
                out.push("");

                out.push("TRIGGER MAP:");
                out.push("TRIGGER: HTTP Request / Internal Event\nTARGET: Route Handler\nHANDLER: Controller Executable\nSIDE EFFECT: DB Query / Network I/O");
                out.push("");

                out.push("DATA FLOW:");
                out.push("INPUT: HTTP Request Payload / Context\nTRANSFORMATION: Business Logic / Struct Validation\nOUTPUT: Database Write / HTTP Response");
                out.push("");

                out.push("STATE MODEL:");
                out.push("Stateless HTTP Service / Server Memory");
                out.push("");

                out.push("API CONTRACT:");
                out.push(apiContracts.length > 0 ? apiContracts.join('\n\n') : "None direct routing mapped");
                out.push("");

                out.push("CALL GRAPH:");
                out.push(callGraph.length > 0 ? callGraph.join('\n\n') : "None");
                out.push("");

                out.push("ERROR FLOW:");
                out.push("ERROR SOURCE: Go error return pattern\nHANDLER: if err != nil\nUSER EFFECT: HTTP 4xx/5xx status response");
                out.push("");

                out.push("MODEL / DATABASE MAP:");
                out.push(structs.length > 0 ? structs.join('\n\n') : "None");
                out.push("");

                out.push("MIGRATION ANCHOR:");
                out.push(migrationAnchors.length > 0 ? migrationAnchors.join('\n\n') : `SOURCE: ${fileKey}:1\nCATEGORY: BACKEND_SERVICE`);

            } else {
                // FALLBACK FOR JSON, ENV, YAML, UNKNOWN
                out.push("PUBLIC API / EXPORT:");
                out.push("- Static Asset / Configuration Object");
                out.push("");
                out.push("FUNCTION SIGNATURE:\nNone\n");
                out.push("TRIGGER MAP:\nNone\n");
                out.push("DATA FLOW:\nINPUT: Environment Variables / Config Files\nTRANSFORMATION: Parsing\nOUTPUT: Runtime Configuration Settings\n");
                out.push("STATE MODEL:\nStatic Configuration State\n");
                out.push("API CONTRACT:\nNone\n");
                out.push("CALL GRAPH:\nNone\n");
                out.push("ERROR FLOW:\nNone\n");
                out.push("MODEL / DATABASE MAP:\nNone\n");
                out.push("MIGRATION ANCHOR:");
                out.push(`SOURCE: ${fileKey}:1\nCATEGORY: CONFIGURATION`);
            }

            out.push("==================================================");

            // --- INTEGRATION WITH VIBER2, VIBER3, VIBER4 PIPELINE ---
            if (typeof buildKnowledgeGraph === 'function') {
                buildKnowledgeGraph(fileKey, rawCode, out);
            }
            if (typeof analyzeRoutes === 'function') {
                analyzeRoutes(fileKey, lines, out);
            }
            if (typeof mergeEdges === 'function') {
                mergeEdges(fileKey, out);
            }
            if (typeof rankEvidence === 'function') {
                rankEvidence(fileKey, out);
            }

            finalOutputArray.push(out.join('\n'));

            processedCount++;
            if (processedCount === selectedFileKeys.length) {
                document.getElementById('outputArea').value = finalOutputArray.join('\n\n');
            }
        };
        reader.readAsText(file);
    });
}

function extractExactFull() {
    if (selectedFileKeys.length === 0) return;

    let finalOutputArray = [];
    let processedCount = 0;

    selectedFileKeys.forEach(fileKey => {
        const file = projectFiles[fileKey];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const rawCode = e.target.result;
            let fileResult = `// Target File: /${fileKey}\n// =========================================\n${rawCode}`;
            finalOutputArray.push(fileResult);

            processedCount++;
            if (processedCount === selectedFileKeys.length) {
                document.getElementById('outputArea').value = finalOutputArray.join('\n\n\n');
            }
        };
        reader.readAsText(file);
    });
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
