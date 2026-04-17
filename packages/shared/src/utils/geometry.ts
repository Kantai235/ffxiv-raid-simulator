import type {
  CircleArea,
  Point2D,
  PolygonArea,
  RectArea,
  SafeArea,
} from '../types/geometry';

/**
 * ========================================================================
 * 幾何命中判定 - 純函數實作
 * ========================================================================
 *
 * 【座標系】所有座標皆採 geometry.ts 開頭定義的「左上原點、y 向下」邏輯座標。
 *
 * 【邊界政策】所有命中判定一律「點在邊界上 = 命中」（含等號）。
 *   Why: 對玩家有利，避免浮點誤差導致「明明站在安全區邊緣卻被判失敗」。
 *        此政策必須對所有形狀（圓/矩/多邊形）一致，否則回顧畫面會出現
 *        玩家點在 A 形狀的邊緣判中、在 B 形狀的邊緣判錯的詭異情況。
 *
 * 【浮點容差】比較使用 EPSILON 容差（1e-9）。對於 1000×1000 的場地，
 *   此精度遠超螢幕像素解析度，玩家不可能感受到差異，但能吸收 JS 浮點誤差。
 *
 * 【純函數】所有函數無副作用、不修改入參、相同輸入恆得相同輸出。
 *   方便單元測試、回顧模式回放、未來改寫成 Web Worker 平行運算。
 * ========================================================================
 */

/**
 * 浮點比較容差。
 * 1e-9 在 1000×1000 場地下對應 1e-12 的相對誤差，
 * 遠小於螢幕像素（1/1000），實務上等同於精確比較。
 */
export const EPSILON = 1e-9;

/**
 * 「a 是否小於等於 b（容差內）」。
 * Why: 用於邊界判定，吸收 JavaScript 浮點減法誤差（例如 0.1+0.2 !== 0.3）。
 */
function lessOrEqual(a: number, b: number): boolean {
  return a <= b + EPSILON;
}

// ========================================================================
// 圓形命中判定
// ========================================================================

/**
 * 判斷點是否落在圓形安全區內（含邊界）。
 *
 * 演算法：比較「點到圓心距離平方」與「半徑平方」，避免不必要的開方運算。
 * 開方雖然在現代 CPU 上很快，但保持平方比較有兩個額外好處：
 *   1. 避免 sqrt 引入的浮點誤差
 *   2. 在批次判定大量點（例如熱力圖）時效能稍佳
 *
 * @param point        待判定的點（場地邏輯座標）
 * @param circle       圓形安全區
 * @returns            點是否在圓內或圓周上
 */
export function isPointInCircle(point: Point2D, circle: CircleArea): boolean {
  const dx = point.x - circle.center.x;
  const dy = point.y - circle.center.y;
  const distanceSquared = dx * dx + dy * dy;
  const radiusSquared = circle.radius * circle.radius;
  return lessOrEqual(distanceSquared, radiusSquared);
}

// ========================================================================
// 矩形（AABB）命中判定
// ========================================================================

/**
 * 判斷點是否落在矩形安全區內（含邊界）。
 *
 * 矩形採 AABB（軸對齊矩形）：(x, y) 為左上角，width/height 向右下延伸。
 * 不支援旋轉矩形 - 若需斜矩形請改用 PolygonArea 表達。
 *
 * @param point        待判定的點
 * @param rect         矩形安全區
 * @returns            點是否在矩形內或邊上
 */
export function isPointInRect(point: Point2D, rect: RectArea): boolean {
  // 注意：因「邊界算命中」政策，左上邊界與右下邊界都用 lessOrEqual。
  return (
    lessOrEqual(rect.x, point.x) &&
    lessOrEqual(point.x, rect.x + rect.width) &&
    lessOrEqual(rect.y, point.y) &&
    lessOrEqual(point.y, rect.y + rect.height)
  );
}

// ========================================================================
// 多邊形命中判定（射線法 + 邊界特判）
// ========================================================================

/**
 * 判斷點是否落在線段上（含端點）。
 *
 * Why 獨立此函數：射線法（ray-casting）對「點剛好在多邊形邊或頂點上」
 *      會產生不確定結果（射線正好穿過頂點時，計數可能為 0 或 2）。
 *      因此先做邊界特判：若點在任一邊上 → 直接回傳 true，繞開奇異點。
 *
 * 演算法：
 *   1. 共線判定：叉積 (b-a) × (p-a) 的絕對值 ≤ EPSILON
 *   2. 範圍判定：p 的座標必須位於 a、b 構成的軸對齊包圍盒內
 *   兩者皆成立 → p 在線段 ab 上。
 *
 * @internal
 */
