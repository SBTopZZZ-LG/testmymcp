import { computeSummary } from './summary.js';
function withOmittedPayloads(result) {
    const { evidence: _evidence, request: _request, response: _response, ...rest } = result;
    return rest;
}
export function buildJsonReport(results, meta = {}, options = {}) {
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
    const tests = [...results];
    if (options.stripEvidence === true) {
        for (let i = 0; i < tests.length; i += 1) {
            tests[i] = withOmittedPayloads(tests[i]);
        }
    }
    return {
        tool: 'testmymcp',
        schemaVersion: '1.0',
        meta,
        summary: computeSummary(results),
        tests,
        errors,
        warnings,
    };
}
export function createJsonReporter(options = {}) {
    return {
        format: 'json',
        render: (results, meta) => JSON.stringify(buildJsonReport(results, meta, options), null, 2) + '\n',
    };
}
export const jsonReporter = createJsonReporter();
//# sourceMappingURL=json.js.map