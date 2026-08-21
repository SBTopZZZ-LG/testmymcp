import { jsonReporter } from './json.js';
import { terminalReporter } from './terminal.js';
export function createReporter(format) {
    switch (format) {
        case 'json':
            return jsonReporter;
        case 'terminal':
            return terminalReporter;
    }
}
export * from './types.js';
export * from './summary.js';
export * from './terminal.js';
export * from './json.js';
//# sourceMappingURL=index.js.map