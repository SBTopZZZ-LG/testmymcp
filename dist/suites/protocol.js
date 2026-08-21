import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import { emptyClientCapabilities } from '../core/protocol/capabilities.js';
import { eraOfVersion, isProtocolVersion } from '../core/types/protocol.js';
import { TestLevel } from '../core/types/test-result.js';
import { fail, fromError, pass, warn } from '../engine/result.js';
import { buildInitializeParams } from '../protocols/legacy/initialize.js';
const UNKNOWN_VERSION_PROBE = '2099-01-01';
export async function runProtocolSuite(ctx) {
    const results = [];
    const transport = ctx.transport;
    const requestTimeout = ctx.options.requestTimeoutMs ?? ctx.options.defaultTimeoutMs;
    if (ctx.observed.exit !== null) {
        const exit = ctx.observed.exit;
        results.push(fail('protocol process-alive', 'protocol', TestLevel.Protocol, 'transport', 'spawn', `server exited during testing (code ${exit.code}, signal ${exit.signal ?? 'none'})`, { transport, durationMs: 0 }));
        return results;
    }
    const initStarted = ctx.now();
    let session;
    try {
        session = await ctx.adapter.initialize({ skipInitialized: true });
    }
    catch (error) {
        results.push(fromError('protocol initialize', 'protocol', TestLevel.Protocol, error, 'protocol', {
            transport,
            durationMs: ctx.now() - initStarted,
        }));
        results.push(warn('protocol remaining-skipped', 'protocol', TestLevel.Protocol, 'skipped because initialize failed', {
            transport,
            durationMs: 0,
        }));
        return results;
    }
    ctx.shared.session = session;
    results.push(pass('protocol initialize', 'protocol', TestLevel.Protocol, {
        protocol: session.protocolVersion,
        protocolEra: 'legacy',
        transport,
        durationMs: ctx.now() - initStarted,
        evidence: { protocolVersion: session.protocolVersion, serverName: session.serverInfo.name },
    }));
    if (session.negotiated) {
        results.push(warn('protocol version-negotiation', 'protocol', TestLevel.Protocol, `server negotiated ${session.protocolVersion}; client claimed ${session.claimedVersion ?? 'unknown'}`, { protocol: session.protocolVersion, transport, durationMs: 0 }));
    }
    else {
        results.push(pass('protocol version-negotiation', 'protocol', TestLevel.Protocol, {
            protocol: session.protocolVersion,
            transport,
            durationMs: 0,
        }));
    }
    if (!isProtocolVersion(session.protocolVersion) ||
        eraOfVersion(session.protocolVersion) === null) {
        results.push(fail('protocol version-known', 'protocol', TestLevel.Protocol, 'protocol', 'version', `server returned unknown protocol version "${session.protocolVersion}"`, { protocol: session.protocolVersion, transport, durationMs: 0 }));
    }
    else {
        results.push(pass('protocol version-known', 'protocol', TestLevel.Protocol, {
            protocol: session.protocolVersion,
            transport,
            durationMs: 0,
        }));
    }
    if (session.serverInfo.name !== undefined) {
        results.push(pass('protocol server-info', 'protocol', TestLevel.Protocol, {
            protocol: session.protocolVersion,
            transport,
            durationMs: 0,
            evidence: session.serverInfo,
        }));
    }
    else {
        results.push(warn('protocol server-info', 'protocol', TestLevel.Protocol, 'server did not identify itself (serverInfo.name missing)', {
            protocol: session.protocolVersion,
            transport,
            durationMs: 0,
        }));
    }
    if (session.serverCapabilities.raw !== undefined) {
        results.push(pass('protocol capabilities', 'protocol', TestLevel.Protocol, {
            protocol: session.protocolVersion,
            transport,
            durationMs: 0,
            evidence: session.serverCapabilities.raw,
        }));
    }
    else {
        results.push(warn('protocol capabilities', 'protocol', TestLevel.Protocol, 'server did not advertise any capabilities', {
            protocol: session.protocolVersion,
            transport,
            durationMs: 0,
        }));
    }
    const paramsFor = (version) => {
        const base = buildInitializeParams({
            protocolVersion: session.protocolVersion,
            clientInfo: session.clientInfo,
            clientCapabilities: emptyClientCapabilities(),
        });
        return { ...base, protocolVersion: version };
    };
    const preStarted = ctx.now();
    try {
        const list = await ctx.adapter.request('tools/list', undefined, requestTimeout);
        results.push(warn('protocol pre-initialized-traffic', 'protocol', TestLevel.Protocol, 'server accepted tools/list before receiving the initialized notification', { transport, durationMs: ctx.now() - preStarted, evidence: list }));
    }
    catch (error) {
        if (error instanceof JsonRpcRemoteError) {
            results.push(pass('protocol pre-initialized-traffic', 'protocol', TestLevel.Protocol, {
                transport,
                durationMs: ctx.now() - preStarted,
                warnings: ['server rejected traffic before initialized (expected)'],
                evidence: { code: error.code, message: error.message },
            }));
        }
        else {
            results.push(fromError('protocol pre-initialized-traffic', 'protocol', TestLevel.Protocol, error, 'transport', {
                transport,
                durationMs: ctx.now() - preStarted,
            }));
        }
    }
    await ctx.adapter.notify('notifications/initialized');
    const dupStarted = ctx.now();
    try {
        const duplicate = await ctx.adapter.request('initialize', paramsFor(session.claimedVersion ?? session.protocolVersion), requestTimeout);
        results.push(pass('protocol duplicate-initialize', 'protocol', TestLevel.Protocol, {
            transport,
            durationMs: ctx.now() - dupStarted,
            evidence: duplicate,
        }));
    }
    catch (error) {
        results.push(error instanceof JsonRpcRemoteError
            ? pass('protocol duplicate-initialize', 'protocol', TestLevel.Protocol, {
                transport,
                durationMs: ctx.now() - dupStarted,
                warnings: ['server rejected duplicate initialize'],
                evidence: { code: error.code, message: error.message },
            })
            : fromError('protocol duplicate-initialize', 'protocol', TestLevel.Protocol, error, 'transport', {
                transport,
                durationMs: ctx.now() - dupStarted,
            }));
    }
    const bogusStarted = ctx.now();
    try {
        const bogus = await ctx.adapter.request('initialize', paramsFor(UNKNOWN_VERSION_PROBE), requestTimeout);
        results.push(warn('protocol unsupported-version', 'protocol', TestLevel.Protocol, `server did not reject an unknown protocol version (${UNKNOWN_VERSION_PROBE})`, { transport, durationMs: ctx.now() - bogusStarted, evidence: bogus }));
    }
    catch (error) {
        if (error instanceof JsonRpcRemoteError) {
            results.push(pass('protocol unsupported-version', 'protocol', TestLevel.Protocol, {
                transport,
                durationMs: ctx.now() - bogusStarted,
                warnings: ['server rejected unknown protocol version'],
                evidence: { code: error.code, message: error.message },
            }));
        }
        else {
            results.push(fromError('protocol unsupported-version', 'protocol', TestLevel.Protocol, error, 'transport', {
                transport,
                durationMs: ctx.now() - bogusStarted,
            }));
        }
    }
    if (ctx.observed.garbageLines.length > 0) {
        results.push(fail('protocol stdout-framing', 'protocol', TestLevel.Protocol, 'transport', 'framing', `output on stdout is not valid JSON-RPC (${ctx.observed.garbageLines.length} malformed line(s))`, { transport, durationMs: 0, evidence: ctx.observed.garbageLines.slice(0, 5) }));
    }
    else {
        results.push(pass('protocol stdout-framing', 'protocol', TestLevel.Protocol, { transport, durationMs: 0 }));
    }
    if (ctx.observed.oversize.length > 0) {
        results.push(warn('protocol line-size', 'protocol', TestLevel.Protocol, `${ctx.observed.oversize.length} line(s) exceeded the configured line size limit`, { transport, durationMs: 0, evidence: ctx.observed.oversize }));
    }
    return results;
}
//# sourceMappingURL=protocol.js.map