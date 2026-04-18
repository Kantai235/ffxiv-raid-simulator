import type { Point2D } from '../types/geometry';
import type { Tether } from '../types/question';

/**
 * Tether 的實際種類 - schema 未填時一律 fallback 為 `tether`。
 */
export type EffectiveTetherKind = NonNullable<Tether['kind']>;

/**
 * 解析 tether.kind 的實際值。
 *
 * Why: schema 把 kind 設成 optional 以保留向下相容，但 editor / player / tests
 * 都需要同一套 fallback 規則，抽到 shared 可避免多處複製後漂移。
 */
export function resolveTetherKind(tether: Tether): EffectiveTetherKind {
  return tether.kind ?? 'tether';
}

/**
 * 解析是否應在 target 端顯示終點箭頭圖示。
 *
 * 預設規則：
 * - movement -> true
 * - tether   -> false
 *
 * 若 schema 已明確提供 showEndIcon，則以顯式值為準。
 */
export function resolveTetherShowEndIcon(tether: Tether): boolean {
  if (tether.showEndIcon !== undefined) return tether.showEndIcon;
  return resolveTetherKind(tether) === 'movement';
}

/**
 * 計算「由 start 指向 end」的 CSS rotation 角度。
 *
 * 素材正面朝北（0 度），螢幕座標 y 軸向下，因此需用 `atan2(dx, -dy)` 做換算。
 */
export function getTetherEndIconRotation(start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}
