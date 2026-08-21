export function computeSummary(results) {
    const summary = {
        total: results.length,
        pass: 0,
        fail: 0,
        warn: 0,
        skip: 0,
        byLayer: { transport: 0, jsonrpc: 0, protocol: 0, application: 0 },
        byCategory: {
            connectivity: 0,
            protocol: 0,
            discovery: 0,
            capability: 0,
            behavioral: 0,
            robustness: 0,
            security: 0,
            fuzz: 0,
        },
        byStatus: { pass: 0, fail: 0, warn: 0, skip: 0 },
    };
    for (const result of results) {
        summary.byStatus[result.status] += 1;
        summary.byCategory[result.category] += 1;
        if (result.status === 'fail' && result.error !== undefined) {
            summary.byLayer[result.error.layer] += 1;
        }
    }
    summary.pass = summary.byStatus.pass;
    summary.fail = summary.byStatus.fail;
    summary.warn = summary.byStatus.warn;
    summary.skip = summary.byStatus.skip;
    return summary;
}
//# sourceMappingURL=summary.js.map