import { describe, expect, it } from 'vitest';
import {
  compileSchema,
  generateValidInput,
  isValidSchema,
  SchemaLimitError,
  validateAgainstSchema,
} from '../../src/core/schemas/validator.js';

describe('schema validator', () => {
  it('compiles and validates a 2020-12 schema with $defs/$ref', () => {
    const schema = {
      $defs: {
        point: {
          type: 'object',
          properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          required: ['x', 'y'],
        },
      },
      type: 'object',
      properties: { origin: { $ref: '#/$defs/point' } },
      required: ['origin'],
    };
    expect(isValidSchema(schema).valid).toBe(true);
    expect(validateAgainstSchema(schema, { origin: { x: 1, y: 2 } }).valid).toBe(true);
    expect(validateAgainstSchema(schema, { origin: { x: 'nope' } }).valid).toBe(false);
  });

  it('rejects malformed schemas', () => {
    expect(isValidSchema({ type: 'bogus-type' }).valid).toBe(false);
  });

  it('enforces schema size limits', () => {
    const big = { description: 'x'.repeat(100) };
    expect(() => compileSchema(big, 50)).toThrow(SchemaLimitError);
    expect(isValidSchema(big, 50).valid).toBe(false);
  });

  it('generates valid inputs for object schemas', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'string' } },
      required: ['a', 'b'],
      additionalProperties: false,
    };
    const input = generateValidInput(schema);
    expect(input).toEqual({ a: 1, b: 'value' });
    expect(validateAgainstSchema(schema, input).valid).toBe(true);
  });

  it('generates enum and oneOf inputs', () => {
    expect(generateValidInput({ enum: ['red', 'green'] })).toBe('red');
    expect(generateValidInput({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('value');
  });

  it('resolves $ref through $defs when generating', () => {
    const schema = {
      $defs: { inner: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } },
      type: 'object',
      properties: { value: { $ref: '#/$defs/inner' } },
      required: ['value'],
    };
    const input = generateValidInput(schema);
    expect(input).toEqual({ value: { n: 1 } });
    expect(validateAgainstSchema(schema, input).valid).toBe(true);
  });

  it('resolves the same $def referenced by two sibling properties', () => {
    const schema = {
      $defs: { Point: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] } },
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/Point' },
        b: { $ref: '#/$defs/Point' },
      },
      required: ['a', 'b'],
    };
    const input = generateValidInput(schema);
    expect(input).toEqual({ a: { x: 1 }, b: { x: 1 } });
    expect(validateAgainstSchema(schema, input).valid).toBe(true);
  });

  it('honors minItems for prefixItems arrays', () => {
    const schema = { type: 'array', minItems: 1, prefixItems: [{ type: 'integer' }] };
    const input = generateValidInput(schema) as unknown[];
    expect(input.length).toBeGreaterThanOrEqual(1);
    expect(validateAgainstSchema(schema, input).valid).toBe(true);
  });
});