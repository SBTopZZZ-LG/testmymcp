import { describe, expect, it } from 'vitest';
import {
  createErrorResponse,
  createNotification,
  createRequest,
  createResponse,
  isNotification,
  isRequest,
  isResponse,
  JSONRPC_ERROR_CODES,
} from '../../src/core/jsonrpc/messages.js';

describe('JSON-RPC message guards', () => {
  it('recognizes requests', () => {
    const request = createRequest(1, 'ping');
    expect(isRequest(request)).toBe(true);
    expect(isNotification(request)).toBe(false);
    expect(isResponse(request)).toBe(false);
  });

  it('recognizes notifications by absence of id', () => {
    const notification = createNotification('initialized');
    expect(isNotification(notification)).toBe(true);
    expect(isRequest(notification)).toBe(false);
  });

  it('recognizes responses and enforces result XOR error', () => {
    expect(isResponse(createResponse(1, { ok: true }))).toBe(true);
    expect(isResponse(createErrorResponse(1, JSONRPC_ERROR_CODES.INTERNAL_ERROR, 'boom'))).toBe(true);
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: 1, error: { code: 1, message: 'x' } })).toBe(false);
    expect(isResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });

  it('rejects non-records and bad jsonrpc versions', () => {
    expect(isRequest(null)).toBe(false);
    expect(isRequest([])).toBe(false);
    expect(isRequest('{}')).toBe(false);
    expect(isResponse({ jsonrpc: '1.0', id: 1, result: 1 })).toBe(false);
  });

  it('keeps string and numeric ids distinct', () => {
    expect(isRequest(createRequest(1, 'ping'))).toBe(true);
    expect(isRequest(createRequest('1', 'ping'))).toBe(true);
  });

  it('carries error data only when provided', () => {
    const response = createErrorResponse(7, -32001, 'denied', { reason: 'nope' });
    expect(response.error?.data).toEqual({ reason: 'nope' });
    const bare = createErrorResponse(7, -32001, 'denied');
    expect(bare.error?.data).toBeUndefined();
  });
});