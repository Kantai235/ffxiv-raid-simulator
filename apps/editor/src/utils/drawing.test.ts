import { describe, expect, it } from 'vitest';
import {
  calculateRadius,
  distance,
  isNearStartPoint,
  normalizeRect,
} from './drawing';

describe('distance', () => {
  it('相同點距離為 0', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('3-4-5 直角三角形', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('交換順序結果相同', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 50, y: 60 };
    expect(distance(a, b)).toBe(distance(b, a));
  });

  it('負座標也能正確計算', () => {
    expect(distance({ x: -3, y: -4 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('calculateRadius', () => {
  it('圓心到自己為 0', () => {
    expect(calculateRadius({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });

  it('與 distance 行為等價', () => {
    const c = { x: 100, y: 100 };
    const e = { x: 130, y: 140 };
    expect(calculateRadius(c, e)).toBe(distance(c, e));
  });
});

describe('normalizeRect', () => {
  it('左上 → 右下（正向拖曳）', () => {
    const r = normalizeRect({ x: 10, y: 20 }, { x: 110, y: 220 });
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('右下 → 左上（完全反向）- 結果仍為左上原點 + 正寬高', () => {
    const r = normalizeRect({ x: 110, y: 220 }, { x: 10, y: 20 });
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('右上 → 左下', () => {
    const r = normalizeRect({ x: 110, y: 20 }, { x: 10, y: 220 });
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('左下 → 右上', () => {
    const r = normalizeRect({ x: 10, y: 220 }, { x: 110, y: 20 });
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('兩點重合 → 退化為寬高皆 0', () => {
    const r = normalizeRect({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(r).toEqual({ x: 50, y: 50, width: 0, height: 0 });
  });

  it('width 為 0（垂直線）', () => {
    const r = normalizeRect({ x: 50, y: 0 }, { x: 50, y: 100 });
    expect(r).toEqual({ x: 50, y: 0, width: 0, height: 100 });
  });
});

describe('isNearStartPoint', () => {
  const start = { x: 100, y: 100 };

  it('點數不足（< 3）- 不管游標在哪都是 false', () => {
    expect(isNearStartPoint([start, { x: 200, y: 200 }], start)).toBe(false);
    expect(isNearStartPoint([start], start)).toBe(false);
    expect(isNearStartPoint([], { x: 0, y: 0 })).toBe(false);
  });

  it('3 點且游標接近起點 → true', () => {
    const pts = [start, { x: 200, y: 100 }, { x: 200, y: 200 }];
    expect(isNearStartPoint(pts, { x: 105, y: 103 })).toBe(true);
  });

  it('3 點但游標遠離起點 → false', () => {
    const pts = [start, { x: 200, y: 100 }, { x: 200, y: 200 }];
    expect(isNearStartPoint(pts, { x: 500, y: 500 })).toBe(false);
  });

  it('游標剛好在閾值上 → true（含等號）', () => {
    const pts = [start, { x: 200, y: 100 }, { x: 200, y: 200 }];
    // 距起點剛好 15
    expect(isNearStartPoint(pts, { x: 115, y: 100 })).toBe(true);
  });

  it('游標剛好超過閾值 → false', () => {
    const pts = [start, { x: 200, y: 100 }, { x: 200, y: 200 }];
    expect(isNearStartPoint(pts, { x: 115.1, y: 100 })).toBe(false);
  });

  it('可自訂 threshold', () => {
    const pts = [start, { x: 200, y: 100 }, { x: 200, y: 200 }];
    // 距起點 30 單位
    expect(isNearStartPoint(pts, { x: 130, y: 100 }, 30)).toBe(true);
    expect(isNearStartPoint(pts, { x: 130, y: 100 }, 20)).toBe(false);
  });
});
