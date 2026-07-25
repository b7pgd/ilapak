/**
 * Backend Semantic Extraction Engine - Modular Pipeline Stage
 * Target Directory: /backend/
 * File: viber.js
 */
(function () {
  // Helper: Clean raw text from extra spaces and quotes
  function cleanText(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  // Helper: Infer business module name from function name
  function inferBusinessModule(functionName) {
    const name = functionName.toLowerCase();

    if (name.includes('login') || name.includes('auth'))
      return 'Authentication';

    if (name.includes('label'))
      return 'Label Management';

    if (name.includes('category') || name.includes('kategori'))
      return 'Category Management';

    if (name.includes('audit') || name.includes('activity'))
      return 'Audit Logging';

    if (name.includes('verify'))
      return 'API Verification';

    const fallback = functionName.replace(/(Get|Create|Update|Delete|Show|List|Handler|Service|Handle)/g, '').trim();
    return fallback ? `${fallback} Service` : 'Core Service';
  }

  // Helper: Extract nested block contents considering balanced braces
  function extractBalancedBlock(text, startPos) {
    let depth = 0;
    let started = false;
    let endPos = -1;

    for (let i = startPos; i < text.length; i++) {
      if (text[i] === '{') {
        depth++;
        started = true;
      } else if (text[i] === '}') {
        depth--;
        if (started && depth === 0) {
          endPos = i;
          break;
        }
      }
    }
    return endPos !== -1 ? text.substring(startPos, endPos + 1) : null;
  }

  // Stage 1 & 2: Extract Structs, Fields, and Relationships
  function extractStructs(content) {
    const structs = [];
    const structRegex = /type\s+([a-zA-Z0-9_]+)\s+struct\s*\{/g;
    let match;

    while ((match = structRegex.exec(content)) !== null) {
      const structName = match[1];
      const blockStart = match.index + match[0].length - 1;
      const fullBlock = extractBalancedBlock(content, blockStart);

      if (fullBlock) {
        const fields = [];
        const relationships = [];
        let isDbEntity = false;
        const lines = fullBlock.slice(1, -1).split('\n');

        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

          // Check embedded gorm / relationships or struct fields
          const fieldMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([^\s`]+)(?:\s+`([^`]+)`)?/);
          if (fieldMatch) {
            const fieldName = fieldMatch[1];
            const fieldType = fieldMatch[2];
            const tags = fieldMatch[3] || '';

            if (tags.includes('gorm:') || tags.includes('primaryKey') || fieldName === 'gorm.Model' || fieldName === 'ID') {
              isDbEntity = true;
            }

            // Skip unexported lower case private properties if not relevant, but capture primary entities
            if (fieldName !== 'gorm.Model') {
              fields.push({ name: fieldName, type: fieldType });
            }

            // Relationship heuristics
            if (tags.includes('foreignKey') || tags.includes('many2many') || tags.includes('belongsTo')) {
              relationships.push(`${structName} -> ${fieldType} (${tags.includes('many2many') ? 'many-to-many' : 'association'})`);
              isDbEntity = true;
            } else if (fieldType.startsWith('[]') && /^[A-Z]/.test(fieldType.slice(2))) {
              relationships.push(`${structName} has many ${fieldType.slice(2)}`);
              isDbEntity = true;
            } else if (/^[A-Z]/.test(fieldType) && !['String', 'Time', 'Int', 'Int64', 'Float64', 'Bool', 'Uint'].includes(fieldType)) {
              relationships.push(`${structName} belongs to ${fieldType}`);
              isDbEntity = true;
            }
          }
        });

        structs.push({ name: structName, fields, relationships, isDbEntity });
        structRegex.lastIndex = blockStart + fullBlock.length;
      }
    }
    return structs;
  }

  // Detect Framework
  function detectFramework(content, imports) {
    if (imports.some(i => i.includes('labstack/echo'))) return 'Echo';
    if (imports.some(i => i.includes('gin-gonic/gin'))) return 'Gin';
    if (imports.some(i => i.includes('gofiber/fiber'))) return 'Fiber';
    if (imports.some(i => i.includes('net/http'))) return 'net/http';
    if (/e\.(GET|POST|PUT|DELETE|PATCH)\s*\(/.test(content)) return 'Echo';
    if (/r\.(GET|POST|PUT|DELETE|PATCH)\s*\(|router\.(GET|POST)/.test(content)) return 'Gin';
    return 'Unknown';
  }

  // Stage 1 & 2: Extract Routes
  function extractRoutes(content) {
    const routes = [];
    const routeRegex = /(?:e|r|router|app|group|g|api|v1)\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*["']([^"']+)["']\s*,\s*(.*?)\)/gi;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      const rest = match[3].split(',').map(s => s.trim());
      const handler = rest[rest.length - 1];
      const middleware = rest.slice(0, rest.length - 1);

      routes.push({
        method,
        path,
        handler: handler.replace(/^[a-zA-Z0-9_]+\./, ''),
        middleware: middleware.length > 0 ? middleware.join(', ') : null
      });
    }

    // net/http HandleFunc support
    const httpRegex = /http\.HandleFunc\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z0-9_.]+)\)/g;
    while ((match = httpRegex.exec(content)) !== null) {
      routes.push({
        method: 'ALL',
        path: match[1],
        handler: match[2].replace(/^[a-zA-Z0-9_]+\./, ''),
        middleware: null
      });
    }

    return routes;
  }

  // Extract Database Operations inside function body
  function extractDatabaseOperations(body) {
    const dbOps = [];

    const normalizeEntity = (raw) => {
      if (!raw) return 'Unknown';
      const clean = raw.replace(/^&/, '');
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    };

    if (/db\.(?:Where\(.*?\)\.)?Find\s*\(\s*&?([a-zA-Z0-9_]+)/i.test(body) || /SELECT\s+.*?\s+FROM/i.test(body)) {
      const entityMatch = body.match(/db\.(?:Where\(.*?\)\.)?Find\s*\(\s*&?([a-zA-Z0-9_]+)/i) || body.match(/FROM\s+([a-zA-Z0-9_]+)/i);
      const whereMatch = body.match(/Where\s*\(\s*["']([^"']+)["']/i);
      const orderMatch = body.match(/Order\s*\(\s*["']([^"']+)["']/i);
      
      dbOps.push({
        type: 'READ',
        entity: normalizeEntity(entityMatch ? entityMatch[1] : null),
        filter: whereMatch ? whereMatch[1] : null,
        order: orderMatch ? orderMatch[1] : null
      });
    }

    if (/db\.(?:Where\(.*?\)\.)?First\s*\(\s*&?([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/db\.(?:Where\(.*?\)\.)?First\s*\(\s*&?([a-zA-Z0-9_]+)/i);
      const whereMatch = body.match(/Where\s*\(\s*["']([^"']+)["']/i);
      
      dbOps.push({
        type: 'READ (FIRST)',
        entity: normalizeEntity(entityMatch ? entityMatch[1] : null),
        filter: whereMatch ? whereMatch[1] : null
      });
    }

    if (/db\.Create\s*\(\s*&?([a-zA-Z0-9_]+)/i.test(body) || /INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/db\.Create\s*\(\s*&?([a-zA-Z0-9_]+)/i) || body.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i);
      dbOps.push({ type: 'CREATE', entity: normalizeEntity(entityMatch ? entityMatch[1] : null) });
    }

    if (/db\.Save\s*\(\s*&?([a-zA-Z0-9_]+)/i.test(body) || /db\.Update/i.test(body) || /UPDATE\s+([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/db\.Save\s*\(\s*&?([a-zA-Z0-9_]+)/i) || body.match(/UPDATE\s+([a-zA-Z0-9_]+)/i);
      dbOps.push({ type: 'UPDATE', entity: normalizeEntity(entityMatch ? entityMatch[1] : null) });
    }

    if (/db\.Delete\s*\(\s*&?([a-zA-Z0-9_]+)/i.test(body) || /DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/db\.Delete\s*\(\s*&?([a-zA-Z0-9_]+)/i) || body.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i);
      dbOps.push({ type: 'DELETE', entity: normalizeEntity(entityMatch ? entityMatch[1] : null) });
    }

    return dbOps;
  }

  // Extract Security/Auth within function body or middleware
  function extractAuthFlow(content) {
    const auth = {
      authentication: null,
      password: null,
      cookies: [],
      roles: new Set(),
      authorizations: []
    };

    if (/Cookie|SetCookie|Set-Cookie/i.test(content)) {
      auth.authentication = 'Cookie based';
      const cookieNameMatches = content.matchAll(/(?:Name|Cookie)\s*:\s*["']([^"']+)["']/g);
      for (const cm of cookieNameMatches) {
        if (cm[1] && !auth.cookies.includes(cm[1])) {
          auth.cookies.push(cm[1]);
        }
      }
    } else if (/jwt|Bearer|SigningKey|Claims/i.test(content)) {
      auth.authentication = 'JWT';
    } else if (/Session|GetSession/i.test(content)) {
      auth.authentication = 'Session based';
    }

    if (/bcrypt|CompareHashAndPassword|GenerateFromPassword/i.test(content)) {
      auth.password = 'bcrypt validation';
    }

    const roleMatches = content.matchAll(/(?:Role|role)\s*==\s*["']([^"']+)["']|RequireRole\s*\(\s*["']([^"']+)["']/g);
    for (const rm of roleMatches) {
      const role = rm[1] || rm[2];
      if (role) auth.roles.add(role);
    }

    const authCheckMatches = content.matchAll(/if\s+!?\s*([a-zA-Z0-9_]+(?:Can|Has|Is|Check|Modify|Access|Permission)[a-zA-Z0-9_]*\([^)]*\))/g);
    for (const ac of authCheckMatches) {
      auth.authorizations.push({
        check: ac[1],
        forbiddenResponse: 403
      });
    }

    return auth;
  }

  // Extract Side Effects in function body
  function extractSideEffects(body) {
    const sideEffects = [];

    if (/os\.WriteFile|ioutil\.WriteFile|os\.Create/i.test(body)) {
      sideEffects.push('File write operation');
    }
    if (/os\.Remove|os\.RemoveAll/i.test(body)) {
      sideEffects.push('File deletion');
    }
    if (/exec\.Command|exec\.CommandContext/i.test(body)) {
      sideEffects.push('External system command execution');
    }
    if (/smtp\.SendMail|SendEmail|mail\.Send/i.test(body)) {
      sideEffects.push('Send email notification');
    }
    if (/RecordActivity|AuditLog|LogActivity/i.test(body)) {
      sideEffects.push('Record audit logging activity');
    }

    return sideEffects;
  }

  // Extract API Responses from body
  function extractAPIResponses(body) {
    const responses = [];
    const statusMatches = body.matchAll(/(?:c\.JSON|c\.Status|http\.Error|json\.NewEncoder)\s*\(\s*(?:http\.)?(Status[a-zA-Z0-9]+|[0-9]{3})/g);

    for (const sm of statusMatches) {
      let status = sm[1];
      if (status.startsWith('Status')) {
        status = status.replace('Status', '');
      }
      if (!responses.includes(status)) responses.push(status);
    }

    return responses;
  }

  // Summarize function operation logic into concise semantic steps
  function summarizeFunctionIntent(body) {
    const inputs = [];
    const processSteps = [];

    // Inputs
    const paramMatches = body.matchAll(/(?:QueryParam|Param|FormValue)\s*\(\s*["']([^"']+)["']\)/g);
    for (const pm of paramMatches) {
      if (!inputs.includes(pm[1])) inputs.push(pm[1]);
    }
    if (/c\.Bind\s*\(|json\.NewDecoder/i.test(body)) {
      inputs.push('Request Body');
    }

    // Process Steps
    if (/Validate|Struct|checkValidity/i.test(body)) processSteps.push('Validate input');
    if (/bcrypt|CompareHashAndPassword/i.test(body)) processSteps.push('Authenticate credentials');
    
    if (/is_active\s*=\s*false|IsActive\s*=\s*false/i.test(body)) {
      processSteps.push('Deactivate previous active record');
    }

    const dbOps = extractDatabaseOperations(body);
    dbOps.forEach(op => {
      if (op.type === 'READ' || op.type === 'READ (FIRST)') processSteps.push(`Fetch ${op.entity} data`);
      if (op.type === 'CREATE') processSteps.push(`Create ${op.entity} entity and save to database`);
      if (op.type === 'UPDATE') processSteps.push(`Update ${op.entity} entity in database`);
      if (op.type === 'DELETE') processSteps.push(`Delete ${op.entity} entity from database`);
    });

    if (/c\.Redirect|http\.Redirect/i.test(body)) processSteps.push('Redirect response');
    if (/c\.JSON|c\.String|json\.NewEncoder/i.test(body)) processSteps.push('Return API response');
    if (/c\.Render|HTML/i.test(body)) processSteps.push('Render view output');

    return {
      inputs,
      processSteps: processSteps.length > 0 ? processSteps : ['Execute process flow'],
      dbOps
    };
  }

  // Extract functions
  function extractFunctions(content) {
    const functions = [];
    const funcRegex = /func\s+(?:\((?:[a-zA-Z0-9_*\s]+)\)\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:\([^)]*\)|[^{]*)\s*\{/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      const fnName = match[1];
      const fnParams = match[2];
      const blockStart = match.index + match[0].length - 1;
      const fullBlock = extractBalancedBlock(content, blockStart);

      if (fullBlock) {
        const body = fullBlock.slice(1, -1);
        const intent = summarizeFunctionIntent(body);
        const responses = extractAPIResponses(body);
        const sideEffects = extractSideEffects(body);

        functions.push({
          name: fnName,
          params: fnParams,
          inputs: intent.inputs,
          processSteps: intent.processSteps,
          dbOps: intent.dbOps,
          responses,
          sideEffects
        });

        funcRegex.lastIndex = blockStart + fullBlock.length;
      }
    }

    return functions;
  }

  // Pipeline Stage 1 & 2 Main Execution
  function parseBackendAST(content, fileName) {
    // Imports
    const imports = [];
    const importRegex = /import\s*\(([\s\S]*?)\)|import\s+["']([^"']+)["']/g;
    let impMatch;
    while ((impMatch = importRegex.exec(content)) !== null) {
      if (impMatch[1]) {
        impMatch[1].split('\n').forEach(line => {
          const clean = line.replace(/"/g, '').trim();
          if (clean && !clean.startsWith('//')) imports.push(clean);
        });
      } else if (impMatch[2]) {
        imports.push(impMatch[2]);
      }
    }

    const framework = detectFramework(content, imports);
    const routes = extractRoutes(content);
    const structs = extractStructs(content);
    const functions = extractFunctions(content);
    const auth = extractAuthFlow(content);

    return {
      fileName,
      framework,
      imports,
      routes,
      structs,
      functions,
      auth
    };
  }

  // Pipeline Stage 3: Generate Semantic LIR Compressed
  function formatBackendLIR(ast) {
    let output = "==================================================\n";
    output += "SEMANTIC LIR COMPRESSED\n";
    output += `FILE: ${ast.fileName}\n`;
    output += "TYPE: Backend Core Module\n";
    output += `FRAMEWORK: ${ast.framework}\n`;
    output += `PURPOSE: Service, Route & Data Semantics Extraction\n`;
    output += "==================================================\n\n";

    // BACKEND STRUCTURE
    output += "[BACKEND STRUCTURE]\n";
    output += "Application\n";
    const modules = new Set();
    ast.functions.forEach(f => {
      const inferredModule = inferBusinessModule(f.name);
      if (inferredModule) modules.add(inferredModule);
    });

    if (modules.size > 0) {
      const moduleArr = Array.from(modules);
      moduleArr.forEach((mod, idx) => {
        const marker = idx === moduleArr.length - 1 ? "└── " : "├── ";
        output += `${marker}${mod}\n`;
      });
    } else {
      output += "└── Core Service\n";
    }
    output += "==================================================\n\n";

    // GLOBAL SERVICES
    output += "GLOBAL SERVICES\n";
    output += "==================================================\n";
    output += `Database: ${ast.structs.length > 0 ? 'Detected ORM / Relational DB' : 'None / Not Detected'}\n`;
    output += `Framework: ${ast.framework}\n`;
    output += "==================================================\n\n";

    // UTILITY & HANDLER FUNCTIONS
    if (ast.functions.length > 0) {
      output += "MODULE FUNCTIONS\n";
      output += "==================================================\n";
      ast.functions.forEach((fn, idx) => {
        output += `FUNCTION: ${fn.name}()\n`;
        if (fn.inputs.length > 0) {
          output += `Input: ${fn.inputs.join(', ')}\n`;
        }
        output += "Process:\n";
        fn.processSteps.forEach((step, sIdx) => {
          output += `${sIdx + 1}. ${step}\n`;
        });
        if (fn.sideEffects && fn.sideEffects.length > 0) {
          output += "Side Effects:\n";
          fn.sideEffects.forEach(se => {
            output += `  - ${se}\n`;
          });
        }
        if (fn.responses.length > 0) {
          output += `API Response Status: ${fn.responses.join(', ')}\n`;
        }
        if (idx < ast.functions.length - 1) {
          output += "--------------------------------------------------\n";
        }
      });
      output += "==================================================\n\n";
    }

    // DATA STRUCTURES & ENTITIES CLASSIFICATION
    if (ast.structs.length > 0) {
      const dbEntities = ast.structs.filter(s => s.isDbEntity);
      const localDtos = ast.structs.filter(s => !s.isDbEntity);

      output += "DATA STRUCTURES\n";
      output += "==================================================\n";

      if (dbEntities.length > 0) {
        output += "DATABASE ENTITIES:\n";
        dbEntities.forEach(st => {
          output += `Entity: ${st.name}\n`;
          output += "Fields:\n";
          st.fields.forEach(f => {
            output += `  - ${f.name} (${f.type})\n`;
          });
          if (st.relationships.length > 0) {
            output += "Relationships:\n";
            st.relationships.forEach(rel => {
              output += `  - ${rel}\n`;
            });
          }
          output += "\n";
        });
      }

      if (localDtos.length > 0) {
        output += "LOCAL DTO / TEMP STRUCT:\n";
        localDtos.forEach(st => {
          output += `Struct: ${st.name}\n`;
          output += "Fields:\n";
          st.fields.forEach(f => {
            output += `  - ${f.name} (${f.type})\n`;
          });
          output += "\n";
        });
      }
      output += "==================================================\n";
    }

    // SECURITY & AUTHORIZATION RULES
    if (ast.auth.authentication || ast.auth.password || ast.auth.cookies.length > 0 || ast.auth.roles.size > 0 || ast.auth.authorizations.length > 0) {
      output += "SECURITY RULES\n";
      output += "==================================================\n";
      if (ast.auth.authentication) output += `Authentication: ${ast.auth.authentication}\n`;
      if (ast.auth.cookies.length > 0) output += `Cookies: ${ast.auth.cookies.join(', ')}\n`;
      if (ast.auth.password) output += `Password Validation: ${ast.auth.password}\n`;
      if (ast.auth.roles.size > 0) output += `Roles Detected: ${Array.from(ast.auth.roles).join(', ')}\n`;
      
      if (ast.auth.authorizations.length > 0) {
        output += "\nAUTHORIZATION FLOW:\n";
        ast.auth.authorizations.forEach(authItem => {
          output += `Permission Check: ${authItem.check}\n`;
          output += `Forbidden Response: ${authItem.forbiddenResponse}\n`;
        });
      }
      output += "==================================================\n\n";
    }

    // ROUTE MAP & API CONTRACT
    if (ast.routes.length > 0) {
      output += "ROUTE MAP & API CONTRACTS\n";
      output += "==================================================\n";
      ast.routes.forEach(r => {
        output += `Route: ${r.method} ${r.path}\n`;
        output += `Handler: ${r.handler}\n`;
        if (r.middleware) output += `Middleware: ${r.middleware}\n`;
        output += "--------------------------------------------------\n";
      });
      output += "==================================================\n\n";
    }

    // BUSINESS FLOW SUMMARY
    if (ast.functions.length > 0) {
      output += "BUSINESS FLOW SUMMARY\n";
      output += "==================================================\n";
      ast.functions.forEach(fn => {
        output += `${fn.name}: Request → ${fn.processSteps.join(' → ')}\n`;
      });
      output += "==================================================\n\n";
    }

    // MIGRATION ESSENTIALS
    output += "MIGRATION ESSENTIALS\n";
    output += "==================================================\n";
    output += "Preserve:\n";
    output += "- route behavior & contract\n";
    output += "- business flow sequence\n";
    output += "- database relationships & entity fields\n";
    output += "- authentication & security behavior\n";
    output += "- input validation rules\n";
    output += "- side effect operations (file I/O, external commands, email)\n";
    output += "Ignore:\n";
    output += "- Go language specific syntax\n";
    output += "- Framework specific route handlers/bindings\n";
    output += "- Specific ORM method call signatures\n";
    output += "==================================================";

    return output;
  }

  // Pipeline Entrypoint Stage Callback
  async function backendSemanticStage(context) {
    const { projectFiles, selectedFiles, pipelineContext } = context;
    let outputs = [];

    for (const fileKey of selectedFiles) {
      const file = projectFiles[fileKey];
      if (!file) continue;

      const content = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsText(file);
      });

      const fileName = file.name || fileKey;

      // 1. Parse AST
      const ast = parseBackendAST(content, fileName);

      // 2. Format Semantic LIR
      const lirOutput = formatBackendLIR(ast);
      outputs.push(lirOutput);
    }

    const finalOutput = outputs.join('\n\n=========================================\n\n');

    return {
      pipelineContext: {
        ...pipelineContext,
        backendSemanticExtracted: true
      },
      finalOutput: finalOutput
    };
  }

  if (typeof window !== 'undefined' && window.LirEngineRegistry) {
    window.LirEngineRegistry.registerStage(
      'backend',
      backendSemanticStage
    );

    console.log(
      "BACKEND REGISTERED",
      window.LirEngineRegistry.backend.length
    );
  }
})();
