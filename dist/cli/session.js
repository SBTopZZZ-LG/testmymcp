import { redactDeep } from '../core/tracing/redaction.js';
import { createReporter } from '../reporting/index.js';
import { computeSummary } from '../reporting/summary.js';
import { parseEnvEntries } from '../sessions/env.js';
import { SessionStore, deriveSessionId } from '../sessions/index.js';
import { probeTarget, runTarget } from '../sessions/index.js';
import { expandStoredTarget, sanitizeToStoredTarget } from '../sessions/index.js';
import { parseEra, parseHttpAccept, parseHttpTransport, parseLevel, parseMode, parseProtocolVersion, } from './parse.js';
function describeTarget(session) {
    if (session.target.transport === 'stdio')
        return `stdio: ${session.target.command}`;
    return `${session.target.httpTransport}: ${session.target.url}${session.requiresToken ? ' (token)' : ''}`;
}
function printSessionRow(session) {
    const name = session.name !== undefined ? `${session.name} ` : '';
    const server = session.serverName !== undefined ? ` [${session.serverName}]` : '';
    console.log(`  ${session.id}  ${name}${describeTarget(session)}${server}`);
}
export function registerSessionCommands(program) {
    const session = program.command('session').description('manage persistent MCP sessions');
    session
        .command('create <target>')
        .description('connect to an MCP server and persist it as a reusable session')
        .option('--transport <transport>', 'stdio, streamable-http or legacy-sse', 'stdio')
        .option('--name <name>', 'optional friendly alias for the session')
        .option('--era <era>', 'protocol era: legacy or modern')
        .option('--protocol-version <version>', 'preferred protocol version (e.g. 2026-07-28)')
        .option('--token <token>', 'bearer token for Authorization header')
        .option('--env <key=value>', 'env var for a stdio server child (repeatable)', collectEnv, [])
        .option('--accept <format>', 'HTTP response format to request (json or sse)')
        .option('--max-line-size <bytes>', 'maximum server output line size in bytes', '1048576')
        .option('--timeout <ms>', 'connection/initialize timeout in milliseconds', '30000')
        .action(createAction);
    session.command('list').description('list persisted sessions').action(listAction);
    session
        .command('show <id>')
        .description('show details for a persisted session (credentials redacted)')
        .action(showAction);
    session
        .command('dispose <id>')
        .description('remove a persisted session and its stored credential')
        .action(disposeAction);
    program
        .command('test <id>')
        .description('run the conformance suites against a persisted session')
        .option('--mode <mode>', 'tool execution policy: safe, readonly, all', 'safe')
        .option('--level <n>', 'highest test level to run (0-7, default 3)', '3')
        .option('--json', 'emit a machine-readable JSON report')
        .option('--timeout <ms>', 'overall test timeout in milliseconds', '30000')
        .option('--token <token>', 'bearer token to use with the persisted session')
        .option('--env <key=value>', 'secret env var for a stdio child (repeatable)', collectEnv, [])
        .option('--show-secrets', 'disable redaction of sensitive values in traces')
        .action(testAction);
}
function collectEnv(value, previous) {
    return previous.concat([value]);
}
async function createAction(targetArg, commandOptions) {
    try {
        const store = new SessionStore();
        const era = commandOptions.era !== undefined ? parseEra(commandOptions.era) : undefined;
        const version = commandOptions.protocolVersion !== undefined
            ? parseProtocolVersion(commandOptions.protocolVersion)
            : undefined;
        const timeoutMs = Number.parseInt(commandOptions.timeout ?? '30000', 10) || 30000;
        const name = commandOptions.name !== undefined ? commandOptions.name : undefined;
        const transportArg = commandOptions.transport ?? 'stdio';
        let target;
        if (transportArg === 'stdio') {
            target = {
                transport: 'stdio',
                command: targetArg,
                era,
                version,
                maxLineBytes: Number.parseInt(commandOptions.maxLineSize ?? '1048576', 10) || undefined,
                env: parseEnvEntries(commandOptions.env),
            };
        }
        else {
            const httpTransport = parseHttpTransport(transportArg);
            const auth = commandOptions.token !== undefined
                ? { mode: 'bearer', token: commandOptions.token }
                : { mode: 'none' };
            target = {
                transport: 'http',
                url: targetArg,
                httpTransport,
                auth,
                era,
                version,
                accept: parseHttpAccept(commandOptions.accept),
            };
        }
        const id = deriveSessionId(target);
        const { target: storedTarget, requiresToken, requiresSecretEnv, } = sanitizeToStoredTarget(target);
        if (name !== undefined) {
            const existing = (await store.list(false)).find((session) => session.name === name && session.id !== id);
            if (existing !== undefined) {
                console.error(`testmymcp: a session already uses the name "${name}" (${existing.id})`);
                process.exitCode = 2;
                return;
            }
        }
        let negotiated;
        try {
            negotiated = await probeTarget(target, { timeoutMs, showSecrets: true });
        }
        catch (error) {
            console.error(`testmymcp: could not establish ${id}: ${error instanceof Error ? error.message : String(error)}`);
            process.exitCode = 2;
            return;
        }
        const now = Date.now();
        const record = {
            id,
            name,
            createdAt: now,
            lastUsedAt: now,
            target: storedTarget,
            requiresToken,
            requiresSecretEnv,
            serverName: negotiated.serverInfo.name,
            serverVersion: negotiated.serverInfo.version,
            protocolVersion: negotiated.protocolVersion,
        };
        await store.create(record);
        console.log(`created session ${id}`);
        if (name !== undefined)
            console.log(`  alias: ${name}`);
        console.log(`  ${describeTarget(record)}`);
        if (record.serverName !== undefined)
            console.log(`  server: ${record.serverName} ${record.serverVersion ?? ''}`.trim());
        if (record.protocolVersion !== undefined)
            console.log(`  protocol: ${record.protocolVersion}`);
        if (record.requiresToken)
            console.log('  note: bearer token required; pass --token on `test`');
        if (record.requiresSecretEnv)
            console.log('  note: secret env vars redacted; pass --env KEY=... on `test`');
    }
    catch (error) {
        console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
async function listAction() {
    try {
        const store = new SessionStore();
        const sessions = await store.list();
        if (sessions.length === 0) {
            console.log('no sessions');
            process.exitCode = 0;
            return;
        }
        console.log(`${sessions.length} session${sessions.length === 1 ? '' : 's'}:`);
        for (const session of sessions)
            printSessionRow(session);
    }
    catch (error) {
        console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
async function showAction(idOrName) {
    try {
        const store = new SessionStore();
        const session = await store.get(idOrName);
        if (session === undefined) {
            console.error(`testmymcp: no session "${idOrName}"`);
            process.exitCode = 1;
            return;
        }
        console.log(`id: ${session.id}`);
        if (session.name !== undefined)
            console.log(`name: ${session.name}`);
        console.log(`created: ${new Date(session.createdAt).toISOString()}`);
        console.log(`last used: ${new Date(session.lastUsedAt).toISOString()}`);
        if (session.serverName !== undefined)
            console.log(`server: ${session.serverName} ${session.serverVersion ?? ''}`.trim());
        if (session.protocolVersion !== undefined)
            console.log(`protocol: ${session.protocolVersion}`);
        if (session.requiresToken)
            console.log('requires token: yes');
        console.log('target:');
        console.log(`  ${JSON.stringify(redactDeep(session.target), null, 2).replace(/\n/g, '\n  ')}`);
    }
    catch (error) {
        console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
async function disposeAction(idOrName) {
    try {
        const store = new SessionStore();
        const removed = await store.remove(idOrName);
        if (removed === undefined) {
            console.error(`testmymcp: no session "${idOrName}"`);
            process.exitCode = 1;
            return;
        }
        console.log(`disposed session ${removed.id}`);
    }
    catch (error) {
        console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
async function testAction(idOrName, commandOptions) {
    try {
        const store = new SessionStore();
        const session = await store.get(idOrName);
        if (session === undefined) {
            console.error(`testmymcp: no session "${idOrName}"`);
            process.exitCode = 1;
            return;
        }
        const token = commandOptions.token !== undefined ? commandOptions.token : undefined;
        const secretEnv = parseEnvEntries(commandOptions.env);
        if (session.requiresToken && token === undefined) {
            console.error(`testmymcp: session ${session.id} requires a bearer token; pass --token`);
            process.exitCode = 2;
            return;
        }
        const target = expandStoredTarget(session.target, token, secretEnv);
        await store.touch(session.id).catch(() => undefined);
        const { results, meta } = await runTarget(target, {
            mode: parseMode(commandOptions.mode ?? 'safe'),
            level: parseLevel(commandOptions.level ?? '3'),
            timeoutMs: Number.parseInt(commandOptions.timeout ?? '30000', 10) || 30000,
            showSecrets: Boolean(commandOptions.showSecrets),
        });
        const summary = computeSummary(results);
        const reporter = createReporter(commandOptions.json !== undefined ? 'json' : 'terminal');
        process.stdout.write(reporter.render(results, meta));
        process.exitCode = summary.fail > 0 ? 1 : 0;
    }
    catch (error) {
        console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
//# sourceMappingURL=session.js.map