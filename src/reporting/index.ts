import { createJsonReporter, jsonReporter } from './json.js';
import { terminalReporter } from './terminal.js';
import type { ReportFormat, ReportOptions, Reporter } from './types.js';

export function createReporter(format: ReportFormat, options: ReportOptions = {}): Reporter {
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
