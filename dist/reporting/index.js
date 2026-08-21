import { createJsonReporter, jsonReporter } from './json.js';
import { terminalReporter } from './terminal.js';
export function createReporter(format, options = {}) {
    switch (format) {
        case 'json':
            return options.stripEvidence === true ? createJsonReporter(options) : jsonReporter;
        case 'terminal':
            return terminalReporter;
    }
}
export * from './types.js';
export * from './summary.js';
export * from './terminal.js';
export * from './json.js';
//# sourceMappingURL=index.js.map