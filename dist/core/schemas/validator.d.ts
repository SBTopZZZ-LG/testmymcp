import { type ErrorObject } from 'ajv/dist/2020.js';
export declare class SchemaLimitError extends Error {
    readonly bytes: number;
    constructor(bytes: number, limit: number);
}
interface ValidatorLike {
    (instance: unknown): boolean;
    errors?: ErrorObject[] | null;
}
export declare function compileSchema(schema: unknown, maxBytes?: number): ValidatorLike;
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateAgainstSchema(schema: unknown, instance: unknown, maxBytes?: number): ValidationResult;
export declare function isValidSchema(schema: unknown, maxBytes?: number): ValidationResult;
interface SchemaObject {
    [key: string]: unknown;
}
export declare function generateValidInput(schema: unknown, maxDepth?: number, stack?: object[], root?: SchemaObject): unknown;
export {};