function isPointOnSegment(p: Point2D, a: Point2D, b: Point2D): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > EPSILON) {
    return false; // 不共線
  }
  // 共線後，檢查 p 是否落在 a-b 的軸對齊包圍盒內
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    lessOrEqual(minX, p.x) &&
    lessOrEqual(p.x, maxX) &&
    lessOrEqual(minY, p.y) &&
    lessOrEqual(p.y, maxY)
  );
}

/**
 * 判斷點是否落在多邊形內（含邊界）- 射線法（Ray-casting）。
 *
 * ============================================================
 * 演算法：水平射線 + 邊交叉計數
 * ============================================================
 * 從待判點向右發射一條水平射線（→ +x 方向），計算射線與多邊形邊的交點數：
 *   - 奇數次交叉 → 點在多邊形內
 *   - 偶數次交叉 → 點在多邊形外
 *
 * 此方法對任意「簡單多邊形」（邊不自相交）皆有效，凹凸不限。
 *
 * 【關鍵實作細節 - 避免奇異點】
 *   - 邊界特判：先檢查點是否在任一邊上，若是直接回傳 true（見上方 isPointOnSegment）。
 *     繞開「射線正好穿過頂點」會導致計數錯誤的問題。
 *   - 邊半開區間：判定射線與邊相交時，y 範圍採 [yi, yj) 半開區間
 *     （`(yi > p.y) !== (yj > p.y)`），確保射線穿過頂點時只算一次。
 *
 * 【複雜度】O(n)，n = 多邊形頂點數。
 *
 * 【限制】不處理自相交多邊形（結果未定義）。後台應在框選時禁止使用者拉出自相交形狀。
 *
 * @param point        待判定的點
 * @param polygon      多邊形安全區（至少 3 個頂點）
 * @returns            點是否在多邊形內或邊上
 */
export function isPointInPolygon(point: Point2D, polygon: PolygonArea): boolean {
  const points = polygon.points;
  // 退化多邊形（少於 3 點）不構成面積，視為永遠不命中。
  // 後台應在輸出 JSON 前驗證避免此情況，這裡僅做防禦性處理。
  if (points.length < 3) {
    return false;
  }

  // 步驟 1：邊界特判 - 點在任一邊上 → 命中
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (isPointOnSegment(point, points[j], points[i])) {
      return true;
    }
  }

  // 步驟 2：射線法計數
  // 變數命名沿用經典實作慣例（i = 當前頂點、j = 前一頂點）以利對照演算法文獻。
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;

    // 邊 (j → i) 是否「跨越」水平射線 y = point.y。
    // 採半開區間 (yi > p.y) !== (yj > p.y)：當邊的端點剛好在射線上時只算一次，
    // 避免射線穿過共享頂點的兩條邊被計數兩次。
    const straddles = yi > point.y !== yj > point.y;
    if (!straddles) continue;

    // 計算邊與射線 y = point.y 的交點 x 座標，
    // 若交點在 point.x 右側 → 射線穿過此邊，計數翻轉。
    const intersectX = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (point.x < intersectX) {
      inside = !inside;
    }
  }
  return inside;
}

// ========================================================================
// 統一入口：依 SafeArea 多型分派
// ========================================================================

/**
 * 統一命中判定入口 - 依 SafeArea.shape 自動分派到對應演算法。
 *
 * 前台命中判定主要呼叫此函數，避免到處 switch。
 *
 * @param point      待判定的點
 * @param safeArea   任意形狀的安全區
 * @returns          點是否落在安全區內或邊界上
 */
