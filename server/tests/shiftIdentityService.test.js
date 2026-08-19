import { describe, expect, it } from '@jest/globals';
import {
  assertUniqueShiftIdentity,
  buildShiftIdentityLookup,
  normalizeShiftIdentifier,
  ShiftIdentityConflictError,
} from '../src/services/shiftIdentityService.js';

describe('shiftIdentityService', () => {
  it('normalizes whitespace, width, and case for import identifiers', () => {
    expect(normalizeShiftIdentifier('  ｄ１ ')).toBe('D1');
  });

  it('rejects code-to-name collisions across different shifts', () => {
    const shifts = [{ _id: 's1', code: 'D', name: '日班' }];

    expect(() => assertUniqueShiftIdentity(shifts, { code: 'night', name: ' d ' }))
      .toThrow(ShiftIdentityConflictError);
  });

  it('reports ambiguous legacy identities but allows code and name to match on one shift', () => {
    const sameShift = { _id: 's1', code: 'D', name: 'D' };
    const otherShift = { _id: 's2', code: 'E', name: 'd' };

    const result = buildShiftIdentityLookup([sameShift, otherShift]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].identifier).toBe('d');
    expect(result.lookup.get('D')).toBe(sameShift);
  });
});
