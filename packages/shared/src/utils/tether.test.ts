import { describe, expect, it } from 'vitest';
import type { Tether } from '../types/question';
import { getTetherEndIconRotation, resolveTetherKind, resolveTetherShowEndIcon } from './tether';

const baseTether: Tether = {
  sourceId: 'boss',
  targetId: 'A',
  color: 'red',
};

describe('resolveTetherKind', () => {
  it('未指定 kind 時 fallback 為 tether', () => {
    expect(resolveTetherKind(baseTether)).toBe('tether');
  });

  it('指定 movement 時保留 movement', () => {
    expect(resolveTetherKind({ ...baseTether, kind: 'movement' })).toBe('movement');
  });
});

describe('resolveTetherShowEndIcon', () => {
  it('movement 未指定 showEndIcon 時預設為 true', () => {
    expect(resolveTetherShowEndIcon({ ...baseTether, kind: 'movement' })).toBe(true);
  });

  it('tether 未指定 showEndIcon 時預設為 false', () => {
    expect(resolveTetherShowEndIcon(baseTether)).toBe(false);
  });

  it('showEndIcon 顯式值優先於 kind 預設', () => {
    expect(
      resolveTetherShowEndIcon({
        ...baseTether,
        kind: 'movement',
        showEndIcon: false,
      }),
    ).toBe(false);
  });
});

describe('getTetherEndIconRotation', () => {
  it('向右時旋轉 90 度', () => {
    expect(getTetherEndIconRotation({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
  });

  it('起終點重合時回傳 0', () => {
    expect(getTetherEndIconRotation({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
});
