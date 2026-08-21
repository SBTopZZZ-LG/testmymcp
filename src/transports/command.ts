export interface SpawnSpec {
  command: string;
  args: string[];
  shell: boolean;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (value !== '') tokens.push(value);
  }
  return tokens;
}

export function parseServerCommand(input: string): SpawnSpec {
  const tokens = tokenize(input.trim());
  const command = tokens[0];
  if (command === undefined) {
    throw new Error('empty server command');
  }
  const shell = /\.(cmd|bat)$/i.test(command);
  return { command, args: tokens.slice(1), shell };
}