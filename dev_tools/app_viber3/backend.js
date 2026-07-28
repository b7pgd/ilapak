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
            const httpContract = this.extractHttpContract(code, entryPoints);
            const requestSchema = this.extractRequestSchema(code);
            const responseSchema = this.extractResponseSchema(code, http);
            const entityMapping = this.extractEntityMapping(code);
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
                httpContract,
                requestSchema,
                responseSchema,
                entityMapping,
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

            if (p.includes('controller')) return 'Backend HTTP Handler';
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
                if (code.includes('echo.Context') || code.includes('*gin.Context') || code.includes('*fiber.Ctx')) return 'Backend HTTP Handler';
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
            return `Target File: ${fileName}`;
        }

        extractEntryPoints(code, ext) {
            const http = [];
            const calledBy = [];

            const routeMatches = code.matchAll(/(app|router|r|e|group|route|Route::)\.(get|post|put|patch|delete|all|use|match|options)\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/gi);
            for (const match of routeMatches) {
                http.push(`${match[2].toUpperCase()} ${match[3]}`);
            }

            const springRoutes = code.matchAll(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g);
            for (const match of springRoutes) {
                const method = match[1].replace('Mapping', '').toUpperCase();
                http.push(`${method || 'REQUEST'} ${match[2]}`);
            }

            const pyRoutes = code.matchAll(/@(app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g);
            for (const match of pyRoutes) {
                http.push(`${match[2].toUpperCase()} ${match[3]}`);
            }

            const callerMatches = code.matchAll(/(?:from|import|fetch|axios).*?["']([^"']+\.(?:tsx|jsx|js|vue|svelte|html))["']/gi);
            for (const match of callerMatches) {
                calledBy.push(match[1]);
            }

            if (http.length === 0 && (code.includes('func main()') || code.includes('public static void main') || code.includes('if __name__ == "__main__":'))) {
                http.push('Main Executable Entry Point');
            }

            return {
                http: http.length > 0 ? http : ['Route Not Detected'],
                calledBy: calledBy.length > 0 ? calledBy : ['Unknown Caller / Internal Module']
            };
        }

        extractExecutionFlow(code) {
            const steps = [];

            if (code.includes('req.body') || code.includes('c.Bind') || code.includes('c.BodyParser') || code.includes('ShouldBindJSON') || code.includes('request()->all()')) {
                steps.push('Receive Request');
                steps.push('Parse Request Data');
            } else {
                steps.push('Receive Request');
            }

            if (code.includes('validate') || code.includes('validator') || code.includes('Binding') || code.includes('FormRequest')) {
                steps.push('Validate Input');
            }

            if (code.includes('Create') || code.includes('Insert') || code.includes('Save') || code.includes('Audit') || code.includes('RecordActivity')) {
                steps.push('Record / Insert Data');
            }

            if (code.includes('Find') || code.includes('Where') || code.includes('SELECT') || code.includes('GetUser') || code.includes('Query') || code.includes('First')) {
                steps.push('Fetch Record');
            }

            if (code.includes('CompareHash') || code.includes('Verify') || code.includes('bcrypt') || code.includes('CheckPassword')) {
                steps.push('Verify Credentials');
            }

            if (code.includes('jwt') || code.includes('GenerateToken') || code.includes('SignedString')) {
                steps.push('Generate Auth Token');
            }

            if (code.includes('SetCookie') || code.includes('cookie') || code.includes('Header')) {
                steps.push('Set Response Cookie / Header');
            }

            if (code.includes('res.json') || code.includes('c.JSON') || code.includes('return response()') || code.includes('jsonify') || code.includes('JSON(')) {
                steps.push('Return JSON Response');
            }

            return steps.length > 0 ? steps : ['Execute Process'];
        }

        extractReads(code) {
            const requestFields = [];
            const dbTables = [];
            const envVars = [];

            const jsonTags = code.matchAll(/json:"([a-zA-Z0-9_]+)"/g);
            for (const match of jsonTags) {
                if (!requestFields.includes(match[1])) requestFields.push(match[1]);
            }

            const bodyAccess = code.matchAll(/(?:req\.body|body|payload)\.([a-zA-Z0-9_]+)/g);
            for (const match of bodyAccess) {
                if (!requestFields.includes(match[1])) requestFields.push(match[1]);
            }

            const dbMatches = code.matchAll(/(?:FROM|\.Table\(|\.Model\(&?([a-zA-Z0-9_]+)\)|db\.([a-zA-Z0-9_]+))/gi);
            for (const match of dbMatches) {
                const table = (match[1] || match[2]).toLowerCase();
                if (!dbTables.includes(table)) dbTables.push(table);
            }

            const envMatches = code.matchAll(/(?:process\.env\.|os\.Getenv\(["']|env\(["']|os\.environ\.get\(["'])([a-zA-Z0-9_]+)/g);
            for (const match of envMatches) {
                if (!envVars.includes(match[1])) envVars.push(match[1]);
            }

            const dbOutput = [];
            if (dbTables.length > 0) {
                dbTables.forEach(t => dbOutput.push(`Table: ${t}`));
            }

            return {
                request: requestFields.length > 0 ? requestFields : ['None / Raw Body'],
                database: dbOutput.length > 0 ? dbOutput : ['None / Not Detected'],
                environment: envVars.length > 0 ? envVars : ['None']
            };
        }

        extractWrites(code) {
            const httpResp = [];
            const cookies = [];
            const logs = [];

            if (code.includes('res.json') || code.includes('c.JSON') || code.includes('return response()') || code.includes('jsonify') || code.includes('JSON(')) {
                httpResp.push('status', 'headers', 'json');
            }

            const cookieMatches = code.matchAll(/(?:SetCookie|cookie)\s*\(\s*["']([^"']+)["']/gi);
            for (const match of cookieMatches) {
                if (!cookies.includes(match[1])) cookies.push(match[1]);
            }

            const logMatches = code.matchAll(/(?:log\.|Logger|console\.log).*?["']([^"']+)["']/gi);
            for (const match of logMatches) {
                if (!logs.includes(match[1])) logs.push(match[1]);
            }

            return {
                httpResponse: httpResp.length > 0 ? httpResp : ['None / Void Output'],
                cookie: cookies.length > 0 ? cookies : ['None'],
                logs: logs.length > 0 ? logs : ['None']
            };
        }

        extractHttpCalls(code) {
            const request = [];
            const body = [];
            const successResp = [];
            const errorResp = [];

            const routeMatches = code.matchAll(/(app|router|r|e|group|route|Route::)\.(get|post|put|patch|delete)\s*\(\s*["'`]?([^"'`\),\s]+)["'`]?/gi);
            for (const match of routeMatches) {
                request.push(`${match[2].toUpperCase()} ${match[3]}`);
            }

            const jsonTags = code.matchAll(/json:"([a-zA-Z0-9_]+)"/g);
            for (const match of jsonTags) {
                if (!body.includes(match[1])) body.push(match[1]);
            }

            const statusMatches = code.matchAll(/(?:Status|status_code\s*=\s*|res\.status\(|c\.JSON\()(\d{3})/g);
            for (const match of statusMatches) {
                const codeNum = match[1];
                if (codeNum.startsWith('2') && !successResp.includes(codeNum)) {
                    successResp.push(codeNum);
                } else if ((codeNum.startsWith('4') || codeNum.startsWith('5')) && !errorResp.includes(codeNum)) {
                    errorResp.push(codeNum);
                }
            }

            return {
                request: request.length > 0 ? request : ['Unknown Route / Not Detected'],
                body: body.length > 0 ? body : ['None / Empty'],
                successResponse: successResp.length > 0 ? successResp : ['200 / Success Response'],
                errorResponse: errorResp.length > 0 ? errorResp : ['Internal Error Response']
            };
        }

        extractHttpContract(code, entryPoints) {
            let method = 'Unknown';
            let route = 'Unknown Route / Not Detected';

            if (entryPoints.http.length > 0 && entryPoints.http[0] !== 'Route Not Detected') {
                const parts = entryPoints.http[0].split(' ');
                if (parts.length >= 2) {
                    method = parts[0];
                    route = parts.slice(1).join(' ');
                } else {
                    route = entryPoints.http[0];
                }
            }

            let middleware = 'Unknown / Not Detected';
            if (code.includes('Use(') || code.includes('middleware')) {
                middleware = 'Detected if applicable';
            }

            let auth = 'Unknown / Not Detected';
            if (code.includes('jwt') || code.includes('Auth') || code.includes('Bearer') || code.includes('Token')) {
                auth = 'Detected if applicable';
            }

            return {
                method,
                route,
                handler: 'Current Handler',
                caller: entryPoints.calledBy.length > 0 ? entryPoints.calledBy[0] : 'Unknown Caller / Internal Module',
                middleware,
                authentication: auth
            };
        }

        extractRequestSchema(code) {
            let contentType = 'Unknown';
            if (code.includes('application/json') || code.includes('Bind') || code.includes('JSON')) {
                contentType = 'application/json (Detected if applicable)';
            } else if (code.includes('multipart/form-data') || code.includes('FormFile')) {
                contentType = 'multipart/form-data (Detected if applicable)';
            }

            const body = [];
            const jsonTags = code.matchAll(/json:"([a-zA-Z0-9_]+)"/g);
            for (const match of jsonTags) {
                if (!body.includes(match[1])) body.push(match[1]);
            }

            let queryParams = 'None';
            if (code.includes('QueryParam') || code.includes('req.query') || code.includes('c.Query')) {
                queryParams = 'Detected if applicable';
            }

            let pathParams = 'None';
            if (code.includes('Param(') || code.includes('req.params') || code.includes('c.Param')) {
                pathParams = 'Detected if applicable';
            }

            let headers = 'Unknown';
            if (code.includes('Header') || code.includes('headers')) {
                headers = 'Detected if applicable';
            }

            return {
                contentType,
                body: body.length > 0 ? body.join('\n') : 'None / Empty',
                queryParams,
                pathParams,
                headers
            };
        }

        extractResponseSchema(code, httpCalls) {
            let contentType = 'Unknown';
            if (code.includes('c.JSON') || code.includes('res.json') || code.includes('jsonify') || code.includes('JSON(')) {
                contentType = 'application/json (Detected if applicable)';
            }

            let statusCode = '200 (Detected if applicable)';
            if (httpCalls.successResponse.length > 0 && httpCalls.successResponse[0] !== '200 / Success Response') {
                statusCode = httpCalls.successResponse[0];
            }

            return {
                contentType,
                successPayload: 'Unknown',
                fields: 'Unknown',
                statusCode,
                errorPayload: 'Unknown',
                errorStatus: 'Unknown'
            };
        }

        extractEntityMapping(code) {
            const crudOps = [];
            if (code.includes('Create') || code.includes('Insert') || code.includes('Save')) crudOps.push('Create');
            if (code.includes('Find') || code.includes('First') || code.includes('Where') || code.includes('SELECT')) crudOps.push('Read');
            if (code.includes('Update') || code.includes('Save')) crudOps.push('Update');
            if (code.includes('Delete') || code.includes('Destroy')) crudOps.push('Delete');

            if (crudOps.length > 0) {
                crudOps.push('Detected if applicable');
            }

            return {
                controller: 'Current Handler',
                service: 'Unknown / Not Detected',
                repository: 'Unknown / Not Detected',
                entity: 'Unknown',
                databaseTable: 'Unknown',
                crudOperation: crudOps.length > 0 ? crudOps : ['Unknown']
            };
        }

        extractDependencies(code) {
            const imports = [];
            const externalCalls = [];

            if (code.includes('import (')) {
                const importBlock = code.substring(code.indexOf('import ('), code.indexOf(')'));
                const matches = importBlock.matchAll(/"([^"]+)"/g);
                for (const m of matches) {
                    imports.push(m[1]);
                }
            } else {
                const goImports = code.matchAll(/import\s+["']([^"']+)["']/g);
                for (const match of goImports) {
                    imports.push(match[1]);
                }
            }

            const jsImports = code.matchAll(/(?:import\s+[\s\S]*?\s+from\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\))/g);
            for (const match of jsImports) {
                imports.push(match[1] || match[2]);
            }

            const callMatches = code.matchAll(/([A-Z][a-zA-Z0-9_]+\.[A-Z][a-zA-Z0-9_]+)\s*\(/g);
            for (const match of callMatches) {
                if (!externalCalls.includes(`${match[1]}()`)) {
                    externalCalls.push(`${match[1]}()`);
                }
            }

            return {
                imports: imports.length > 0 ? imports : ['None / Local Code'],
                externalCalls: externalCalls.length > 0 ? externalCalls : ['None / Internal Logic']
            };
        }

        extractFailurePoints(code) {
            const failures = [];

            if (code.includes('db') || code.includes('DB') || code.includes('SELECT') || code.includes('Find') || code.includes('Create') || code.includes('Save')) {
                failures.push('Database Query Failed');
            }

            if (code.includes('err != nil') || code.includes('catch') || code.includes('if err')) {
                failures.push('Execution Error Detected');
            }

            if (code.includes('Bind') || code.includes('validate') || code.includes('body')) {
                failures.push('Request Validation Failed\n(Detected if applicable)');
            }

            if (code.includes('JSON') || code.includes('Marshal') || code.includes('jsonify')) {
                failures.push('Response Serialization Failed\n(Detected if applicable)');
            }

            failures.push('HTTP Contract Mismatch');

            return failures;
        }

        extractExitPaths(code) {
            const success = [];
            const error = [];

            success.push('HTTP Success Response');
            success.push('JSON Response Returned');
            success.push('Client Receives Response');

            error.push('HTTP Error Response');
            error.push('Error Payload Returned');
            error.push('Request Terminated');

            return {
                success,
                error
            };
        }

        formatDebugLir(data) {
            return [
                '==================================================',
                'DEBUG LIR',
                '==================================================',
                '',
                'FILE',
                '',
                data.filePath,
                '',
                'TYPE',
                '',
                data.fileType,
                '',
                'PURPOSE',
                '',
                data.purpose,
                '',
                '==================================================',
                'ENTRY POINTS',
                '==================================================',
                '',
                'HTTP',
                '',
                data.entryPoints.http.join('\n\n'),
                '',
                'CALLED BY',
                '',
                data.entryPoints.calledBy.join('\n\n'),
                '',
                '==================================================',
                'EXECUTION FLOW',
                '==================================================',
                '',
                data.executionFlow.join('\n\n↓\n\n'),
                '',
                '==================================================',
                'READS',
                '==================================================',
                '',
                'Request',
                '',
                data.reads.request.join('\n\n'),
                '',
                'Database',
                '',
                data.reads.database.join('\n\n'),
                '',
                'Environment',
                '',
                data.reads.environment.join('\n\n'),
                '',
                '==================================================',
                'WRITES',
                '==================================================',
                '',
                'HTTP Response',
                '',
                data.writes.httpResponse.join('\n\n'),
                '',
                'Cookie',
                '',
                data.writes.cookie.join('\n\n'),
                '',
                'Logs',
                '',
                data.writes.logs.join('\n\n'),
                '',
                '==================================================',
                'HTTP',
                '==================================================',
                '',
                'REQUEST',
                '',
                data.http.request.join('\n\n'),
                '',
                'BODY',
                '',
                data.http.body.join('\n\n'),
                '',
                'SUCCESS RESPONSE',
                '',
                data.http.successResponse.join('\n\n'),
                '',
                'ERROR RESPONSE',
                '',
                data.http.errorResponse.join('\n\n'),
                '',
                '==================================================',
                'HTTP CONTRACT',
                '==================================================',
                '',
                'METHOD',
                '',
                data.httpContract.method,
                '',
                'ROUTE',
                '',
                data.httpContract.route,
                '',
                'HANDLER',
                '',
                data.httpContract.handler,
                '',
                'CALLER',
                '',
                data.httpContract.caller,
                '',
                'MIDDLEWARE',
                '',
                data.httpContract.middleware,
                '',
                'AUTHENTICATION',
                '',
                data.httpContract.authentication,
                '',
                '==================================================',
                'REQUEST SCHEMA',
                '==================================================',
                '',
                'CONTENT TYPE',
                '',
                data.requestSchema.contentType,
                '',
                'BODY',
                '',
                data.requestSchema.body,
                '',
                'QUERY PARAMS',
                '',
                data.requestSchema.queryParams,
                '',
                'PATH PARAMS',
                '',
                data.requestSchema.pathParams,
                '',
                'HEADERS',
                '',
                data.requestSchema.headers,
                '',
                '==================================================',
                'RESPONSE SCHEMA',
                '==================================================',
                '',
                'CONTENT TYPE',
                '',
                data.responseSchema.contentType,
                '',
                'SUCCESS PAYLOAD',
                '',
                data.responseSchema.successPayload,
                '',
                'FIELDS',
                '',
                data.responseSchema.fields,
                '',
                'STATUS CODE',
                '',
                data.responseSchema.statusCode,
                '',
                'ERROR PAYLOAD',
                '',
                data.responseSchema.errorPayload,
                '',
                'ERROR STATUS',
                '',
                data.responseSchema.errorStatus,
                '',
                '==================================================',
                'ENTITY MAPPING',
                '==================================================',
                '',
                'CONTROLLER',
                '',
                data.entityMapping.controller,
                '',
                'SERVICE',
                '',
                data.entityMapping.service,
                '',
                'REPOSITORY',
                '',
                data.entityMapping.repository,
                '',
                'ENTITY',
                '',
                data.entityMapping.entity,
                '',
                'DATABASE TABLE',
                '',
                data.entityMapping.databaseTable,
                '',
                'CRUD OPERATION',
                '',
                data.entityMapping.crudOperation.join('\n\n'),
                '',
                '==================================================',
                'DEPENDENCIES',
                '==================================================',
                '',
                'Imports',
                '',
                data.dependencies.imports.join('\n\n'),
                '',
                'External Calls',
                '',
                data.dependencies.externalCalls.join('\n\n'),
                '',
                '==================================================',
                'FAILURE POINTS',
                '==================================================',
                '',
                data.failurePoints.join('\n\n↓\n\n'),
                '',
                '==================================================',
                'EXIT PATH',
                '==================================================',
                '',
                'SUCCESS',
                '',
                data.exitPaths.success.join('\n\n↓\n\n'),
                '',
                'ERROR',
                '',
                data.exitPaths.error.join('\n\n↓\n\n'),
                '',
                '=================================================='
            ].join('\n');
        }
    }

    const extractor = new BackendDebugLirExtractor();

    window.LirEngineRegistry.registerStage('backend', async function (ctx) {
        return await extractor.processFiles(ctx.projectFiles, ctx.selectedFiles);
    });
})();