export function isPointInSafeArea(point: Point2D, safeArea: SafeArea): boolean {
  switch (safeArea.shape) {
    case 'circle':
      return isPointInCircle(point, safeArea);
    case 'rect':
      return isPointInRect(point, safeArea);
    case 'polygon':
      return isPointInPolygon(point, safeArea);
    default: {
      // 編譯期保護：若未來新增形狀但忘了在此處理，TS 會在此行報錯。
      const _exhaustive: never = safeArea;
      throw new Error(`未支援的 SafeArea shape: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ========================================================================
// 旋轉變換 - 用於 Boss-relative 機制
// ========================================================================

/**
 * 將點繞指定圓心旋轉指定角度。
 *
 * ============================================================
 * 【角度系約定 - 與 BossState.facing 一致】
 * ============================================================
 *   - 0   度 = 向北（畫面上方，y 軸負方向）
 *   - 90  度 = 向東（x 軸正方向）
 *   - 180 度 = 向南
 *   - 270 度 = 向西
 *
 * 旋轉方向：在「左上原點、y 向下」座標系中，正角度代表【順時針旋轉】
 *           （與羅盤方位轉動方向一致，與 FFXIV True North 巨集一致）。
 *
 * Why 這樣定義：FFXIV 玩家社群一律以「正北 0、順時針」描述方位，
 *               若採用標準數學角（東 0、逆時針）會增加心智轉換負擔。
 *
 * 【數學推導】
 * 在標準數學座標（y 向上、逆時針）中，繞原點旋轉 θ 的公式為：
 *   x' = x·cos(θ) − y·sin(θ)
 *   y' = x·sin(θ) + y·cos(θ)
 *
 * 我們的座標 y 向下（DOM 慣例），等同於對 y 軸取負後做標準旋轉再取負。
 * 推導後：對「y 向下 + 順時針正向」的座標，旋轉公式仍為上式（直接套用）。
 * 這是因為兩次「y 軸翻轉」與「旋轉方向反轉」彼此抵消。
 * ============================================================
 *
 * @param point      被旋轉的點
 * @param center     旋轉中心
 * @param degrees    旋轉角度（度，正北 0、順時針正向）
 * @returns          旋轉後的新點（新物件，不修改原入參）
 */
export function rotatePoint(point: Point2D, center: Point2D, degrees: number): Point2D {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // 1. 平移使旋轉中心成為原點
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  // 2. 旋轉（公式見上方推導）
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  // 3. 平移回原座標系
  return { x: rx + center.x, y: ry + center.y };
}

/**
 * 將「Boss-relative 座標」轉為「世界座標」。
 *
 * ============================================================
 * 【概念說明】
 * ============================================================
 * 出題時，許多機制（扇形 AOE、王正面/背面安全區等）以「王朝北時的相對座標」
 * 描述最為直觀。例如：「王正前方 100 單位的扇形」可定義為以王為原點、
 * 朝 (0, -100) 延伸的扇形（y 向下，所以正前方是 -y）。
 *
 * 但實際遊戲中王的面嚮會變動，前台繪製與命中判定需要「世界座標」。
 * 此函數負責這個轉換：
 *   1. 把相對座標當作「王朝北時」的座標
 *   2. 依 bossFacing 旋轉（王朝東 = 整個相對座標系順時針轉 90 度）
 *   3. 平移到王在世界中的實際位置
 *
 * @param relativePoint  以王為原點、王朝北時定義的相對座標
 * @param bossPosition   王在世界座標中的實際位置
 * @param bossFacing     王的面嚮（度，正北 0、順時針）
 * @returns              對應的世界座標
 *
 * 【使用範例】
 *   王在 (500, 500)，朝東（90 度）。
 *   出題者定義「王正前方 100 單位」= 相對座標 (0, -100)。
 *   呼叫 toWorldCoord({x:0, y:-100}, {x:500, y:500}, 90)
 *   結果：王朝東時，「正前方」變成世界的東方 → 應為 (600, 500)。
 *   驗證：(0,-100) 順時針旋轉 90 度 = (100, 0)，加上 (500,500) = (600, 500) ✓
 * ============================================================
 */
export function toWorldCoord(
  relativePoint: Point2D,
  bossPosition: Point2D,
  bossFacing: number,
): Point2D {
  // 先繞原點 (0,0) 旋轉，再平移到 bossPosition。
  // 等同於 rotatePoint(relativePoint + bossPosition, bossPosition, bossFacing)，
  // 但分開做可省一次加減運算，且語意更清晰。
  const rotated = rotatePoint(relativePoint, { x: 0, y: 0 }, bossFacing);
  return { x: rotated.x + bossPosition.x, y: rotated.y + bossPosition.y };
}

/**
 * 將「世界座標」轉回「Boss-relative 座標」。
 *
 * 用途：玩家在世界座標點擊後，若題目的安全區是用 boss-relative 定義的，
 *      可將點擊點轉回 boss-relative 再做命中判定（避免每次旋轉所有安全區）。
 *
 * 此函數為 toWorldCoord 的逆運算。
 *
 * @param worldPoint     世界座標
 * @param bossPosition   王的實際位置
 * @param bossFacing     王的面嚮（度）
 * @returns              對應的 boss-relative 座標
 */
export function toBossRelativeCoord(
  worldPoint: Point2D,
  bossPosition: Point2D,
  bossFacing: number,
): Point2D {
  // 1. 平移到以王為原點
  const translated: Point2D = {
    x: worldPoint.x - bossPosition.x,
    y: worldPoint.y - bossPosition.y,
  };
  // 2. 反向旋轉（負角度）抵消王的面嚮
  return rotatePoint(translated, { x: 0, y: 0 }, -bossFacing);
}
