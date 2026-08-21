export type HttpMethod = 'POST' | 'GET' | 'DELETE';

export interface HttpEndpoint {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface HttpEndpoints {
  readonly initialize: HttpEndpoint;
  readonly messages: HttpEndpoint;
}

export type AuthMode = 'none' | 'bearer';

export interface AuthConfig {
  readonly mode: AuthMode;
  readonly token?: string;
}

export interface HttpSessionState {
  readonly sessionId?: string;
  readonly serverName?: string;
  readonly protocolVersion?: string;
}

export interface HttpRequestOptions {
  readonly url: string;
  readonly method: HttpMethod;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: unknown;
  readonly auth?: AuthConfig;
  readonly timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: T;
}

export const HTTP_HEADERS = {
  ACCEPT: 'accept',
  CONTENT_TYPE: 'content-type',
  AUTHORIZATION: 'authorization',
  MCP_PROTOCOL_VERSION: 'mcp-protocol-version',
  MCP_METHOD: 'mcp-method',
  MCP_NAME: 'mcp-name',
  MCP_SESSION_ID: 'mcp-session-id',
} as const;

export const HTTP_CONTENT_TYPES = {
  JSON: 'application/json',
  SSE: 'text/event-stream',
} as const;

export const LEGACY_LATEST_PROTOCOL_VERSION = '2025-11-25';
