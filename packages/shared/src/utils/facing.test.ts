import { describe, expect, it } from 'vitest';
import {
  bearingFromTo,
  degreesToRadians,
  facingToCssRotation,
  normalizeDegrees,
  radiansToDegrees,
  shortestAngleDiff,
} from './facing';

describe('normalizeDegrees', () => {
  it('範圍內的值不變', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(90)).toBe(90);
    expect(normalizeDegrees(359.99)).toBeCloseTo(359.99);
  });

  it('360 度應歸零', () => {
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(720)).toBe(0);
  });

  it('超過 360 度應正確 wrap', () => {
    expect(normalizeDegrees(450)).toBe(90);
    expect(normalizeDegrees(810)).toBe(90); // 720 + 90
  });

  it('負角度應 wrap 到正範圍', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(-1)).toBeCloseTo(359);
    expect(normalizeDegrees(-360)).toBe(0);
    expect(normalizeDegrees(-450)).toBe(270); // -360 - 90 → 270
  });
});

describe('degreesToRadians / radiansToDegrees', () => {
  it('互為逆運算', () => {
    expect(radiansToDegrees(degreesToRadians(45))).toBeCloseTo(45);
    expect(radiansToDegrees(degreesToRadians(180))).toBeCloseTo(180);
    expect(degreesToRadians(radiansToDegrees(Math.PI / 3))).toBeCloseTo(Math.PI / 3);
  });

  it('已知值換算正確', () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
    expect(radiansToDegrees(Math.PI)).toBeCloseTo(180);
  });
});

describe('facingToCssRotation', () => {
  it('與 facing 同值（直接對應，差別只在 normalize）', () => {
    expect(facingToCssRotation(0)).toBe(0);
    expect(facingToCssRotation(90)).toBe(90);
    expect(facingToCssRotation(180)).toBe(180);
  });

  it('應自動 normalize 過界值', () => {
    expect(facingToCssRotation(-90)).toBe(270);
    expect(facingToCssRotation(450)).toBe(90);
  });
});

describe('bearingFromTo', () => {
  const observer = { x: 100, y: 100 };

  it('目標在正北 → 方位角 0', () => {
    // 「北」= y 較小（畫面上方）
    expect(bearingFromTo(observer, { x: 100, y: 50 })).toBeCloseTo(0);
  });

  it('目標在正東 → 方位角 90', () => {
    expect(bearingFromTo(observer, { x: 150, y: 100 })).toBeCloseTo(90);
  });

  it('目標在正南 → 方位角 180', () => {
    expect(bearingFromTo(observer, { x: 100, y: 150 })).toBeCloseTo(180);
  });

  it('目標在正西 → 方位角 270', () => {
    expect(bearingFromTo(observer, { x: 50, y: 100 })).toBeCloseTo(270);
  });

  it('目標在東北 → 方位角 45', () => {
    expect(bearingFromTo(observer, { x: 200, y: 0 })).toBeCloseTo(45);
  });
});

describe('shortestAngleDiff', () => {
  it('順時針較近回傳正值', () => {
    expect(shortestAngleDiff(10, 30)).toBe(20);
    expect(shortestAngleDiff(350, 10)).toBe(20); // wrap 過 0 度
  });

  it('逆時針較近回傳負值', () => {
    expect(shortestAngleDiff(30, 10)).toBe(-20);
    expect(shortestAngleDiff(10, 350)).toBe(-20);
  });

  it('正對面（180 度）慣例取正值', () => {
    expect(shortestAngleDiff(0, 180)).toBe(180);
    expect(shortestAngleDiff(90, 270)).toBe(180);
  });

  it('相同角度回傳 0', () => {
    expect(shortestAngleDiff(45, 45)).toBe(0);
    expect(shortestAngleDiff(0, 360)).toBe(0); // 360 等同於 0
  });

  it('結果範圍應落在 (-180, 180]', () => {
    // 隨機抽幾個值驗證範圍
    for (const [from, to] of [
      [0, 90],
      [200, 50],
      [100, 280],
      [-30, 200],
    ]) {
      const d = shortestAngleDiff(from, to);
      expect(d).toBeGreaterThan(-180);
      expect(d).toBeLessThanOrEqual(180);
    }
  });
});
