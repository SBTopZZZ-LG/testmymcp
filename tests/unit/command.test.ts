import { describe, expect, it } from 'vitest';
import { parseServerCommand } from '../../src/transports/command.js';

describe('parseServerCommand', () => {
  it('splits commands and arguments on whitespace', () => {
    const spec = parseServerCommand('node server.js --port 3000');
    expect(spec).toEqual({ command: 'node', args: ['server.js', '--port', '3000'], shell: false });
  });

  it('honors double and single quotes', () => {
    const spec = parseServerCommand('npx "my server" arg \'x y\'');
    expect(spec.command).toBe('npx');
    expect(spec.args).toEqual(['my server', 'arg', 'x y']);
  });

  it('enables shell mode for .cmd/.bat shims', () => {
    expect(parseServerCommand('server.cmd --flag').shell).toBe(true);
    expect(parseServerCommand('foo.BAT').shell).toBe(true);
    expect(parseServerCommand('node server.js').shell).toBe(false);
  });

  it('rejects empty commands', () => {
    expect(() => parseServerCommand('   ')).toThrow('empty server command');
  });
});