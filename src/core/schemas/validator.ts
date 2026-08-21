import { Ajv2020, type AnySchema, type ErrorObject } from 'ajv/dist/2020.js';

export class SchemaLimitError extends Error {
  readonly bytes: number;

  constructor(bytes: number, limit: number) {
    super(`schema exceeds size limit of ${limit} bytes (${bytes})`);
    this.name = 'SchemaLimitError';
    this.bytes = bytes;
  }
}

const DEFAULT_MAX_SCHEMA_BYTES = 1024 * 1024;
const MAX_CACHE_ENTRIES = 256;

interface ValidatorLike {
  (instance: unknown): boolean;
  errors?: ErrorObject[] | null;
}

const compileCache = new Map<string, ValidatorLike>();

export function compileSchema(schema: unknown, maxBytes = DEFAULT_MAX_SCHEMA_BYTES): ValidatorLike {
  const json = JSON.stringify(schema);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > maxBytes) throw new SchemaLimitError(bytes, maxBytes);
  const key = `${maxBytes}:${json}`;
  const cached = compileCache.get(key);
  if (cached !== undefined) return cached;
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  const compiled = ajv.compile(schema as AnySchema) as ValidatorLike;
  if (compileCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = compileCache.keys().next().value;
    if (oldest !== undefined) compileCache.delete(oldest);
  }
  compileCache.set(key, compiled);
  return compiled;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgainstSchema(
  schema: unknown,
  instance: unknown,
  maxBytes = DEFAULT_MAX_SCHEMA_BYTES,
): ValidationResult {
  const compiled = compileSchema(schema, maxBytes);
  const valid = compiled(instance);
  const errors = (compiled.errors ?? []).map(
    (error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
  );
  return { valid, errors };
}

export function isValidSchema(schema: unknown, maxBytes = DEFAULT_MAX_SCHEMA_BYTES): ValidationResult {
  try {
    compileSchema(schema, maxBytes);
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

interface SchemaObject {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function generateValidInput(
  schema: unknown,
  maxDepth = 4,
  stack: object[] = [],
  root?: SchemaObject,
): unknown {
  if (schema === true) return {};
  if (schema === false) return undefined;
  if (!isRecord(schema)) return undefined;
  if (maxDepth <= 0) return undefined;

  const rootSchema = root ?? schema;
  const resolved = resolveRefs(schema, stack, rootSchema);
  if (resolved === undefined) return undefined;

  if (resolved.const !== undefined) return resolved.const;

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0] ?? undefined;
  }

  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    return generateValidInput(resolved.oneOf[0], maxDepth, [...stack], rootSchema);
  }
  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    return generateValidInput(resolved.anyOf[0], maxDepth, [...stack], rootSchema);
  }

  if (Array.isArray(resolved.allOf)) {
    let merged: Record<string, unknown> = {};
    for (const sub of resolved.allOf) {
      const value = generateValidInput(sub, maxDepth, [...stack], rootSchema);
      if (isRecord(value)) merged = { ...merged, ...value };
    }
    return merged;
  }

  const type = resolved.type;

  if (type === 'string' || (Array.isArray(type) && type.includes('string'))) return 'value';
  if (
    type === 'integer' ||
    type === 'number' ||
    (Array.isArray(type) && (type.includes('number') || type.includes('integer')))
  ) {
    return 1;
  }
  if (type === 'boolean' || (Array.isArray(type) && type.includes('boolean'))) return true;
  if (type === 'null') return null;
  if (type === 'array' || (Array.isArray(type) && type.includes('array'))) {
    const generated: unknown[] = [];
    if (Array.isArray(resolved.prefixItems)) {
      for (const itemSchema of resolved.prefixItems) {
        const item = generateValidInput(itemSchema, maxDepth - 1, [...stack], rootSchema);
        if (item !== undefined) generated.push(item);
      }
    } else if (Array.isArray(resolved.items)) {
      for (const itemSchema of resolved.items) {
        const item = generateValidInput(itemSchema, maxDepth - 1, [...stack], rootSchema);
        if (item !== undefined) generated.push(item);
      }
    } else if (isRecord(resolved.items)) {
      const item = generateValidInput(resolved.items, maxDepth - 1, [...stack], rootSchema);
      if (item !== undefined) generated.push(item);
    }
    const minItems = typeof resolved.minItems === 'number' ? resolved.minItems : 0;
    while (generated.length < minItems && generated.length < maxDepth) {
      const fallback = isRecord(resolved.items)
        ? generateValidInput(resolved.items, maxDepth - 1, [...stack], rootSchema)
        : undefined;
      generated.push(fallback ?? {});
    }
    return generated;
  }
  if (
    type === 'object' ||
    type === undefined ||
    (Array.isArray(type) && type.includes('object'))
  ) {
    const output: Record<string, unknown> = {};
    const properties = isRecord(resolved.properties) ? resolved.properties : undefined;
    const required = Array.isArray(resolved.required) ? resolved.required : [];
    for (const name of required) {
      if (typeof name !== 'string' || properties === undefined || !(name in properties)) {
        output[name] = {};
        continue;
      }
      const value = generateValidInput(properties[name], maxDepth - 1, [...stack], rootSchema);
      if (value !== undefined) output[name] = value;
    }
    return output;
  }
  return undefined;
}

function resolveRefs(schema: SchemaObject, stack: object[], root: SchemaObject): SchemaObject | undefined {
  let current: SchemaObject = schema;
  for (let guard = 0; guard < 64; guard += 1) {
    if (typeof current.$ref !== 'string') return current;
    const target = resolveJsonPointer(root, current.$ref);
    if (target === undefined) return current;
    if (stack.includes(target)) return current;
    stack.push(target);
    current = target;
  }
  return undefined;
}

function resolveJsonPointer(root: SchemaObject, ref: string): SchemaObject | undefined {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return isRecord(current) ? current : undefined;
}