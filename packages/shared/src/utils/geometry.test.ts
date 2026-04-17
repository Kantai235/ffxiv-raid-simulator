import { describe, expect, it } from 'vitest';
import type { CircleArea, PolygonArea, RectArea } from '../types/geometry';
import {
  isPointInCircle,
  isPointInPolygon,
  isPointInRect,
  isPointInSafeArea,
  rotatePoint,
  toBossRelativeCoord,
  toWorldCoord,
} from './geometry';

/**
 * ========================================================================
 * 幾何命中判定測試
 * ========================================================================
 * 測試策略：
 *   1. 典型 case（明顯內 / 明顯外）
 *   2. 邊界 case（點剛好在邊上、頂點上）
 *   3. 退化 case（半徑 0、空多邊形、退化多邊形）
 *   4. 浮點誤差 case（0.1+0.2 之類）
 *
 * 「邊界算命中」政策必須在所有形狀一致 - 此策略是可測試的契約。
 * ========================================================================
 */

describe('isPointInCircle', () => {
  const circle: CircleArea = {
    shape: 'circle',
    center: { x: 100, y: 100 },
    radius: 50,
  };

  it('圓心應為命中', () => {
    expect(isPointInCircle({ x: 100, y: 100 }, circle)).toBe(true);
  });

  it('圓內任意點應為命中', () => {
    expect(isPointInCircle({ x: 110, y: 110 }, circle)).toBe(true);
    expect(isPointInCircle({ x: 130, y: 80 }, circle)).toBe(true);
  });

  it('圓周上的點應為命中（邊界政策）', () => {
    // 距圓心剛好 50 的四個點
    expect(isPointInCircle({ x: 150, y: 100 }, circle)).toBe(true); // 東
    expect(isPointInCircle({ x: 100, y: 150 }, circle)).toBe(true); // 南
    expect(isPointInCircle({ x: 50, y: 100 }, circle)).toBe(true); // 西
    expect(isPointInCircle({ x: 100, y: 50 }, circle)).toBe(true); // 北
  });

  it('圓外的點應不命中', () => {
    expect(isPointInCircle({ x: 151, y: 100 }, circle)).toBe(false);
    expect(isPointInCircle({ x: 0, y: 0 }, circle)).toBe(false);
  });

  it('浮點誤差內的圓周點仍應命中', () => {
    // 距圓心剛好 50 + 1e-12，在 EPSILON 容差內視為命中
    expect(isPointInCircle({ x: 150 + 1e-12, y: 100 }, circle)).toBe(true);
  });

  it('零半徑圓 - 僅圓心命中', () => {
    const zero: CircleArea = { shape: 'circle', center: { x: 0, y: 0 }, radius: 0 };
    expect(isPointInCircle({ x: 0, y: 0 }, zero)).toBe(true);
    expect(isPointInCircle({ x: 0.001, y: 0 }, zero)).toBe(false);
  });
});

describe('isPointInRect', () => {
  const rect: RectArea = { shape: 'rect', x: 100, y: 200, width: 50, height: 30 };

  it('矩形內部點應命中', () => {
    expect(isPointInRect({ x: 120, y: 210 }, rect)).toBe(true);
  });

  it('四個角剛好在邊界上應命中', () => {
    expect(isPointInRect({ x: 100, y: 200 }, rect)).toBe(true); // 左上
    expect(isPointInRect({ x: 150, y: 200 }, rect)).toBe(true); // 右上
    expect(isPointInRect({ x: 100, y: 230 }, rect)).toBe(true); // 左下
    expect(isPointInRect({ x: 150, y: 230 }, rect)).toBe(true); // 右下
  });

  it('四條邊上的點應命中', () => {
    expect(isPointInRect({ x: 125, y: 200 }, rect)).toBe(true); // 上邊
    expect(isPointInRect({ x: 150, y: 215 }, rect)).toBe(true); // 右邊
    expect(isPointInRect({ x: 125, y: 230 }, rect)).toBe(true); // 下邊
    expect(isPointInRect({ x: 100, y: 215 }, rect)).toBe(true); // 左邊
  });

  it('矩形外點應不命中', () => {
    expect(isPointInRect({ x: 99, y: 215 }, rect)).toBe(false);
    expect(isPointInRect({ x: 151, y: 215 }, rect)).toBe(false);
    expect(isPointInRect({ x: 125, y: 199 }, rect)).toBe(false);
    expect(isPointInRect({ x: 125, y: 231 }, rect)).toBe(false);
  });

  it('零寬/零高矩形退化為線段或點', () => {
    const line: RectArea = { shape: 'rect', x: 0, y: 0, width: 100, height: 0 };
    expect(isPointInRect({ x: 50, y: 0 }, line)).toBe(true); // 點在線上
    expect(isPointInRect({ x: 50, y: 0.001 }, line)).toBe(false);
  });
});

