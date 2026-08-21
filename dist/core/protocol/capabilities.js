export function emptyServerCapabilities() {
    return {
        tools: false,
        resources: false,
        prompts: false,
        logging: false,
        completions: false,
        toolListChanged: false,
        resourceListChanged: false,
        resourceSubscribe: false,
        promptListChanged: false,
        extensions: undefined,
        experimental: undefined,
        raw: undefined,
    };
}
export function emptyClientCapabilities() {
    return {
        roots: false,
        sampling: false,
        elicitation: false,
        elicitationForm: false,
        elicitationUrl: false,
        samplingContext: false,
        samplingTools: false,
        extensions: undefined,
        experimental: undefined,
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseServerCapabilities(raw, _version) {
    const capabilities = emptyServerCapabilities();
    capabilities.raw = isRecord(raw) ? raw : undefined;
    if (capabilities.raw === undefined)
        return capabilities;
    capabilities.tools = 'tools' in capabilities.raw;
    capabilities.resources = 'resources' in capabilities.raw;
    capabilities.prompts = 'prompts' in capabilities.raw;
    capabilities.logging = 'logging' in capabilities.raw;
    capabilities.completions = 'completions' in capabilities.raw;
    const toolsRaw = isRecord(capabilities.raw.tools) ? capabilities.raw.tools : undefined;
    const resourcesRaw = isRecord(capabilities.raw.resources)
        ? capabilities.raw.resources
        : undefined;
    const promptsRaw = isRecord(capabilities.raw.prompts) ? capabilities.raw.prompts : undefined;
    capabilities.toolListChanged = toolsRaw?.listChanged === true;
    capabilities.resourceListChanged = resourcesRaw?.listChanged === true;
    capabilities.resourceSubscribe = resourcesRaw?.subscribe === true;
    capabilities.promptListChanged = promptsRaw?.listChanged === true;
    if (isRecord(capabilities.raw.extensions))
        capabilities.extensions = capabilities.raw.extensions;
    if (isRecord(capabilities.raw.experimental))
        capabilities.experimental = capabilities.raw.experimental;
    return capabilities;
}
export function toClientCapabilitiesJson(capabilities) {
    const output = {};
    if (capabilities.roots)
        output.roots = {};
    if (capabilities.sampling) {
        const sampling = {};
        if (capabilities.samplingContext)
            sampling.context = {};
        if (capabilities.samplingTools)
            sampling.tools = {};
        output.sampling = sampling;
    }
    if (capabilities.elicitation) {
        const elicitation = {};
        if (capabilities.elicitationForm)
            elicitation.form = {};
        if (capabilities.elicitationUrl)
            elicitation.url = {};
        output.elicitation = elicitation;
    }
    if (capabilities.extensions !== undefined && Object.keys(capabilities.extensions).length > 0) {
        output.extensions = capabilities.extensions;
    }
    if (capabilities.experimental !== undefined &&
        Object.keys(capabilities.experimental).length > 0) {
        output.experimental = capabilities.experimental;
    }
    return output;
}
//# sourceMappingURL=capabilities.js.map