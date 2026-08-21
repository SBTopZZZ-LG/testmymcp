import type { ProtocolVersion } from '../types/protocol.js';
export interface ToolCapability {
    listChanged?: boolean;
}
export interface ResourceCapability {
    listChanged?: boolean;
    subscribe?: boolean;
}
export interface PromptCapability {
    listChanged?: boolean;
}
export interface ElicitationCapability {
    form?: boolean;
    url?: boolean;
}
export interface SamplingCapability {
    context?: boolean;
    tools?: boolean;
}
export interface ServerCapabilities {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
    logging: boolean;
    completions: boolean;
    toolListChanged: boolean;
    resourceListChanged: boolean;
    resourceSubscribe: boolean;
    promptListChanged: boolean;
    extensions: Record<string, unknown> | undefined;
    experimental: Record<string, unknown> | undefined;
    raw: Record<string, unknown> | undefined;
}
export interface ClientCapabilities {
    roots: boolean;
    sampling: boolean;
    elicitation: boolean;
    elicitationForm: boolean;
    elicitationUrl: boolean;
    samplingContext: boolean;
    samplingTools: boolean;
    extensions: Record<string, unknown> | undefined;
    experimental: Record<string, unknown> | undefined;
}
export declare function emptyServerCapabilities(): ServerCapabilities;
export declare function emptyClientCapabilities(): ClientCapabilities;
export declare function parseServerCapabilities(raw: unknown, _version: ProtocolVersion): ServerCapabilities;
export declare function toClientCapabilitiesJson(capabilities: Partial<ClientCapabilities>): Record<string, unknown>;
