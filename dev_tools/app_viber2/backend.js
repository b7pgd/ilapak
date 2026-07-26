/**
 * Backend Semantic Extraction Engine - Modular Pipeline Stage
 * Target Directory: /backend/
 * File: backend.js
 */
(function () {
  // Helper: Clean raw text from extra spaces and quotes
  function cleanText(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }

  // Helper: Infer generic module or service grouping objectively based on function action and file context
  function inferBusinessModule(functionName, fileName) {
    const rawName = functionName.replace(/^(Handle|Handler|Process|Execute|Run|Service|Controller)/i, '').trim() || functionName;
    
    // Extract base entity / action phrase without hardcoding domain words
    const actionMatch = rawName.match(/^(Get|List|Fetch|Create|Add|Save|Insert|Update|Edit|Modify|Delete|Remove|Destroy|Verify|Check|Validate|Find|Search)([A-Z][a-zA-Z0-9_]*)/);
    
    if (actionMatch && actionMatch[2]) {
      return `${actionMatch[2]} Service`;
    }

    const fallback = rawName.replace(/(Get|Create|Update|Delete|Show|List|Handler|Service|Handle)/gi, '').trim();
    if (fallback) {
      return `${fallback} Service`;
    }

    if (fileName) {
      const fileBase = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '');
      if (fileBase && !/^(main|app|index|server)$/i.test(fileBase)) {
        return `${fileBase.charAt(0).toUpperCase() + fileBase.slice(1)} Module`;
      }
    }

    return 'Core Service';
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

  // Helper: Extract python function block based on indentation
  function extractPythonBlock(text, startPos) {
    const lines = text.substring(startPos).split('\n');
    if (lines.length <= 1) return text.substring(startPos);

    let blockLines = [lines[0]];
    let baseIndent = -1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) {
        blockLines.push(line);
        continue;
      }

      const match = line.match(/^(\s+)/);
      const indent = match ? match[1].length : 0;

      if (baseIndent === -1) {
        if (indent === 0) break;
        baseIndent = indent;
      }

      if (indent < baseIndent && line.trim().length > 0) {
        break;
      }

      blockLines.push(line);
    }

    return blockLines.join('\n');
  }

  // Stage 1 & 2: Extract Structs, Classes, Fields, and Relationships
  function extractStructs(content) {
    const structs = [];

    // Go struct pattern
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

          const fieldMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([^\s`]+)(?:\s+`([^`]+)`)?/);
          if (fieldMatch) {
            const fieldName = fieldMatch[1];
            const fieldType = fieldMatch[2];
            const tags = fieldMatch[3] || '';

            if (tags.includes('gorm:') || tags.includes('primaryKey') || tags.includes('db:') || tags.includes('column:') || fieldName.toLowerCase() === 'id') {
              isDbEntity = true;
            }

            if (!fieldName.includes('.')) {
              fields.push({ name: fieldName, type: fieldType });
            }

            if (tags.includes('foreignKey') || tags.includes('many2many') || tags.includes('belongsTo') || tags.includes('references')) {
              relationships.push(`${structName} -> ${fieldType} (${tags.includes('many2many') ? 'many-to-many' : 'association'})`);
              isDbEntity = true;
            } else if (fieldType.startsWith('[]') && /^[A-Z]/.test(fieldType.slice(2))) {
              relationships.push(`${structName} has many ${fieldType.slice(2)}`);
              isDbEntity = true;
            } else if (/^[A-Z]/.test(fieldType) && !['String', 'Time', 'Int', 'Int64', 'Float64', 'Bool', 'Uint', 'Object', 'Any'].includes(fieldType)) {
              relationships.push(`${structName} belongs to ${fieldType}`);
              isDbEntity = true;
            }
          }
        });

        structs.push({ name: structName, fields, relationships, isDbEntity });
        structRegex.lastIndex = blockStart + fullBlock.length;
      }
    }

    // Generic ES6/TypeScript/Class/Model Entity pattern
    const classRegex = /class\s+([a-zA-Z0-9_]+)(?:\s*[\(\<]\s*([a-zA-Z0-9_.,\s]+)[\)\>]|\s+extends\s+([a-zA-Z0-9_]+))?\s*[\{:]/g;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const extendsOrBase = match[2] || match[3] || '';
      const blockStart = match.index + match[0].length - 1;

      let fullBlock = null;
      if (content[blockStart] === '{') {
        fullBlock = extractBalancedBlock(content, blockStart);
      } else {
        fullBlock = extractPythonBlock(content, match.index);
      }

      if (fullBlock) {
        const fields = [];
        const relationships = [];
        let isDbEntity = /@Entity|@Table|Model|Schema|Authenticatable/i.test(extendsOrBase) || 
                         /@Entity|@Table|Model|Schema/i.test(content.substring(Math.max(0, match.index - 100), match.index));

        const propRegex = /(?:@([a-zA-Z0-9_]+)\s*\([^)]*\)\s*)?([a-zA-Z0-9_]+)\s*[:=]/g;
        let propMatch;
        const classBody = fullBlock;

        while ((propMatch = propRegex.exec(classBody)) !== null) {
          const decorator = propMatch[1];
          const propName = propMatch[2];

          if (decorator && /Column|Primary|Entity|Field/i.test(decorator)) {
            isDbEntity = true;
          }
          if (decorator && /OneToMany|ManyToOne|ManyToMany|HasMany|BelongsTo/i.test(decorator)) {
            relationships.push(`${className} relation via @${decorator}`);
            isDbEntity = true;
          }

          if (propName && !fields.some(f => f.name === propName)) {
            fields.push({ name: propName, type: 'Property' });
          }
        }

        structs.push({ name: className, fields, relationships, isDbEntity });
        classRegex.lastIndex = match.index + fullBlock.length;
      }
    }

    return structs;
  }

  // Detect Detected Backend Patterns
  function detectFramework(content, imports) {
    const patterns = [];

    // Go Patterns
    if (imports.some(i => i.includes('labstack/echo')) || /e\.(GET|POST|PUT|DELETE|PATCH)\s*\(/.test(content)) patterns.push('Echo style routing');
    if (imports.some(i => i.includes('gin-gonic/gin')) || /r\.(GET|POST|PUT|DELETE|PATCH)\s*\(/i.test(content)) patterns.push('Gin style routing');
    if (imports.some(i => i.includes('gofiber/fiber'))) patterns.push('Fiber style routing');
    if (imports.some(i => i.includes('net/http')) || /http\.HandleFunc/.test(content)) patterns.push('net/http pattern');

    // Node / JS / TS Patterns
    if (imports.some(i => i.includes('express')) || /app\.(get|post|put|delete|patch|use)\s*\(/i.test(content)) patterns.push('Express style routing');
    if (imports.some(i => i.includes('@nestjs')) || /@Controller|@Get|@Post|@Put|@Delete/i.test(content)) patterns.push('NestJS style routing');
    if (imports.some(i => i.includes('fastify'))) patterns.push('Fastify style routing');

    // Python Patterns
    if (imports.some(i => i.includes('fastapi')) || /@app\.(get|post|put|delete|patch)/i.test(content)) patterns.push('FastAPI style routing');
    if (imports.some(i => i.includes('flask')) || /@app\.route/i.test(content)) patterns.push('Flask style routing');
    if (imports.some(i => i.includes('django'))) patterns.push('Django pattern');

    // PHP Patterns
    if (/Route::(get|post|put|delete|patch|resource)/i.test(content)) patterns.push('Laravel style routing');

    return patterns.length > 0 ? patterns.join(', ') : 'Generic Backend Pattern';
  }

  // Stage 1 & 2: Extract Routes via Multi-framework Pattern Matching
  function extractRoutes(content) {
    const routes = [];
    let match;

    // Pattern 1: Chain/Router Calls (e.g. e.GET, router.post, app.get, Route::get)
    const routeRegex = /(?:e|r|router|app|group|g|api|v1|Route)\.(GET|POST|PUT|PATCH|DELETE|get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']\s*,\s*(.*?)\)/gi;
    while ((match = routeRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      const rest = match[3].split(',').map(s => s.trim());
      const handler = rest[rest.length - 1] || 'AnonymousHandler';
      const middleware = rest.slice(0, rest.length - 1);

      routes.push({
        method,
        path,
        handler: handler.replace(/^[a-zA-Z0-9_]+\./, '').replace(/['"]/g, ''),
        middleware: middleware.length > 0 ? middleware.join(', ') : null
      });
    }

    // Pattern 2: Decorator-based Routing (NestJS, FastAPI, Python)
    const decoratorRegex = /@(Get|Post|Put|Patch|Delete|route)\s*\(\s*["']([^"']+)["']\s*\)[\s\S]*?(?:async\s+)?def\s+([a-zA-Z0-9_]+)|@(Get|Post|Put|Patch|Delete)\s*\(\s*["']([^"']+)["']\s*\)[\s\S]*?([a-zA-Z0-9_]+)\s*\(/gi;
    while ((match = decoratorRegex.exec(content)) !== null) {
      const method = (match[1] || match[4]).toUpperCase();
      const path = match[2] || match[5];
      const handler = match[3] || match[6];

      routes.push({
        method: method === 'ROUTE' ? 'ALL' : method,
        path,
        handler,
        middleware: null
      });
    }

    // Pattern 3: Standard net/http or basic Function mappings
    const httpRegex = /(?:http\.HandleFunc|app\.use)\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z0-9_.]+)\)/g;
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

  // Extract Database Operations inside function body universally
  function extractDatabaseOperations(body) {
    const dbOps = [];

    const normalizeEntity = (raw) => {
      if (!raw) return 'Unknown';
      const clean = raw.replace(/^[&*(]+|[()]+$/g, '').split('.')[0];
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    };

    // Generic READ Operations (GORM, Prisma, Sequelize, SQLAlchemy, Django ORM, Raw SQL)
    if (/\b(?:Find|First|findMany|findUnique|findAll|findOne|query|filter|select|all)\b/i.test(body) || /SELECT\s+.*?\s+FROM/i.test(body) || /\.objects\./i.test(body)) {
      const entityMatch = body.match(/(?:Find|First|findMany|findUnique|findAll|findOne)\s*\(\s*&?([a-zA-Z0-9_]+)/i) || 
                          body.match(/FROM\s+([a-zA-Z0-9_]+)/i) ||
                          body.match(/([a-zA-Z0-9_]+)\.(?:findMany|findUnique|findAll|findOne|objects)/i);
      const whereMatch = body.match(/(?:Where|where|filter)\s*\(\s*["']?([^"']+)["']?/i);
      const orderMatch = body.match(/(?:Order|orderBy|order_by)\s*\(\s*["']?([^"']+)["']?/i);
      
      dbOps.push({
        type: 'READ',
        entity: normalizeEntity(entityMatch ? entityMatch[1] : null),
        filter: whereMatch ? whereMatch[1] : null,
        order: orderMatch ? orderMatch[1] : null
      });
    }

    // Generic CREATE Operations (GORM, Prisma, Sequelize, Django, Raw SQL)
    if (/\b(?:Create|Save|create|insert|save|add)\b/i.test(body) || /INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/(?:Create|Save|create|insert)\s*\(\s*&?([a-zA-Z0-9_]+)/i) || 
                          body.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i) ||
                          body.match(/([a-zA-Z0-9_]+)\.create/i);
      dbOps.push({ type: 'CREATE', entity: normalizeEntity(entityMatch ? entityMatch[1] : null) });
    }

    // Generic UPDATE Operations
    if (/\b(?:Update|Save|update|updateMany|save)\b/i.test(body) || /UPDATE\s+([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/(?:Update|Save|update|updateMany)\s*\(\s*&?([a-zA-Z0-9_]+)/i) || 
                          body.match(/UPDATE\s+([a-zA-Z0-9_]+)/i) ||
                          body.match(/([a-zA-Z0-9_]+)\.update/i);
      dbOps.push({ type: 'UPDATE', entity: normalizeEntity(entityMatch ? entityMatch[1] : null) });
    }

    // Generic DELETE Operations
    if (/\b(?:Delete|Remove|delete|destroy|deleteMany|remove)\b/i.test(body) || /DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i.test(body)) {
      const entityMatch = body.match(/(?:Delete|Remove|delete|destroy|deleteMany)\s*\(\s*&?([a-zA-Z0-9_]+)/i) || 
                          body.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i) ||
                          body.match(/([a-zA-Z0-9_]+)\.(?:delete|destroy)/i);
      dbOps.push({ type: 'DELETE', entity: normalizeEntity(entityMatch ? entityMatch[1] : null) });
    }

    return dbOps;
  }

  // Extract Security/Auth within function body or middleware universally
  function extractAuthFlow(content) {
    const auth = {
      authentication: null,
      password: null,
      cookies: [],
      roles: new Set(),
      authorizations: []
    };

    if (/Cookie|SetCookie|Set-Cookie|req\.cookies|cookies\.get/i.test(content)) {
      auth.authentication = 'Cookie based';
      const cookieNameMatches = content.matchAll(/(?:Name|Cookie|cookie)\s*[:=]\s*["']([^"']+)["']/gi);
      for (const cm of cookieNameMatches) {
        if (cm[1] && !auth.cookies.includes(cm[1])) {
          auth.cookies.push(cm[1]);
        }
      }
    } else if (/jwt|Bearer|SigningKey|Claims|verifyToken|passport/i.test(content)) {
      auth.authentication = 'JWT / Bearer Token';
    } else if (/Session|GetSession|req\.session/i.test(content)) {
      auth.authentication = 'Session based';
    }

    if (/bcrypt|CompareHashAndPassword|GenerateFromPassword|check_password|Hash::check|argon2|scrypt/i.test(content)) {
      auth.password = 'Hash verification pattern';
    }

    const roleMatches = content.matchAll(/(?:Role|role|hasRole)\s*(?:==|===|\().*?["']([^"']+)["']/gi);
    for (const rm of roleMatches) {
      if (rm[1]) auth.roles.add(rm[1]);
    }

    const authCheckMatches = content.matchAll(/if\s+!?\s*([a-zA-Z0-9_.]+(?:Can|Has|Is|Check|Modify|Access|Permission|Guard|Authorize)[a-zA-Z0-9_]*\([^)]*\))/gi);
    for (const ac of authCheckMatches) {
      auth.authorizations.push({
        check: ac[1],
        forbiddenResponse: 403
      });
    }

    return auth;
  }

  // Extract Side Effects in function body universally
  function extractSideEffects(body) {
    const sideEffects = [];

    if (/os\.WriteFile|ioutil\.WriteFile|os\.Create|fs\.writeFile|fs\.writeFileSync|open\([^)]+['"]w['"]\)/i.test(body)) {
      sideEffects.push('File write operation');
    }
    if (/os\.Remove|os\.RemoveAll|fs\.unlink|fs\.rmdir|os\.remove/i.test(body)) {
      sideEffects.push('File deletion');
    }
    if (/exec\.Command|exec\.CommandContext|child_process|subprocess\.run|shell_exec/i.test(body)) {
      sideEffects.push('External system command execution');
    }
    if (/smtp\.SendMail|SendEmail|mail\.Send|transporter\.sendMail|mailgun|sendgrid/i.test(body)) {
      sideEffects.push('Send email notification');
    }
    if (/RecordActivity|AuditLog|LogActivity|logger\.info|\baudit\b/i.test(body)) {
      sideEffects.push('Record audit logging activity');
    }

    return sideEffects;
  }

  // Extract API Responses from body universally
  function extractAPIResponses(body) {
    const responses = [];

    // HTTP Status Codes / Enum Matches
    const statusMatches = body.matchAll(/(?:status|Status|c\.JSON|c\.Status|res\.status|http\.Error|json\.NewEncoder|JSONResponse)\s*\(\s*(?:http\.)?(Status[a-zA-Z0-9]+|[0-9]{3})/gi);
    for (const sm of statusMatches) {
      let status = sm[1];
      if (status.startsWith('Status')) {
        status = status.replace('Status', '');
      }
      if (!responses.includes(status)) responses.push(status);
    }

    // Pattern Response Types
    if (/res\.json|c\.JSON|JSONResponse|return\s+jsonify/i.test(body) && !responses.includes('JSON response')) {
      responses.push('JSON response');
    }
    if (/res\.redirect|c\.Redirect|http\.Redirect|redirect\(/i.test(body) && !responses.includes('Redirect')) {
      responses.push('Redirect');
    }
    if (/res\.render|c\.Render|render_template/i.test(body) && !responses.includes('HTML Render')) {
      responses.push('HTML Render');
    }

    return responses;
  }

  // Summarize function operation logic into concise semantic steps universally
  function summarizeFunctionIntent(body) {
    const inputs = [];
    const processSteps = [];

    // Universal Inputs Detection
    const paramMatches = body.matchAll(/(?:QueryParam|Param|FormValue|req\.query|req\.params|req\.body|request\.get|args\.get)\s*\(?\s*["']([^"']+)["']\)?/gi);
    for (const pm of paramMatches) {
      if (!inputs.includes(pm[1])) inputs.push(pm[1]);
    }
    if (/c\.Bind|json\.NewDecoder|req\.body|request\.json|bodyParser/i.test(body)) {
      inputs.push('Request Body Payload');
    }

    // Process Steps Analysis
    if (/Validate|Struct|checkValidity|validator|Joi|zod/i.test(body)) processSteps.push('Validate input payload');
    if (/bcrypt|CompareHashAndPassword|check_password|Hash::check/i.test(body)) processSteps.push('Authenticate credentials');
    
    if (/is_active\s*=\s*false|IsActive\s*=\s*false|status\s*=\s*['"]disabled['"]/i.test(body)) {
      processSteps.push('Deactivate target record state');
    }

    const dbOps = extractDatabaseOperations(body);
    dbOps.forEach(op => {
      if (op.type === 'READ') processSteps.push(`Fetch ${op.entity} data`);
      if (op.type === 'CREATE') processSteps.push(`Create ${op.entity} entity in persistent storage`);
      if (op.type === 'UPDATE') processSteps.push(`Update ${op.entity} entity in persistent storage`);
      if (op.type === 'DELETE') processSteps.push(`Delete ${op.entity} entity from persistent storage`);
    });

    if (/c\.Redirect|http\.Redirect|res\.redirect|redirect\(/i.test(body)) processSteps.push('Redirect response');
    if (/c\.JSON|res\.json|json\.NewEncoder|JSONResponse|jsonify/i.test(body)) processSteps.push('Return API response');
    if (/c\.Render|res\.render|HTML|render_template/i.test(body)) processSteps.push('Render view output');

    return {
      inputs,
      processSteps: processSteps.length > 0 ? processSteps : ['Execute process flow'],
      dbOps
    };
  }

  // Extract functions universally (Go, JS/TS, Python, PHP)
  function extractFunctions(content) {
    const functions = [];

    // Go / C-Style / Python / PHP Function Pattern
    const funcRegex = /(?:func|function|def)\s+(?:\((?:[a-zA-Z0-9_*\s]+)\)\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:\([^)]*\)|[^{:]*)\s*[{:]/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      const fnName = match[1];
      const fnParams = match[2];
      const matchEndPos = match.index + match[0].length;
      
      let fullBlock = null;
      if (content[matchEndPos - 1] === '{') {
        const blockStart = matchEndPos - 1;
        fullBlock = extractBalancedBlock(content, blockStart);
      } else {
        fullBlock = extractPythonBlock(content, match.index);
      }

      if (fullBlock) {
        const body = fullBlock;
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

        funcRegex.lastIndex = match.index + fullBlock.length;
      }
    }

    // ES6 Arrow / Method Assignment Pattern
    const arrowRegex = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
    while ((match = arrowRegex.exec(content)) !== null) {
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

        arrowRegex.lastIndex = blockStart + fullBlock.length;
      }
    }

    return functions;
  }

  // Pipeline Stage 1 & 2 Main Execution
  function parseBackendAST(content, fileName) {
    // Imports / Dependencies
    const imports = [];
    const importRegex = /(?:import\s*\(([\s\S]*?)\)|import\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)|use\s+([^;]+);)/g;
    let impMatch;
    while ((impMatch = importRegex.exec(content)) !== null) {
      if (impMatch[1]) {
        impMatch[1].split('\n').forEach(line => {
          const clean = line.replace(/"/g, '').trim();
          if (clean && !clean.startsWith('//')) imports.push(clean);
        });
      } else {
        const detected = impMatch[2] || impMatch[3] || impMatch[4];
        if (detected) imports.push(detected.trim());
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
    output += `PATTERNS DETECTED: ${ast.framework}\n`;
    output += `PURPOSE: Service, Route & Data Semantics Extraction\n`;
    output += "==================================================\n\n";

    // BACKEND STRUCTURE
    output += "[BACKEND STRUCTURE]\n";
    output += "Application\n";
    const modules = new Set();
    ast.functions.forEach(f => {
      const inferredModule = inferBusinessModule(f.name, ast.fileName);
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
    output += `Database: ${ast.structs.length > 0 ? 'Detected ORM / Relational DB Entities' : 'None / Not Detected'}\n`;
    output += `Detected Patterns: ${ast.framework}\n`;
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
          output += `API Response Status / Pattern: ${fn.responses.join(', ')}\n`;
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
    output += "- Source language specific syntax\n";
    output += "- Specific framework route bindings\n";
    output += "- Specific ORM call signatures\n";
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
