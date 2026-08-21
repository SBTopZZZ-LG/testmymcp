import type { ReportFormat, Reporter } from './types.js';
import { terminalReporter } from './terminal.js';
import { jsonReporter } from './json.js';

export function createReporter(format: ReportFormat): Reporter {
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