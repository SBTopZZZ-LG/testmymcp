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
export declare const HTTP_HEADERS: {
    readonly ACCEPT: "accept";
    readonly CONTENT_TYPE: "content-type";
    readonly AUTHORIZATION: "authorization";
    readonly MCP_PROTOCOL_VERSION: "mcp-protocol-version";
    readonly MCP_METHOD: "mcp-method";
    readonly MCP_NAME: "mcp-name";
    readonly MCP_SESSION_ID: "mcp-session-id";
};
export declare const HTTP_CONTENT_TYPES: {
    readonly JSON: "application/json";
    readonly SSE: "text/event-stream";
};
export declare const LEGACY_LATEST_PROTOCOL_VERSION = "2025-11-25";
