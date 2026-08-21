#!/usr/bin/env node
import { Command } from 'commander';

import { parseEnvEntries } from '../sessions/env.js';
import { type HttpCommandOptions, runHttp } from './http.js';
import { runInspect } from './inspect.js';
import {
  parseEra,
  parseHttpAccept,
  parseHttpTransport,
  parseLevel,
  parseMode,
  parseProtocolVersion,
} from './parse.js';
import { registerSessionCommands } from './session.js';
import { type StdioCommandOptions, runStdio } from './stdio.js';

function collectEnv(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

const program = new Command();

program
  .name('testmymcp')
  .description('Protocol conformance, interoperability and robustness tester for MCP servers')
  .version('0.1.0');

program
  .command('inspect <file>')
  .description('render a saved trace file (testmymcp mcp-trace JSON)')
  .action(async (file: string) => {
    process.exitCode = await runInspect(file);
  });

program
  .command('stdio <command>')
  .description('test an MCP server over stdio')
  .option('--mode <mode>', 'tool execution policy: safe, readonly, all', 'safe')
  .option('--level <n>', 'highest test level to run (0-7, default 3)', '3')
  .option('--json', 'emit a machine-readable JSON report')
  .option('--timeout <ms>', 'overall test timeout in milliseconds', '30000')
  .option('--show-secrets', 'disable redaction of sensitive values in traces')
  .option('--era <era>', 'protocol era: legacy or modern', 'legacy')
  .option('--protocol-version <version>', 'preferred protocol version (e.g. 2026-07-28)')
  .option('--max-schema-size <bytes>', 'maximum tool schema size in bytes', '1048576')
  .option(
    '--max-line-size <bytes>',
    'maximum accepted server output line size in bytes',
    '16777216',
  )
  .option('--env <key=value>', 'env var for the server child (repeatable)', collectEnv, [])
  .action(async (command: string, commandOptions: Record<string, string> & { env?: string[] }) => {
    try {
      const options: StdioCommandOptions = {
        command,
        mode: parseMode(commandOptions.mode ?? 'safe'),
        level: parseLevel(commandOptions.level ?? '3'),
        json: Boolean(commandOptions.json),
        timeoutMs: Number.parseInt(commandOptions.timeout ?? '30000', 10) || 30000,
        showSecrets: Boolean(commandOptions.showSecrets),
        era: parseEra(commandOptions.era ?? 'legacy'),
        preferVersion:
          commandOptions.protocolVersion !== undefined
            ? parseProtocolVersion(commandOptions.protocolVersion)
            : undefined,
        env: parseEnvEntries(commandOptions.env ?? []),
        maxSchemaBytes:
          commandOptions.maxSchemaSize !== undefined
            ? Number.parseInt(commandOptions.maxSchemaSize, 10) || undefined
            : undefined,
        maxLineBytes:
          commandOptions.maxLineSize !== undefined
            ? Number.parseInt(commandOptions.maxLineSize, 10) || undefined
            : undefined,
      };
      process.exitCode = await runStdio(options);
    } catch (error) {
      console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command('http <url>')
  .description('test an MCP server over streamable HTTP or legacy SSE')
  .option(
    '--transport <transport>',
    'HTTP transport: streamable-http, legacy-sse',
    'streamable-http',
  )
  .option('--mode <mode>', 'tool execution policy: safe, readonly, all', 'safe')
  .option('--level <n>', 'highest test level to run (0-7, default 3)', '3')
  .option('--json', 'emit a machine-readable JSON report')
  .option('--timeout <ms>', 'overall test timeout in milliseconds', '30000')
  .option('--token <token>', 'bearer token for Authorization header')
  .option('--accept <format>', 'response format to request (json or sse)')
  .option('--show-secrets', 'disable redaction of sensitive values in traces')
  .option('--era <era>', 'protocol era: legacy or modern', 'legacy')
  .option('--protocol-version <version>', 'preferred protocol version (e.g. 2026-07-28)')
  .action(async (url: string, commandOptions: Record<string, string>) => {
    try {
      const options: HttpCommandOptions = {
        url,
        transport: parseHttpTransport(commandOptions.transport ?? 'streamable-http'),
        mode: parseMode(commandOptions.mode ?? 'safe'),
        level: parseLevel(commandOptions.level ?? '3'),
        json: Boolean(commandOptions.json),
        timeoutMs: Number.parseInt(commandOptions.timeout ?? '30000', 10) || 30000,
        showSecrets: Boolean(commandOptions.showSecrets),
        token: commandOptions.token !== undefined ? commandOptions.token : undefined,
        accept: parseHttpAccept(commandOptions.accept),
        era: parseEra(commandOptions.era ?? 'legacy'),
        version:
          commandOptions.protocolVersion !== undefined
            ? parseProtocolVersion(commandOptions.protocolVersion)
            : undefined,
      };
      process.exitCode = await runHttp(options);
    } catch (error) {
      console.error(`testmymcp: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command('scan <url>')
  .description('security and agent-safety scan of an MCP server')
  .action(() => {
    console.error(
      'testmymcp: the security scanner ships in Phase 5 of the build plan (see BLUEPRINT.md).',
    );
    process.exitCode = 2;
  });

registerSessionCommands(program);

program.parseAsync(process.argv);
