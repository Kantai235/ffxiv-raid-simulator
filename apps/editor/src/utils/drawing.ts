import type { Point2D } from '@ffxiv-sim/shared';

/**
 * ========================================================================
 * Editor 專用繪圖純函數
 * ========================================================================
 *
 * 這裡的函數都是「給定兩點或多點，產出 SafeArea 可用參數」的計算邏輯。
 *
 * Why 獨立於 packages/shared/utils/geometry.ts：
 *   shared 的 geometry 是 Player 端命中判定用（isPointInSafeArea 等），
 *   這裡是 Editor 繪製互動用，語意不同。雖可合併但會讓 shared 混入編輯器業務
 *   邏輯，違反 CLAUDE.md 第 7 點架構邊界。
 *
 * 全部純函數，無副作用；單元測試直接套用。
 * ========================================================================
 */

/**
 * 兩點歐氏距離。
 *
 * 實作用 Math.hypot 而非 Math.sqrt(dx*dx + dy*dy)：
 *   1. Math.hypot 內部避免中間值溢位（平方可能超過 Number.MAX_VALUE）
 *   2. 意圖明確（一看就知道是算距離）
 *
 * 對本系統而言兩者數值結果差異可忽略（場地座標遠小於溢位邊界），
 * 但 Math.hypot 是業界最佳實踐。
 */
export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 以 center 為圓心，計算到 edgePoint 的半徑。
 *
 * 用於 circle 工具：第 1 點 mousedown = center，第 2 點 mousedown = 圓周上某點。
 * 直接呼叫 distance() 是邏輯等價，但抽出獨立函數讓呼叫端語意更清晰。
 */
export function calculateRadius(center: Point2D, edgePoint: Point2D): number {
  return distance(center, edgePoint);
}

/**
 * 將使用者輸入的兩個對角點正規化為「左上原點 + 正寬高」的矩形。
 *
 * 問題情境：使用者拖曳矩形時可能從任一象限開始：
 *   - 左上 → 右下：p1.x < p2.x 且 p1.y < p2.y（正常）
 *   - 右上 → 左下：p1.x > p2.x 且 p1.y < p2.y
 *   - 左下 → 右上：p1.x < p2.x 且 p1.y > p2.y
 *   - 右下 → 左上：p1.x > p2.x 且 p1.y > p2.y（完全反向）
 *
 * SafeArea.rect 契約要求 (x, y) 為左上角、width/height 為正值，
 * 因此必須用 Math.min/max 正規化：
 *   x = min(p1.x, p2.x)  →  保證為最左
 *   y = min(p1.y, p2.y)  →  保證為最上
 *   width  = |p1.x - p2.x|
 *   height = |p1.y - p2.y|
 *
 * 邊界：兩點重合時 width=0/height=0，視為退化矩形（呼叫端可過濾）。
 */
export function normalizeRect(
  p1: Point2D,
  p2: Point2D,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

/**
 * 判斷 Polygon 是否可「磁吸閉合」- 當前游標是否接近多邊形起點。
 *
 * 規則：
 *   1. 已點擊的頂點數 ≥ 3（少於 3 不構成合法多邊形）
 *   2. 游標到起點距離 ≤ threshold（邏輯座標單位）
 *
 * 回傳 true 時，EditableArenaMap 應將預覽虛線自動吸到起點，
 * 並在下次 mousedown 時觸發 commitSafeArea。
 *
 * Why threshold 預設 15：對 1000×1000 場地 = 1.5% 視覺寬度，
 *      夠近才觸發吸附，不會誤觸；需要微調時呼叫端可傳值覆寫。
 */
export function isNearStartPoint(
  points: Point2D[],
  cursor: Point2D,
  threshold = 15,
): boolean {
  if (points.length < 3) return false;
  return distance(points[0], cursor) <= threshold;
}