describe('isPointInPolygon', () => {
  // 標準正方形多邊形（與 RectArea 等價，方便對照）
  const square: PolygonArea = {
    shape: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  };

  it('多邊形內部點應命中', () => {
    expect(isPointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
  });

  it('多邊形外部點應不命中', () => {
    expect(isPointInPolygon({ x: -1, y: 50 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 101, y: 50 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 50, y: 200 }, square)).toBe(false);
  });

  it('邊上的點應命中（邊界政策）', () => {
    expect(isPointInPolygon({ x: 50, y: 0 }, square)).toBe(true); // 上邊
    expect(isPointInPolygon({ x: 100, y: 50 }, square)).toBe(true); // 右邊
    expect(isPointInPolygon({ x: 50, y: 100 }, square)).toBe(true); // 下邊
    expect(isPointInPolygon({ x: 0, y: 50 }, square)).toBe(true); // 左邊
  });

  it('頂點上的點應命中（射線法奇異點測試）', () => {
    // 此案例最容易暴露射線法 bug - 射線正好穿過頂點時計數可能錯誤。
    // 我們用 isPointOnSegment 邊界特判保證命中。
    expect(isPointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 100, y: 0 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 100, y: 100 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 0, y: 100 }, square)).toBe(true);
  });

  it('凹多邊形 - 凹陷處應不命中', () => {
    // L 形多邊形：缺右上角
    //   (0,0) -- (50,0) -- (50,50) -- (100,50) -- (100,100) -- (0,100)
    const lShape: PolygonArea = {
      shape: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    };
    expect(isPointInPolygon({ x: 25, y: 25 }, lShape)).toBe(true); // 左上方塊內
    expect(isPointInPolygon({ x: 75, y: 75 }, lShape)).toBe(true); // 右下方塊內
    expect(isPointInPolygon({ x: 75, y: 25 }, lShape)).toBe(false); // 缺角內
  });

  it('射線水平穿過多個共享 y 座標的頂點時計數正確', () => {
    // 三角形，y=50 的射線會同時穿過頂點 (100,50)
    const triangle: PolygonArea = {
      shape: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 100 },
      ],
    };
    // 點 (50, 50) 在三角形內
    expect(isPointInPolygon({ x: 50, y: 50 }, triangle)).toBe(true);
    // 點 (200, 50) 在三角形外
    expect(isPointInPolygon({ x: 200, y: 50 }, triangle)).toBe(false);
  });

  it('退化多邊形（少於 3 點）視為永不命中', () => {
    const degenerate: PolygonArea = {
      shape: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(isPointInPolygon({ x: 5, y: 5 }, degenerate)).toBe(false);
  });
});

describe('isPointInSafeArea (多型分派)', () => {
  it('應依 shape 分派到對應演算法', () => {
    const circle: CircleArea = { shape: 'circle', center: { x: 0, y: 0 }, radius: 10 };
    const rect: RectArea = { shape: 'rect', x: 0, y: 0, width: 10, height: 10 };
    const polygon: PolygonArea = {
      shape: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };

    expect(isPointInSafeArea({ x: 5, y: 5 }, circle)).toBe(true);
    expect(isPointInSafeArea({ x: 5, y: 5 }, rect)).toBe(true);
    expect(isPointInSafeArea({ x: 8, y: 4 }, polygon)).toBe(true);
    expect(isPointInSafeArea({ x: 100, y: 100 }, circle)).toBe(false);
  });
});

describe('rotatePoint', () => {
  const center: { x: number; y: number } = { x: 0, y: 0 };

  it('旋轉 0 度應回傳原點（在容差內）', () => {
    const p = rotatePoint({ x: 100, y: 0 }, center, 0);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it('旋轉 90 度（順時針）：北 → 東', () => {
    // (0, -100) 在「左上原點、y 向下」座標系中是「正北」（上方 100 單位）
    // 順時針旋轉 90 度應變成「正東」(100, 0)
    const p = rotatePoint({ x: 0, y: -100 }, center, 90);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it('旋轉 180 度：北 → 南', () => {
    const p = rotatePoint({ x: 0, y: -100 }, center, 180);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
  });

  it('旋轉 270 度：北 → 西', () => {
    const p = rotatePoint({ x: 0, y: -100 }, center, 270);
    expect(p.x).toBeCloseTo(-100);
    expect(p.y).toBeCloseTo(0);
  });

  it('旋轉 360 度應回到原位', () => {
    const p = rotatePoint({ x: 50, y: 30 }, center, 360);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(30);
  });

  it('繞非原點中心旋轉', () => {
    // 點 (100, 100) 繞 (50, 50) 順時針 90 度
    // 相對座標 (50, 50)，順時針 90 度 → (-50, 50)，加回中心 → (0, 100)
    const p = rotatePoint({ x: 100, y: 100 }, { x: 50, y: 50 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
  });

  it('不修改入參', () => {
    const original = { x: 50, y: 30 };
    rotatePoint(original, center, 45);
    expect(original).toEqual({ x: 50, y: 30 });
  });
});

describe('toWorldCoord / toBossRelativeCoord', () => {
  const bossPos = { x: 500, y: 500 };

  it('王朝北（facing=0）時，相對座標 = 世界座標 − 王位置', () => {
    // 「王正前方 100」= 相對 (0, -100)，王朝北時世界座標應為 (500, 400)
    const world = toWorldCoord({ x: 0, y: -100 }, bossPos, 0);
    expect(world.x).toBeCloseTo(500);
    expect(world.y).toBeCloseTo(400);
  });

  it('王朝東（facing=90）時，正前方 = 王的東方', () => {
    // 文件範例：相對 (0, -100) + bossPos (500,500) + facing 90 → (600, 500)
    const world = toWorldCoord({ x: 0, y: -100 }, bossPos, 90);
    expect(world.x).toBeCloseTo(600);
    expect(world.y).toBeCloseTo(500);
  });

  it('王朝南（facing=180）時，正前方 = 王的南方', () => {
    const world = toWorldCoord({ x: 0, y: -100 }, bossPos, 180);
    expect(world.x).toBeCloseTo(500);
    expect(world.y).toBeCloseTo(600);
  });

  it('toBossRelativeCoord 為 toWorldCoord 的逆運算', () => {
    // 任意角度與位置，往返應回到原點（容差內）
    const original = { x: 73, y: -42 };
    const world = toWorldCoord(original, bossPos, 137);
    const back = toBossRelativeCoord(world, bossPos, 137);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });
});
