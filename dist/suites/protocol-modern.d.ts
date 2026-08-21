import { type TestResult } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
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
export declare function runModernProtocolSuite(ctx: SuiteContext): Promise<TestResult[]>;
