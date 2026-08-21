import { computeSummary } from './summary.js';
export function buildJsonReport(results, meta = {}) {
    const errors = [];
    const warnings = [];
    for (const result of results) {
        if (result.status === 'fail' && result.error !== undefined) {
            errors.push(`${result.id}: [${result.error.layer}] ${result.error.message}${result.error.code !== undefined ? ` (${result.error.code})` : ''}`);
        }
        if (result.warnings !== undefined) {
            warnings.push(...result.warnings.map((warning) => `${result.id}: ${warning}`));
        }
    }
    return {
        tool: 'testmymcp',
        schemaVersion: '1.0',
        meta,
        summary: computeSummary(results),
        tests: [...results],
        errors,
        warnings,
    };
}
export const jsonReporter = {
    format: 'json',
    render: (results, meta) => JSON.stringify(buildJsonReport(results, meta), null, 2) + '\n',
};
//# sourceMappingURL=json.js.map