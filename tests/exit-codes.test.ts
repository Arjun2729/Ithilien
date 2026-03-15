import { describe, it, expect } from 'vitest';
import { EXIT_SUCCESS, EXIT_VERIFICATION_FAILED, EXIT_INVALID_INPUT } from '../src/exit-codes.js';

describe('exit codes', () => {
  it('has expected values', () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_VERIFICATION_FAILED).toBe(1);
    expect(EXIT_INVALID_INPUT).toBe(2);
  });

  it('all codes are distinct', () => {
    const codes = [EXIT_SUCCESS, EXIT_VERIFICATION_FAILED, EXIT_INVALID_INPUT];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('codes are numeric', () => {
    expect(typeof EXIT_SUCCESS).toBe('number');
    expect(typeof EXIT_VERIFICATION_FAILED).toBe('number');
    expect(typeof EXIT_INVALID_INPUT).toBe('number');
  });
});
