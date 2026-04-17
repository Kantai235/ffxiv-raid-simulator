import type { Point2D } from './geometry';

/**
 * 場地輔助線 - 出題者可在場地上繪製的視覺參考線。
 *
 * 用途：標示「中央十字」「45 度切角」「攻略基準線」等視覺輔助，
 *      幫助玩家在練習時依線判斷站位。
 *
 * Why 設計為獨立陣列而非寫死的 grid：
 *   不同副本的安全區切法差異大（4 等分、6 等分、八等分等），
 *   讓出題者依攻略需求自由繪製比預設 grid 更靈活。
 */
export interface ArenaLine {
  /** 唯一識別碼 - 用於 UI 選取與刪除 */
  id: string;
  /** 起點（場地邏輯座標，左上原點） */
  start: Point2D;
  /** 終點 */
  end: Point2D;
  /**
   * 線條顏色（CSS 色字串）。未指定則由 view 套用預設色。
   * 例如：'#10B981'、'rgba(255,255,255,0.3)'
   */
  color?: string;
  /** 線條粗細（邏輯座標單位）。未指定則由 view 套用預設值 */
  thickness?: number;
}

/**
 * 場地形狀。
 *
 * - square: 正方形場地（多數零式戰場，例如 P1S）
 * - circle: 圓形場地（部分絕本/特殊戰場，邊界判定為圓）
 *
 * Why: 影響「玩家點擊是否在場地內」的邊界判定。圓形場地點到角落是無效點擊。
 */
export type ArenaShape = 'square' | 'circle';

/**
 * 副本場地資訊。
 *
 * 邏輯座標說明：見 geometry.ts 開頭的座標系約定。
 * size 是場地的「邏輯尺寸」，與 backgroundImage 的實際像素無關（前台會做縮放）。
 */
export interface Arena {
  /** 場地形狀，影響邊界判定 */
  shape: ArenaShape;

  /**
   * 場地背景圖路徑（相對於 player 的 public/）。
   * 例如：'assets/arenas/m1s.png'
   *
   * 注意：CLAUDE.md 第 9 點要求載入失敗時提供 placeholder，
   * 前台需處理圖片 onerror 事件。
   */
  backgroundImage: string;

  /**
   * 場地的邏輯尺寸（單位與 Point2D 相同）。
   * 建議統一採用 1000x1000，方便所有座標都以「千分比」直觀理解。
   */
  size: { width: number; height: number };

  /**
   * 場地中心點座標（用於計算王的相對方位、放射型機制等）。
   * 通常為 { x: width/2, y: height/2 }，但部分場地中心非幾何中心，
   * 因此獨立欄位顯式宣告，避免後續邏輯誤算。
   *
   * 對 editor 而言，此欄位即為「中心點校正」的編輯目標：
   * 上傳的場地圖若中心不在幾何正中央，調整此值對齊圖中的場地中心。
   */
  center: Point2D;

  /**
   * 場地輔助線（選填）。出題者繪製的視覺參考線，由前台 ArenaMap 渲染。
   * 純視覺用途，不參與命中判定。
   */
  lines?: ArenaLine[];

  /**
   * 網格設定（選填）- 用於「動態場地破壞」機制（如 M1S 捕鼠）。
   *
   * 【網格切分】
   *   場地被切為 rows × cols 個等大矩形網格。index 採 row-major：
   *   index = row * cols + col（左上 0、右下 rows*cols - 1）。
   *
   * 【與命中判定的關係】
   *   Phase 1 僅作為「題目指定破碎格」的座標系參考 + 視覺渲染用；
   *   不參與安全區命中判定（玩家站在破碎格上的懲罰邏輯留待後續）。
   *
   * 【為何放 Arena 而非 Question】
   *   切分規則由副本結構決定（M1S 是 4×4 而非 3×5），全副本共用同一網格；
   *   哪幾格碎裂才是 Question.arenaMask 的個別題目狀態。
   */
  grid?: {
    rows: number;
    cols: number;
  };
}
