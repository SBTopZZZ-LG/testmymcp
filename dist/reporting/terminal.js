import { computeSummary } from './summary.js';
const STATUS_GLYPH = {
    pass: '✓',
    fail: '✗',
    warn: '⚠',
    skip: '–',
};
function stripControlChars(text) {
    return text
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .replace(/\u001b/g, '')
        .replace(/\u009b/g, '')
        .replace(/\u009d/g, '');
}
function sanitize(text) {
    return stripControlChars(text.replace(/\s+/g, ' ').trim());
}
function formatDuration(ms) {
    if (ms >= 1000)
        return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
}
function metaLine(meta) {
    if (meta === undefined)
        return '';
    const parts = [];
    if (meta.protocol !== undefined) {
        parts.push(`Protocol ${meta.protocol}${meta.protocolEra !== undefined ? ` (${meta.protocolEra})` : ''}`);
    }
    if (meta.transport !== undefined)
        parts.push(`Transport ${meta.transport}`);
    if (meta.serverName !== undefined) {
        parts.push(`Server ${meta.serverName}${meta.serverVersion !== undefined ? ` ${meta.serverVersion}` : ''}`);
    }
    return parts.join('   ');
}
export function renderTerminal(results, meta) {
    const summary = computeSummary(results);
    const lines = ['testmymcp', '─'.repeat(40)];
    const metaText = metaLine(meta);
    if (metaText !== '')
        lines.push(metaText);
    for (const result of results) {
        const glyph = STATUS_GLYPH[result.status] ?? '?';
        const message = result.status === 'fail' && result.error !== undefined
            ? `${sanitize(result.error.message)} (${result.error.layer}${result.error.code !== undefined ? ` ${result.error.code}` : ''})`
            : result.status === 'warn'
                ? sanitize(result.warnings?.[0] ?? '')
                : '';
        lines.push(` ${glyph} ${result.id.padEnd(46)} ${message.padEnd(36)} ${formatDuration(result.durationMs).padStart(7)}`);
    }
    lines.push('', 'Failure layers');
    for (const [layer, count] of Object.entries(summary.byLayer)) {
        lines.push(`  ${layer.padEnd(14)} ${count}`);
    }
    const verdict = summary.fail > 0 ? 'FAIL' : summary.warn > 0 ? 'WARN' : 'PASS';
    lines.push('', `Verdict: ${verdict}  ${summary.pass} pass, ${summary.fail} fail, ${summary.warn} warn, ${summary.skip} skip`);
    return lines.join('\n') + '\n';
}
export const terminalReporter = {
    format: 'terminal',
    render: renderTerminal,
};
//# sourceMappingURL=terminal.js.map