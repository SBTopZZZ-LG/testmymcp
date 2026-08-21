import { describe, expect, it } from 'vitest';

import { classifyTool, executionDecision } from '../../src/core/tools/safety.js';

describe('tool safety classification', () => {
  it('flags destructive tools', () => {
    expect(classifyTool({ name: 'delete_file', description: 'delete a file' })).toBe('destructive');
    expect(classifyTool({ name: 'send_email' })).toBe('destructive');
    expect(classifyTool({ name: 'deploy_prod' })).toBe('destructive');
    expect(classifyTool({ name: 'transfer_money' })).toBe('destructive');
  });

  it('recognizes read-only tools', () => {
    expect(classifyTool({ name: 'list_files' })).toBe('readonly');
    expect(classifyTool({ name: 'get_issue', description: 'fetch an issue' })).toBe('readonly');
  });

  it('defaults ambiguous tools to safe', () => {
    expect(classifyTool({ name: 'calculate' })).toBe('safe');
    expect(classifyTool({ name: 'sum' })).toBe('safe');
    expect(classifyTool({ name: 'concat_strings' })).toBe('safe');
  });

  it('applies execution policy by mode', () => {
    expect(executionDecision('safe', 'safe').run).toBe(true);
    expect(executionDecision('readonly', 'safe').run).toBe(false);
    expect(executionDecision('destructive', 'safe').run).toBe(false);
    expect(executionDecision('destructive', 'readonly').run).toBe(false);
    expect(executionDecision('readonly', 'readonly').run).toBe(true);
    expect(executionDecision('destructive', 'all').run).toBe(true);
  });
});
