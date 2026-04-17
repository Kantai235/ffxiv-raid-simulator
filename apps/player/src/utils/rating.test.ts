import { describe, expect, it } from 'vitest';
import { calculateRating } from './rating';

describe('calculateRating', () => {
  it('100% → perfect', () => {
    expect(calculateRating(10, 10).tier).toBe('perfect');
  });

  it('80% 整數 → complete（含等號）', () => {
    expect(calculateRating(8, 10).tier).toBe('complete');
  });

  it('剛超過 80% → complete', () => {
    expect(calculateRating(9, 10).tier).toBe('complete');
  });

  it('剛低於 80% → wipe', () => {
    expect(calculateRating(7, 10).tier).toBe('wipe');
  });

  it('0% → wipe', () => {
    expect(calculateRating(0, 10).tier).toBe('wipe');
  });

  it('totalCount = 0 → wipe（防呆，不應該被呼叫但要安全）', () => {
    expect(calculateRating(0, 0).tier).toBe('wipe');
  });

  it('回傳物件含 label 與 colorClass', () => {
    const r = calculateRating(10, 10);
    expect(r.label).toContain('Perfect');
    expect(r.colorClass).toBeTruthy();
  });
});
