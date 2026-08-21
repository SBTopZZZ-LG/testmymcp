import type { ToolDefinition } from '../primitives/types.js';

export type ToolRisk = 'safe' | 'readonly' | 'destructive';

const DESTRUCTIVE_WORDS = [
  'delete', 'destroy', 'drop', 'truncate', 'purge', 'wipe', 'remove', 'unlink', 'kill',
  'exec', 'execute', 'run', 'shell', 'command', 'script', 'deploy', 'publish', 'release',
  'send', 'email', 'mail', 'transfer', 'pay', 'purchase', 'buy', 'order', 'create', 'new',
  'write', 'update', 'put', 'post', 'comment', 'upload', 'download', 'stop', 'start',
  'restart', 'reboot', 'shutdown', 'format', 'block', 'ban', 'revoke', 'add', 'set',
  'configure', 'install', 'uninstall', 'reset', 'clear', 'save', 'submit', 'commit',
  'push', 'merge', 'apply', 'trigger', 'invoke', 'call', 'post', 'insert', 'append',
  'overwrite', 'replace', 'rename', 'move', 'copy', 'chmod', 'chown', 'task', 'agent',
];

const READONLY_WORDS = [
  'list', 'get', 'read', 'fetch', 'search', 'query', 'find', 'info', 'status', 'describe',
  'show', 'peek', 'check', 'stat', 'inspect', 'lookup', 'view', 'scan', 'count', 'diff',
  'head', 'tail', 'cat', 'print', 'help', 'version', 'ping', 'health', 'schema', 'metadata',
];

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasAnyWord(text: string, words: readonly string[]): boolean {
  const tokens = new Set(wordsOf(text));
  return words.some((word) => tokens.has(word));
}

export function classifyTool(tool: ToolDefinition): ToolRisk {
  const text = `${tool.name} ${tool.description ?? ''}`;
  if (hasAnyWord(text, DESTRUCTIVE_WORDS)) return 'destructive';
  if (hasAnyWord(text, READONLY_WORDS)) return 'readonly';
  return 'safe';
}

export type ToolExecutionMode = 'safe' | 'readonly' | 'all';

export function executionDecision(risk: ToolRisk, mode: ToolExecutionMode): { run: boolean; reason?: string } {
  switch (mode) {
    case 'all':
      return { run: true };
    case 'readonly':
      return risk === 'destructive' ? { run: false, reason: 'destructive tool excluded by --mode=readonly' } : { run: true };
    case 'safe':
      return risk === 'safe' ? { run: true } : { run: false, reason: `tool classified "${risk}" excluded by --mode=safe` };
  }
}