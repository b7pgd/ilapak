/**
 * DEBUG LIR ENGINE - BACKEND EXTRACTOR
 * Static analysis engine for backend source code parsing.
 */

(function () {
    'use strict';

    window.LirEngineRegistry = window.LirEngineRegistry || {
        registerStage(targetEngine, stageFn) {
            if (!this[targetEngine]) {
                this[targetEngine] = [];
            }
            if (!this[targetEngine].includes(stageFn)) {
                this[targetEngine].push(stageFn);
            }
        }
    };

    class BackendDebugLirExtractor {
        constructor() {
            this.fileContexts = [];
        }

        async processFiles(projectFiles, selectedFiles) {
            const results = [];
            for (const path of selectedFiles) {
                const fileObj = projectFiles[path];
                if (!fileObj) continue;

                let content = '';
                try {
                    content = await fileObj.text();
                } catch (e) {
                    content = '';
                }

                const lirData = this.analyzeSingleFile(path, content);
                results.push(this.formatDebugLir(lirData));
            }

            return {
                finalOutput: results.join('\n\n')
            };
        }

        analyzeSingleFile(filePath, code) {
            const ext = this.getFileExtension(filePath);
            const fileType = this.detectFileType(filePath, code, ext);
            const purpose = this.inferPurpose(filePath, code, fileType);

            const entryPoints = this.extractEntryPoints(code, ext);
            const executionFlow = this.extractExecutionFlow(code);
            const reads = this.extractReads(code);
            const writes = this.extractWrites(code);
            const http = this.extractHttpCalls(code);
            const dependencies = this.extractDependencies(code);
            const failurePoints = this.extractFailurePoints(code);
            const exitPaths = this.extractExitPaths(code);

            return {
                filePath,
                fileType,
                purpose,
                entryPoints,
                executionFlow,
                reads,
                writes,
                http,
                dependencies,
                failurePoints,
                exitPaths
            };
        }

        getFileExtension(filePath) {
            const parts = filePath.split('.');
            return parts.length > 1 ? parts.pop().toLowerCase() : '';
        }

        detectFileType(path, code, ext) {
            const p = path.toLowerCase();

            if (p.includes('controller')) return 'API Controller / Request Handler';
            if (p.includes('route') || p.includes('router')) return 'HTTP Router / Endpoint Definition';
            if (p.includes('middleware')) return 'HTTP Middleware';
            if (p.includes('service') || p.includes('usecase')) return 'Business Logic Service / UseCase';
            if (p.includes('repository') || p.includes('dao')) return 'Data Access Repository / DAO';
            if (p.includes('model') || p.includes('entity') || p.includes('schema')) return 'Data Model / Entity Schema';
            if (p.includes('migration')) return 'Database Migration Script';
            if (p.includes('job') || p.includes('worker') || p.includes('queue') || p.includes('cron')) return 'Background Worker / Task Job';
            if (p.includes('config') || p.includes('env')) return 'Backend Infrastructure Config';

            if (ext === 'go') {
                if (code.includes('package main')) return 'Go Application Entrypoint (main.go)';
                if (code.includes('echo.Context') || code.includes('*gin.Context') || code.includes('*fiber.Ctx')) return 'Go HTTP Controller Handler';
                return 'Go Package Module';
            }

            if (ext === 'php') {
                if (code.includes('extends Controller') || code.includes('BaseController')) return 'PHP Controller Class';
                if (code.includes('extends Model') || code.includes('extends Eloquent')) return 'PHP ORM Model Class';
                if (code.includes('Route::get') || code.includes('Route::post')) return 'Laravel/PHP Route Mapping';
                return 'PHP Script Module';
            }

            if (ext === 'py') {
                if (code.includes('@app.get') || code.includes('@router.get') || code.includes('@app.route')) return 'Python API Route Handler';
                if (code.includes('models.Model') || code.includes('Base = declarative_base()')) return 'Python ORM Data Model';
                if (code.includes('def perform_create') || code.includes('APIView')) return 'Python DRF View';
                return 'Python Script / Module';
            }

            if (ext === 'java' || ext === 'kt') {
                if (code.includes('@RestController') || code.includes('@Controller')) return 'Spring REST Controller';
                if (code.includes('@Service')) return 'Spring Business Service';
                if (code.includes('@Repository')) return 'Spring Data Repository';
                if (code.includes('@Entity')) return 'Spring Persistence Entity';
                return 'JVM Source Module';
            }

            if (ext === 'rs') return 'Rust Source Module';
            if (ext === 'cs') return 'C# / ASP.NET Controller / Class';
            if (ext === 'rb') return 'Ruby / Rails Controller or Model';

            return 'Backend Source Code File';
        }

        inferPurpose(path, code, fileType) {
            const lines = code.split('\n');
            let docComment = '';
            for (let i = 0; i < Math.min(lines.length, 15); i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('#') || line.startsWith('"""')) {
                    docComment += line.replace(/[\/\*#"]/g, '').trim() + ' ';
                }
            }
            if (docComment.trim().length > 5) {
                return docComment.trim();
            }

            const fileName = path.split('/').pop();
            return `Handles server-side data, routes, or business operations for ${fileType} in ${fileName}.`;
        }

        extractEntryPoints(code, ext) {
            const entryPoints = [];

            // Express, Fastify, Gin, Fiber, Chi, Echo, FastAPI, Flask Route handlers
            const routeMatches = code.matchAll(/(app|router|r|e|group|route|Route::)\.(get|post|put|patch|delete|all|use|match|options)\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/gi);
            for (const match of routeMatches) {
                entryPoints.push(`HTTP Route [${match[2].toUpperCase()}]: ${match[3]}`);
            }

            // Spring Annotations
            const springRoutes = code.matchAll(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g);
            for (const match of springRoutes) {
                const method = match[1].replace('Mapping', '').toUpperCase();
                entryPoints.push(`Spring Endpoint [${method || 'REQUEST'}]: ${match[2]}`);
            }

            // Python Decorators
            const pyRoutes = code.matchAll(/@(app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g);
            for (const match of pyRoutes) {
                entryPoints.push(`FastAPI/Flask Route [${match[2].toUpperCase()}]: ${match[3]}`);
            }

            // CLI / Main entrypoints
            if (code.includes('func main()') || code.includes('public static void main') || code.includes('if __name__ == "__main__":')) {
                entryPoints.push('Main Executable Entry Point');
            }

            // Cron / Worker jobs
            if (code.includes('cron') || code.includes('@Scheduled') || code.includes('setInterval') || code.includes('queue.process')) {
                entryPoints.push('Cron Task / Scheduled Background Worker');
            }

            return entryPoints.length > 0 ? entryPoints : ['Module export / Auxiliary package function'];
        }

        extractExecutionFlow(code) {
            const flowSteps = [];

            // Class Method Definitions
            const classMethods = code.matchAll(/(?:public|private|protected|async|static)?\s*(?:function\s+|def\s+|fn\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?::{|\{|->|def)/g);
            for (const match of classMethods) {
                if (!['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
                    flowSteps.push(`Method/Function: ${match[1]}(${match[2].trim()})`);
                }
            }

            // Go Functions
            const goFns = code.matchAll(/func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/g);
            for (const match of goFns) {
                flowSteps.push(`Go Handler/Fn: ${match[1]}(${match[2].trim()})`);
            }

            // Middleware chains
            if (code.includes('next()') || code.includes('c.Next()') || code.includes('return next(c)')) {
                flowSteps.push('Middleware Pipeline Execution: Forwards context to next handler in chain');
            }

            // Database Operations Flow
            if (code.includes('.find') || code.includes('.select') || code.includes('.save') || code.includes('.execute') || code.includes('DB.Where')) {
                flowSteps.push('Database Query Step: Invokes ORM/Database operation');
            }

            return flowSteps.length > 0 ? flowSteps : ['Linear server-side script initialization'];
        }

        extractReads(code) {
            const reads = [];

            // HTTP Request Reading
            if (code.includes('req.body') || code.includes('c.Body') || code.includes('request()->all()') || code.includes('request.json') || code.includes('@RequestBody')) {
                reads.push('HTTP Request Payload: Reads incoming request Body JSON/Form');
            }

            if (code.includes('req.params') || code.includes('req.query') || code.includes('c.Param') || code.includes('c.QueryParam') || code.includes('@PathVariable') || code.includes('@RequestParam')) {
                reads.push('HTTP Request Metadata: Reads Path Parameters or Query Strings');
            }

            if (code.includes('req.headers') || code.includes('c.GetHeader') || code.includes('request()->header')) {
                reads.push('HTTP Request Headers: Reads HTTP request authorization or custom headers');
            }

            if (code.includes('req.cookies') || code.includes('c.Cookie')) {
                reads.push('HTTP Cookies: Reads client browser cookies');
            }

            // Database / Cache Reads
            if (code.includes('SELECT ') || code.includes('.find') || code.includes('.get(') || code.includes('.first') || code.includes('DB.Where')) {
                reads.push('Database Persistence: Queries data storage records');
            }

            if (code.includes('redis.get') || code.includes('cache.get') || code.includes('Cache::get')) {
                reads.push('Cache Read: Fetches cache keys (Redis/Memcached/In-Memory)');
            }

            // File & Environment Reads
            const envMatches = code.matchAll(/(process\.env\.[a-zA-Z0-9_$]+|os\.Getenv\(["']([^"']+)["']\)|env\(["']([^"']+)["']\)|os\.environ\.get\(["']([^"']+)["']\))/g);
            for (const match of envMatches) {
                reads.push(`Environment Variable: ${match[0]}`);
            }

            if (code.includes('fs.readFile') || code.includes('os.ReadFile') || code.includes('open(') || code.includes('file_get_contents')) {
                reads.push('File Storage Read: Reads local server file system');
            }

            return reads.length > 0 ? reads : ['No active request, database, or environment reads detected'];
        }

        extractWrites(code) {
            const writes = [];

            // Database Writes
            if (code.includes('INSERT INTO') || code.includes('UPDATE ') || code.includes('DELETE FROM') || code.includes('.save(') || code.includes('.create(') || code.includes('.delete(') || code.includes('DB.Create')) {
                writes.push('Database State Mutation: Inserts, updates, or deletes database records');
            }

            // HTTP Response Outputs
            if (code.includes('res.json') || code.includes('c.JSON') || code.includes('return response()') || code.includes('jsonify(') || code.includes('ResponseEntity')) {
                writes.push('HTTP Response Output: Serializes JSON payload to client');
            }

            if (code.includes('res.cookie') || code.includes('c.SetCookie')) {
                writes.push('HTTP Cookie Write: Sets client response cookies');
            }

            if (code.includes('res.setHeader') || code.includes('c.Header')) {
                writes.push('HTTP Header Write: Attaches custom HTTP response headers');
            }

            // Cache & Queue Writes
            if (code.includes('redis.set') || code.includes('cache.put') || code.includes('Cache::put')) {
                writes.push('Cache Write: Mutates cache entries');
            }

            if (code.includes('queue.push') || code.includes('dispatch(') || code.includes('publish')) {
                writes.push('Message Queue Push: Emits job/message to queue worker');
            }

            // File & Log Writes
            if (code.includes('console.log') || code.includes('log.') || code.includes('Log::') || code.includes('logger.')) {
                writes.push('System Logging: Writes execution traces to log outputs');
            }

            if (code.includes('fs.writeFile') || code.includes('os.WriteFile') || code.includes('file_put_contents')) {
                writes.push('File Storage Write: Writes files to disk');
            }

            return writes.length > 0 ? writes : ['No database, response, or state mutations detected'];
        }

        extractHttpCalls(code) {
            const http = [];

            // Outbound Client HTTP Calls
            const httpClients = code.matchAll(/(axios\.|http\.|fetch\(|curl_|HttpClient|restTemplate\.)(get|post|put|delete|request)\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/gi);
            for (const match of httpClients) {
                http.push(`Outbound HTTP Call: [${match[2].toUpperCase()}] -> ${match[3]}`);
            }

            // Incoming HTTP Context Signatures
            const statusMatches = code.matchAll(/(res\.status\(\s*(\d+)\s*\)|c\.JSON\(\s*(\d+)|status_code\s*=\s*(\d+)|http\.Status[a-zA-Z]+|http_response_code\((\d+)\))/g);
            for (const match of statusMatches) {
                http.push(`HTTP Status Response Code: ${match[0]}`);
            }

            return http.length > 0 ? http : ['No external outbound HTTP requests triggered'];
        }

        extractDependencies(code) {
            const deps = [];

            // Node / JS Imports
            const jsImports = code.matchAll(/(?:import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\))/g);
            for (const match of jsImports) {
                deps.push(`Node Module / Import: ${match[1] || match[2]}`);
            }

            // Go Imports
            const goImports = code.matchAll(/"([^"]+)"/g);
            if (code.includes('import (')) {
                const importBlock = code.substring(code.indexOf('import ('), code.indexOf(')'));
                const matches = importBlock.matchAll(/"([^"]+)"/g);
                for (const m of matches) {
                    deps.push(`Go Package: ${m[1]}`);
                }
            }

            // PHP Use statements
            const phpUses = code.matchAll(/use\s+([^;]+);/g);
            for (const match of phpUses) {
                deps.push(`PHP Namespace Use: ${match[1].trim()}`);
            }

            // Python Imports
            const pyImports = code.matchAll(/(?:from\s+([a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/g);
            for (const match of pyImports) {
                deps.push(`Python Module: ${match[1] || match[2]}`);
            }

            // Java Imports
            const javaImports = code.matchAll(/import\s+([a-zA-Z0-9_.]+);/g);
            for (const match of javaImports) {
                deps.push(`Java Package: ${match[1]}`);
            }

            return deps.length > 0 ? deps : ['No external modules or packages explicitly imported'];
        }

        extractFailurePoints(code) {
            const failures = [];

            if (code.includes('try {') || code.includes('except ') || code.includes('catch (')) {
                failures.push('Exception Handling Block: Captures runtime errors via try/catch/except');
            }

            if (code.includes('if err != nil') || code.includes('if err {')) {
                failures.push('Explicit Error Check: Evaluates Go/C-style error return check');
            }

            if (code.includes('panic(') || code.includes('throw new') || code.includes('raise ')) {
                failures.push('Panic / Unhandled Exception Raise: May abruptly abort execution thread');
            }

            if (code.includes('validate') || code.includes('validator') || code.includes('FormRequest') || code.includes('pydantic')) {
                failures.push('Request Validation Failure: Rejects invalid client payload with HTTP 400/422');
            }

            if (code.includes('jwt') || code.includes('auth') || code.includes('Bearer') || code.includes('Unauthorized')) {
                failures.push('Authentication / Authorization Risk: Throws HTTP 401/403 on missing or invalid tokens');
            }

            if (code.includes('null') || code.includes('nil') || code.includes('None') || code.includes('undefined')) {
                failures.push('Null Pointer / Nil Pointer Dereference: High hazard if record or context is uninitialized');
            }

            return failures.length > 0 ? failures : ['Standard execution error vectors'];
        }

        extractExitPaths(code) {
            const exits = [];

            if (code.includes('return res.') || code.includes('return c.JSON') || code.includes('return jsonify') || code.includes('return response()')) {
                exits.push('HTTP Response Exit: Terminates request cycle with HTTP response');
            }

            if (code.includes('return err') || code.includes('throw') || code.includes('raise')) {
                exits.push('Error Exit Path: Bails early returning error state');
            }

            if (code.includes('process.exit') || code.includes('os.Exit') || code.includes('sys.exit')) {
                exits.push('Process Termination: Immediately halts running process host');
            }

            const returnMatches = code.matchAll(/return\s+([^;]+);/g);
            let count = 0;
            for (const match of returnMatches) {
                if (count < 2) {
                    exits.push(`Return Value: ${match[1].trim()}`);
                    count++;
                }
            }

            return exits.length > 0 ? exits : ['Normal function end / Thread return'];
        }

        formatDebugLir(data) {
            return [
                '================================================== DEBUG LIR',
                `FILE: ${data.filePath}`,
                `TYPE: ${data.fileType}`,
                `PURPOSE: ${data.purpose}`,
                `ENTRY POINTS:\n  - ${data.entryPoints.join('\n  - ')}`,
                `EXECUTION FLOW:\n  - ${data.executionFlow.join('\n  - ')}`,
                `READS:\n  - ${data.reads.join('\n  - ')}`,
                `WRITES:\n  - ${data.writes.join('\n  - ')}`,
                `HTTP:\n  - ${data.http.join('\n  - ')}`,
                `DEPENDENCIES:\n  - ${data.dependencies.join('\n  - ')}`,
                `FAILURE POINTS:\n  - ${data.failurePoints.join('\n  - ')}`,
                `EXIT PATH:\n  - ${data.exitPaths.join('\n  - ')}`,
                '=================================================='
            ].join('\n');
        }
    }

    const extractor = new BackendDebugLirExtractor();

    window.LirEngineRegistry.registerStage('backend', async function (ctx) {
        return await extractor.processFiles(ctx.projectFiles, ctx.selectedFiles);
    });
})();
