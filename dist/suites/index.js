import { runBehavioralSuite } from './behavioral.js';
import { runCapabilitySuite } from './capability.js';
import { runConnectivitySuite } from './connectivity.js';
import { runDiscoverySuite } from './discovery.js';
import { runModernProtocolSuite } from './protocol-modern.js';
import { runProtocolSuite } from './protocol.js';
import { runRobustnessSuite } from './robustness.js';
export const SUITES = [
    { name: 'connectivity', level: 0, run: runConnectivitySuite },
    {
        name: 'protocol',
        level: 1,
        run: (ctx) => (ctx.era === 'modern' ? runModernProtocolSuite(ctx) : runProtocolSuite(ctx)),
    },
    { name: 'discovery', level: 2, run: runDiscoverySuite },
    { name: 'capability', level: 3, run: runCapabilitySuite },
    { name: 'behavioral', level: 4, run: runBehavioralSuite },
    { name: 'robustness', level: 5, run: runRobustnessSuite },
];
export function selectSuites(maxLevel) {
    return SUITES.filter((suite) => suite.level <= maxLevel).sort((a, b) => a.level - b.level);
}
//# sourceMappingURL=index.js.map