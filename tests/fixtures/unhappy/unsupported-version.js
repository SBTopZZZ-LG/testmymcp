// Unhappy fixture (modern HTTP): rejects every request with
// UnsupportedProtocolVersionError (-32022), including server/discover.
import { argsOf, listen, makeError, MODERN_VERSION } from '../helpers/http.js';

listen({
  port: argsOf().port,
  version: MODERN_VERSION,
  name: 'unsupported',
  handler: ({ message }) => {
    if (message.id === undefined) return null;
    return makeError(message, -32022, 'Unsupported protocol version');
  },
});
