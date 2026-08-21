export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export interface ResourceDefinition {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTemplateDefinition {
  uriTemplate: string;
  name?: string;
  description?: string;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}
