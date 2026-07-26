/**
 * Frontend Semantic Enhancement Layer (frontend1.js)
 * Post-processor untuk memperkaya dan mengoreksi output dari frontend.js
 * Target Pipeline: LirEngineRegistry
 */
(function() {
    
    // Helper: Ekstraksi nilai dengan Regex aman
    function extractValue(output, pattern, fallback = "") {
        const match = output.match(pattern);
        return match ? match[1].trim() : fallback;
    }

    // Helper: Inferensi Target File dengan prioritas sesuai Functional Requirement
    function inferMigrationTarget(output) {
        // Prioritas 1: Gunakan TARGET FILE jika sudah spesifik
        let targetFile = extractValue(output, /TARGET FILE:\n(.*?)\n/);
        if (targetFile && targetFile.startsWith("app/") && targetFile !== "app//page.tsx") {
            return targetFile;
        }

        // Prioritas 2 & 3: Infer dari API Route atau Primary Route
        let apiRoute = extractValue(output, /API REQUIRED:\nGET \/api\/(.*?)\n/);
        let primaryRoute = extractValue(output, /Primary Route:\n(.*?)\n/); 
        let inferredRoute = apiRoute || primaryRoute;

        if (inferredRoute) {
            inferredRoute = inferredRoute.replace(/^\/+/, ''); // bersihkan slash di awal
            if (inferredRoute === "" || inferredRoute === "index") {
                return "app/page.tsx";
            }
            return `app/${inferredRoute}/page.tsx`;
        }

        // Prioritas 4: Fallback aman
        return "app/generated/page.tsx";
    }

    // Fungsi Utama: Memperkaya IR Output dari Frontend Parser
    function enhanceFrontendIR(output) {
        // Ambil Data Existing
        const sourceFile = extractValue(output, /SOURCE:\n(.*?)\n/, "unknown.html");
        const targetComponent = extractValue(output, /TARGET COMPONENT:\n(.*?)\n/, "UnknownComponent");
        const backendHandler = extractValue(output, /Handler:\n(.*?)\n/, "UnknownHandler");
        
        // Ambil Data Source Model (Array Collection)
        const dataInputMatch = output.match(/Input:\n([\s\S]*?)\n\nOutput:/);
        let dataSource = "Unknown Data";
        if (dataInputMatch) {
            const inputs = dataInputMatch[1].split('\n').map(s => s.replace(/^- /, '').trim()).filter(Boolean);
            const arrayInputs = inputs.filter(i => i.endsWith('[]'));
            dataSource = arrayInputs.length > 0 ? arrayInputs.join(', ') : (inputs[0] || dataSource);
        }

        const targetFile = inferMigrationTarget(output);
        const routeParam = targetFile.replace("app", "").replace("/page.tsx", "");
        const primaryRoute = routeParam === "" ? "/" : routeParam;

        // 1. Bikin Teks: MIGRATION FILE MAP
        const migrationFileMap = `MIGRATION FILE MAP
==================================================
SOURCE FILE:
${sourceFile}

CURRENT TYPE:
Go HTML Template

TARGET FRAMEWORK:
Next.js App Router

TARGET FILE:
${targetFile}

TARGET COMPONENT:
${targetComponent}

RELATED COMPONENTS:
- Sidebar
- UserInfo
- Table Component
- Layout Component
==================================================

`;

        // 5. Bikin Teks: SOURCE TRACE
        const sourceTrace = `SOURCE TRACE
==================================================
SOURCE FILE:
${sourceFile}

BACKEND HANDLER:
${backendHandler}

PRIMARY ROUTE:
${primaryRoute}

DATA SOURCE:
${dataSource}

IMPORTANT CONTEXT:
- UserRole
- UserName
- Table Data
- Permission Logic
==================================================

`;

        // 3. Bikin Teks: SEMANTIC MIGRATION CONTRACT
        const semanticContract = `SEMANTIC MIGRATION CONTRACT
==================================================
SOURCE BEHAVIOR:
- Server rendered Go template page

TARGET BEHAVIOR:
- Next.js App Router Server Component

PRESERVE:
- Data shape
- Rendering order
- Authorization logic
- User interaction behavior

CONVERT:
- Go template syntax → JSX expression
- range loop → Array.map()
- if condition → conditional rendering
- href navigation → Next.js routing
==================================================

`;

        let enhancedOutput = output;

        // INJECT (1) & (5): MIGRATION FILE MAP & SOURCE TRACE (setelah MIGRATION TARGET)
        if (!enhancedOutput.includes("MIGRATION FILE MAP")) {
            const splitIndex = enhancedOutput.indexOf("MIGRATION PRESERVATION\n");
            if (splitIndex !== -1) {
                const before = enhancedOutput.substring(0, splitIndex);
                const after = enhancedOutput.substring(splitIndex);
                enhancedOutput = before + migrationFileMap + sourceTrace + after;
            }
        }

        // INJECT (2): PERBAIKI MIGRATION PRESERVATION (Update KEEP List)
        const keepRegex = /KEEP:\n[\s\S]*?(?=CONVERT:)/;
        const enhancedKeep = `KEEP:
✓ Existing page structure
✓ Existing backend data contract
✓ Existing template variables
✓ Existing table iteration logic
✓ Existing conditional rendering
✓ Existing permission rules
✓ Existing routes
✓ Existing user role behavior
✓ Existing UI interaction
✓ Existing business flow

`;
        if (keepRegex.test(enhancedOutput)) {
            enhancedOutput = enhancedOutput.replace(keepRegex, enhancedKeep);
        }

        // INJECT (3): SEMANTIC MIGRATION CONTRACT (setelah MIGRATION PRESERVATION block)
        if (!enhancedOutput.includes("SEMANTIC MIGRATION CONTRACT")) {
            const presEndRegex = /(MIGRATION PRESERVATION\n==================================================[\s\S]*?==================================================\n\n)/;
            if (presEndRegex.test(enhancedOutput)) {
                enhancedOutput = enhancedOutput.replace(presEndRegex, `$1${semanticContract}`);
            }
        }

        return enhancedOutput;
    }

    // 7. Mekanisme Registrasi Stage yang Aman (Monkey Patching Tanpa Recursive Loop)
    function registerEnhancementLayer() {
        if (typeof window !== 'undefined' && window.LirEngineRegistry) {
            const registry = window.LirEngineRegistry;

            // Cari original frontend function untuk di-wrap
            if (registry.stages && Array.isArray(registry.stages['frontend']) && registry.stages['frontend'].length > 0) {
                const originalFrontendStage = registry.stages['frontend'][0];

                // Override index 0 dengan wrapper function
                registry.stages['frontend'][0] = async function(context) {
                    // Jalankan original frontend mentah tanpa mengubah aslinya
                    const result = await originalFrontendStage(context);
                    let finalOutput = result.finalOutput || '';

                    // Split output jika multiple files untuk diproses masing-masing block
                    const irBlocks = finalOutput.split('=========================================\n\n');
                    const enhancedBlocks = irBlocks.map(block => {
                        if (!block.trim()) return block;
                        return enhanceFrontendIR(block);
                    });

                    // Return string yang sudah diperbaiki / diperkaya
                    return {
                        ...result,
                        finalOutput: enhancedBlocks.join('=========================================\n\n')
                    };
                };
                console.log("[LIR Engine] Semantic Enhancement (frontend1.js) successfully wrapped frontend stage.");
            } else {
                console.warn("[LIR Engine] Original 'frontend' stage not found. Make sure frontend.js is loaded before frontend1.js.");
            }
        }
    }

    // Jalankan injeksi saat file dimuat
    registerEnhancementLayer();

})();
