// Unhappy fixture (modern HTTP): accepts server/discover, but rejects every
// other method with MissingRequiredClientCapabilityError (-32021) unless the
// client advertises the `elicitation` capability it requires.
import { argsOf, listen, makeError, makeResult, MODERN_VERSION } from '../helpers/http.js';

listen({
  port: argsOf().port,
  version: MODERN_VERSION,
  name: 'requires-cap',
  handler: ({ message }) => {
    if (message.id === undefined) return null;
    if (message.method === 'server/discover') {
      return makeResult(message, {
        resultType: 'complete',
        supportedVersions: [MODERN_VERSION],
        capabilities: { tools: {}, extensions: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'requires-cap', version: '1.0.0' } },
      });
    }
    const meta = message.params?._meta;
    const caps = meta?.['io.modelcontextprotocol/clientCapabilities'];
    if (!caps || typeof caps !== 'object' || !caps.elicitation) {
      return makeError(message, -32021, 'Missing required client capability');
    }
    if (message.method === 'tools/list') return makeResult(message, { resultType: 'complete', tools: [] });
    return makeResult(message, { resultType: 'complete' });
  },
});
