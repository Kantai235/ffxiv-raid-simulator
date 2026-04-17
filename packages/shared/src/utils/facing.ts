/**
 * ========================================================================
 * Boss 面嚮（Facing）角度系列工具
 * ========================================================================
 *
 * 【角度系約定 - 唯一真實來源】
 *   - 0°   = 正北（畫面上方，y 軸負方向）
 *   - 90°  = 正東（x 軸正方向）
 *   - 180° = 正南
 *   - 270° = 正西
 *   - 順時針增加（與羅盤、FFXIV True North 巨集一致）
 *
 * 【座標系約定】左上原點、y 向下（DOM/Canvas 慣例）。
 *
 * 此檔提供：
 *   1. 角度標準化（任意度數歸一到 [0, 360)）
 *   2. 度與弧度互轉
 *   3. 取得 CSS rotate 用的角度（DOM 旋轉預設「東 0、順時針」與我們不同）
 *   4. 計算「從觀察者朝向某點」的方位角（用於玩家點擊命中扇形機制等）
 *
 * 旋轉相關的座標變換已封裝於 geometry.ts 的 rotatePoint / toWorldCoord，
 * 此檔僅處理「角度本身」的數值運算。
 * ========================================================================
 */

import type { Point2D } from '../types/geometry';

/**
 * 將任意角度（含負數、超過 360 度）標準化到 [0, 360) 區間。
 *
 * Why: 加減運算後角度可能跑出範圍（例如 -45 度 = 315 度，720 度 = 0 度），
 *      UI 顯示與相等比較都需要先正規化。
 *
 * 範例：
 *   normalizeDegrees(-90)   → 270
 *   normalizeDegrees(450)   → 90
 *   normalizeDegrees(360)   → 0
 *   normalizeDegrees(0)     → 0
 *
 * @param degrees   任意角度
 * @returns         標準化到 [0, 360) 的等效角度
 */
export function normalizeDegrees(degrees: number): number {
  // 取模後仍可能為負（JS 的 % 對負數保留符號），加 360 再取一次模確保非負。
  // 額外 + 0 將「負零（-0）」轉為「正零（+0）」：
  //   Why: -360 % 360 在 JS 為 -0，會導致 toBe(0) 因 Object.is 而失敗。
  //        角度語意上沒有負零，統一歸正零避免下游做相等比較時踩坑。
  const mod = degrees % 360;
  const positive = mod < 0 ? mod + 360 : mod;
  return positive + 0;
}

/**
 * 度轉弧度。
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 弧度轉度。
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * 取得用於 CSS `transform: rotate(...)` 的角度。
 *
 * ============================================================
 * 為什麼需要這個轉換？
 * ============================================================
 * 我們的 Boss facing 約定為「正北 0、順時針」。
 * CSS rotate 在「左上原點、y 向下」座標系中也是「順時針正向」，
 * 因此【旋轉方向】一致，無需翻轉符號。
 *
 * 但要注意：CSS 旋轉的「0 度」對應元素本身的「未旋轉狀態」，
 * 如果 Boss 模型/箭頭的素材原本就「朝上（北）」繪製，那麼
 *   facing = 0   → CSS rotate(0deg)   → 朝上 ✓
 *   facing = 90  → CSS rotate(90deg)  → 朝右（東）✓
 * 兩個系統可直接對應，回傳值即為 facing 本身。
 *
 * 此函數仍獨立存在，原因：
 *   1. 顯式表達「這裡是 CSS 旋轉用的角度」，提升可讀性
 *   2. 若未來改用「朝右」素材，只需改此函數一處（+ -90），呼叫端不動
 *   3. 順便做 normalize，避免極端值
 * ============================================================
 *
 * 【素材繪製規範】所有需旋轉的素材（Boss 模型、面嚮箭頭）一律以「朝上 = 北」繪製。
 *
 * @param facing   Boss facing（度，正北 0、順時針）
 * @returns        CSS rotate 用的度數，已 normalize
 */
export function facingToCssRotation(facing: number): number {
  return normalizeDegrees(facing);
}

/**
 * 計算「從觀察點看向目標點」的方位角（度，正北 0、順時針）。
 *
 * 用途：判定玩家是否站在王的某個方位（例如「王的正後方 90 度扇形內」），
 *      可先算出玩家相對王的方位角，再扣掉王的 facing，落在 [-45, 45] 即為正後方反向。
 *
 * 【實作】
 *   atan2(dy, dx) 給出標準數學角（東 0、逆時針，弧度）。
 *   要轉成「北 0、順時針」需做：
 *     1. 在 y 向下座標系中，atan2(dy, dx) 仍是「東 0、順時針」（因 y 軸已翻轉）
 *     2. 旋轉基準到北 → 加 90 度（北在東的逆時針 90 度，等價於先轉再標）
 *
 *   推導：
 *     atan2(dy, dx) = θ  → 表示「東向順時針 θ」
 *     bearing = θ + 90   → 改以「北向順時針」表達
 *     normalize 到 [0, 360)
 *
 * 邊界：observer 與 target 重合時 atan2(0,0) = 0，回傳 90 度（無實質意義，
 *      呼叫端應自行檢查重合並避免使用此結果）。
 *
 * @param observer   觀察者位置（例如 Boss）
 * @param target     目標位置（例如玩家）
 * @returns          方位角（度，[0, 360)，正北 0 順時針）
 */
export function bearingFromTo(observer: Point2D, target: Point2D): number {
  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const radians = Math.atan2(dy, dx);
  const degreesEastZero = radiansToDegrees(radians);
  // 「東 0 順時針」→「北 0 順時針」需 +90
  return normalizeDegrees(degreesEastZero + 90);
}

/**
 * 取兩個角度的「最短角差」，結果落在 (-180, 180]。
 *
 * 用途：判斷玩家相對王的方位是否落在某扇形角度範圍內，
 *      或計算王要轉向的最短旋轉方向。
 *
 * 範例：
 *   shortestAngleDiff(10, 350)  →  20  （順時針 20 度即抵達）
 *   shortestAngleDiff(350, 10)  → -20  （逆時針 20 度，亦即「to 在 from 的逆時針側」）
 *   shortestAngleDiff(0, 180)   → 180  （正對面，慣例取正值）
 *
 * @param fromDegrees   起始角度
 * @param toDegrees     目標角度
 * @returns             最短角差（度，落在 (-180, 180]，正值代表順時針）
 */
export function shortestAngleDiff(fromDegrees: number, toDegrees: number): number {
  const diff = normalizeDegrees(toDegrees - fromDegrees);
  // 若大於 180，代表逆時針較近，轉為負值表達。
  // 注意：等於 180 時保留正值（正對面，順/逆都一樣，慣例取正）。
  return diff > 180 ? diff - 360 : diff;
}
