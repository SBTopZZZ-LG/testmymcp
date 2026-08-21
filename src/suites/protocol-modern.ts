import { eraOfVersion, isProtocolVersion } from '../core/types/protocol.js';
import { TestLevel, type TestResult } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
import { fromError, pass, warn } from '../engine/result.js';

/**
 * Modern (2026-07-28) protocol suite. There is no `initialize` handshake: the
 * adapter performs `server/discover`; we validate the discover result, the
 * per-request `_meta` contract, version handling, and statelessness.
 *
 * Note: the adapter pins `_meta.protocolVersion` to its preferred version on
 * every request, so unsupported-version rejection is exercised through the
 * adapter/transport path (a server that rejects the version fails `discover`),
 * not by racing a bogus version through `_meta` here.
 */
export async function runModernProtocolSuite(ctx: SuiteContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const transport = ctx.transport;

  if (ctx.observed.exit !== null) {
    results.push(
      fromError(
        'protocol process-alive',
        'protocol',
        TestLevel.Protocol,
        new Error(`server exited during testing`),
        'transport',
        {
          transport,
          durationMs: 0,
          evidence: {
            code: ctx.observed.exit.code,
            signal: ctx.observed.exit.signal ?? 'none',
          },
        },
      ),
    );
    return results;
  }

  const discoverStarted = ctx.now();
  let session;
  try {
    session = await ctx.adapter.initialize();
  } catch (error) {
    results.push(
      fromError('protocol discover', 'protocol', TestLevel.Protocol, error, 'protocol', {
        transport,
        durationMs: ctx.now() - discoverStarted,
      }),
    );
    results.push(
      warn(
        'protocol remaining-skipped',
        'protocol',
        TestLevel.Protocol,
        'skipped because server/discover failed',
        {
          transport,
          durationMs: 0,
        },
      ),
    );
    return results;
  }
  ctx.shared.session = session;

  results.push(
    pass('protocol discover', 'protocol', TestLevel.Protocol, {
      protocol: session.protocolVersion,
      protocolEra: 'modern',
      transport,
      durationMs: ctx.now() - discoverStarted,
      evidence: { protocolVersion: session.protocolVersion, serverName: session.serverInfo.name },
    }),
  );

  if (
    !isProtocolVersion(session.protocolVersion) ||
    eraOfVersion(session.protocolVersion) === null
  ) {
    results.push(
      warn(
        'protocol version-known',
        'protocol',
        TestLevel.Protocol,
        `server advertised unknown protocol version "${session.protocolVersion}"`,
        {
          protocol: session.protocolVersion,
          transport,
          durationMs: 0,
        },
      ),
    );
  } else {
    results.push(
      pass('protocol version-known', 'protocol', TestLevel.Protocol, {
        protocol: session.protocolVersion,
        transport,
        durationMs: 0,
      }),
    );
  }

  if (session.serverCapabilities.raw !== undefined) {
    results.push(
      pass('protocol capabilities', 'protocol', TestLevel.Protocol, {
        protocol: session.protocolVersion,
        transport,
        durationMs: 0,
        evidence: session.serverCapabilities.raw,
      }),
    );
  } else {
    results.push(
      warn(
        'protocol capabilities',
        'protocol',
        TestLevel.Protocol,
        'server did not advertise any capabilities',
        {
          protocol: session.protocolVersion,
          transport,
          durationMs: 0,
        },
      ),
    );
  }

  // Version negotiation is exercised through the adapter/transport: a modern
  // server that rejects the requested version fails `server/discover` with
  // UnsupportedProtocolVersionError (-32022), which the adapter surfaces.

  if (ctx.observed.garbageLines.length > 0) {
    results.push(
      fromError(
        'protocol stdout-framing',
        'protocol',
        TestLevel.Protocol,
        new Error(`output on stdout is not valid JSON-RPC`),
        'transport',
        {
          transport,
          durationMs: 0,
          evidence: ctx.observed.garbageLines.slice(0, 5),
        },
      ),
    );
  } else {
    results.push(
      pass('protocol stdout-framing', 'protocol', TestLevel.Protocol, { transport, durationMs: 0 }),
    );
  }

  return results;
}
