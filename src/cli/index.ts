#!/usr/bin/env node
import { Command } from 'commander';
import { runInspect } from './inspect.js';
import { runStdio, type StdioCommandOptions } from './stdio.js';
import { runHttp, type HttpCommandOptions, type HttpTransportKind } from './http.js';
import type { ToolExecutionMode } from '../core/tools/safety.js';
import { isProtocolVersion, type ProtocolEra, type ProtocolVersion } from '../core/types/protocol.js';

function parseLevel(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 7) {
    throw new Error(`invalid level "${value}" (expected 0-7)`);
  }
  return parsed;
}

function parseMode(value: string): ToolExecutionMode {
  if (value === 'safe' || value === 'readonly' || value === 'all') return value;
  throw new Error(`invalid mode "${value}" (expected safe, readonly or all)`);
}

function parseEra(value: string): ProtocolEra {
  if (value === 'legacy' || value === 'modern') return value;
  throw new Error(`invalid era "${value}" (expected legacy or modern)`);
}

function parseProtocolVersion(value: string): ProtocolVersion {
  if (!isProtocolVersion(value)) throw new Error(`invalid protocol version "${value}"`);
  return value;
}

function parseHttpTransport(value: string): HttpTransportKind {
  if (value === 'streamable-http' || value === 'legacy-sse') return value;
  throw new Error(`invalid transport "${value}" (expected streamable-http or legacy-sse)`);
}

function parseHttpAccept(value: string | undefined): 'json' | 'sse' | undefined {
  if (value === undefined) return undefined;
  if (value === 'json' || value === 'sse') return value;
  throw new Error(`invalid accept "${value}" (expected json or sse)`);
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
  .option('--max-line-size <bytes>', 'maximum accepted server output line size in bytes', '1048576')
  .action(async (command: string, commandOptions: Record<string, string>) => {
    try {
      const options: StdioCommandOptions = {
        command,
        mode: parseMode(commandOptions.mode ?? 'safe'),
        level: parseLevel(commandOptions.level ?? '3'),
        json: Boolean(commandOptions.json),
        timeoutMs: Number.parseInt(commandOptions.timeout ?? '30000', 10) || 30000,
        showSecrets: Boolean(commandOptions.showSecrets),
        era: parseEra(commandOptions.era ?? 'legacy'),
        preferVersion: commandOptions.protocolVersion !== undefined ? parseProtocolVersion(commandOptions.protocolVersion) : undefined,
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
  .option('--transport <transport>', 'HTTP transport: streamable-http, legacy-sse', 'streamable-http')
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
        version: commandOptions.protocolVersion !== undefined ? parseProtocolVersion(commandOptions.protocolVersion) : undefined,
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
    console.error('testmymcp: the security scanner ships in Phase 5 of the build plan (see BLUEPRINT.md).');
    process.exitCode = 2;
  });

program.parseAsync(process.argv);