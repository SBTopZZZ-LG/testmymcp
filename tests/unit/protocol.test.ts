import { describe, expect, it } from 'vitest';
import {
  eraOfVersion,
  isProtocolVersion,
  LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSIONS,
  PROTOCOL_VERSIONS,
  sortKnownVersions,
} from '../../src/core/types/protocol.js';

describe('protocol versions', () => {
  it('recognizes all five released versions', () => {
    expect(PROTOCOL_VERSIONS).toHaveLength(5);
    expect(eraOfVersion('2024-11-05')).toBe('legacy');
    expect(eraOfVersion('2025-03-26')).toBe('legacy');
    expect(eraOfVersion('2025-06-18')).toBe('legacy');
    expect(eraOfVersion('2025-11-25')).toBe('legacy');
    expect(eraOfVersion('2026-07-28')).toBe('modern');
  });

  it('has exactly one modern version', () => {
    expect(MODERN_PROTOCOL_VERSIONS).toEqual(['2026-07-28']);
    expect(LEGACY_PROTOCOL_VERSIONS).toHaveLength(4);
  });

  it('rejects unknown or malformed versions', () => {
    expect(isProtocolVersion('2026-01-01')).toBe(false);
    expect(isProtocolVersion('1.0')).toBe(false);
    expect(isProtocolVersion('latest')).toBe(false);
    expect(eraOfVersion('nonsense')).toBeNull();
  });

  it('orders versions by the explicit release sequence, not by guessing', () => {
    const shuffled = ['2026-07-28', '2025-03-26', '2025-11-25', '2024-11-05', '2025-06-18'];
    expect(sortKnownVersions(shuffled)).toEqual([...PROTOCOL_VERSIONS]);

    const withUnknown = ['2026-07-28', '2020-01-01', 'latest', '2025-06-18', '1.0.0'];
    expect(sortKnownVersions(withUnknown)).toEqual(['2025-06-18', '2026-07-28']);
  });
});