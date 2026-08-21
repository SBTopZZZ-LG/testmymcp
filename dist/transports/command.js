function tokenize(input) {
    const tokens = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = pattern.exec(input)) !== null) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        if (value !== '')
            tokens.push(value);
    }
    return tokens;
}
export function parseServerCommand(input) {
    const tokens = tokenize(input.trim());
    const command = tokens[0];
    if (command === undefined) {
        throw new Error('empty server command');
    }
    const shell = /\.(cmd|bat)$/i.test(command);
    return { command, args: tokens.slice(1), shell };
}
//# sourceMappingURL=command.js.map