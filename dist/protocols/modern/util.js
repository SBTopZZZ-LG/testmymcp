export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function asRecord(value) {
    return isRecord(value) ? value : undefined;
}
//# sourceMappingURL=util.js.map