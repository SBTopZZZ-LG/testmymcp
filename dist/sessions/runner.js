import { protocolAdapterFactory } from '../core/protocol/factory.js';
import { TraceStore } from '../core/tracing/store.js';
import { TestEngine } from '../engine/engine.js';
import { defaultRunOptions } from '../engine/options.js';
import { LegacySseTransport, StreamableHttpTransport } from '../transports/http/index.js';
import { StdioTransport } from '../transports/stdio/index.js';
const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const SHUTDOWN_TIMEOUT_MS = 5000;
const INIT_TIMEOUT_MS = 15_000;
export function buildSession(target, options) {
    const trace = new TraceStore({ showSecrets: options.showSecrets ?? false });
    const shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
    const requestTimeoutMs = options.timeoutMs;
    if (target.transport === 'stdio') {
        const transport = new StdioTransport({
            command: target.command,
            maxLineBytes: target.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
            shutdownTimeoutMs,
            env: target.env,
        });
        const era = target.era ?? 'legacy';
        const adapter = protocolAdapterFactory.create(era, {
            transport,
            trace,
            requestTimeoutMs,
            initTimeoutMs: Math.min(requestTimeoutMs, INIT_TIMEOUT_MS),
            shutdownTimeoutMs,
            preferVersion: target.version,
            extensions: options.extensions,
        });
        wireObserver(transport, adapter);
        return { transport, adapter, trace, era };
    }
    const era = target.era ?? 'legacy';
    const defaultedVersion = target.version ?? (era === 'modern' ? '2026-07-28' : '2025-11-25');
    const auth = target.auth ?? { mode: 'none' };
    const transport = target.httpTransport === 'legacy-sse'
        ? new LegacySseTransport({ url: target.url, auth, requestTimeoutMs })
        : new StreamableHttpTransport({
            url: target.url,
            auth,
            accept: target.accept ?? 'json',
            protocolVersion: defaultedVersion,
            era,
            requestTimeoutMs,
        });
    const adapter = protocolAdapterFactory.create(era, {
        transport,
        trace,
        requestTimeoutMs,
        initTimeoutMs: Math.min(requestTimeoutMs, INIT_TIMEOUT_MS),
        shutdownTimeoutMs,
        preferVersion: defaultedVersion,
        extensions: options.extensions,
    });
    wireObserver(transport, adapter);
    return { transport, adapter, trace, era };
}
export async function runTarget(target, preferences) {
    const runOptions = defaultRunOptions({
        mode: preferences.mode,
        maxLevel: preferences.level,
        defaultTimeoutMs: preferences.timeoutMs,
        maxSchemaBytes: preferences.maxSchemaBytes,
    });
    const { transport, adapter, trace, era } = buildSession(target, {
        timeoutMs: preferences.timeoutMs,
        showSecrets: preferences.showSecrets,
        extensions: preferences.extensions,
    });
    const engine = new TestEngine({ adapter, transport, trace, options: runOptions });
    const startedAt = Date.now();
    let results;
    try {
        results = await engine.run();
    }
    finally {
        try {
            await engine.dispose();
        }
        catch {
            // best-effort teardown
        }
    }
    const session = engine.shared.session;
    const meta = {
        protocol: session?.protocolVersion ?? defaultVersion(target, era),
        protocolEra: session !== undefined
            ? session.protocolVersion === '2026-07-28'
                ? 'modern'
                : 'legacy'
            : era,
        transport: target.transport === 'http' ? target.httpTransport : 'stdio',
        startedAt,
        durationMs: Date.now() - startedAt,
        command: target.transport === 'http' ? target.url : target.command,
        serverName: session?.serverInfo.name,
        serverVersion: session?.serverInfo.version,
    };
    return { results, meta };
}
export async function probeTarget(target, options) {
    const { adapter } = buildSession(target, options);
    try {
        await adapter.connect();
        return await adapter.initialize();
    }
    finally {
        try {
            await adapter.shutdown();
        }
        catch {
            // best-effort teardown
        }
    }
}
function defaultVersion(target, era) {
    if (target.transport === 'stdio')
        return target.version;
    return target.version ?? (era === 'modern' ? '2026-07-28' : '2025-11-25');
}
function wireObserver(transport, adapter) {
    transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
}
//# sourceMappingURL=runner.js.map