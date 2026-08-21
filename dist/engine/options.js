import { TestLevel } from '../core/types/test-result.js';
export function defaultRunOptions(overrides = {}) {
    return {
        mode: 'safe',
        maxLevel: TestLevel.Capability,
        defaultTimeoutMs: 30_000,
        ...overrides,
    };
}
//# sourceMappingURL=options.js.map