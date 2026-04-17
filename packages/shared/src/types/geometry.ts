/**
 * 幾何型別定義 - 地圖座標系統。
 *
 * ============================================================
 * 【座標系約定 - 全專案唯一真實來源】
 * ============================================================
 * 為避免後台輸出與前台繪製的座標系不一致，全專案統一採用：
 *
 *   - 原點 (0, 0)：場地圖片的【左上角】（與 HTML Canvas / DOM 一致）
 *   - x 軸：向右為正
 *   - y 軸：向下為正（注意：與數學課的 y 軸方向相反）
 *   - 單位：以 Arena.size 定義的「邏輯座標」，前台渲染時再縮放至實際螢幕尺寸
 *
 * Why: 採用 DOM/Canvas 原生座標系，可避免每次繪製或處理點擊事件時都要做
 *      Y 軸翻轉，減少 bug。後台框選與前台命中判定共用同一座標系。
 *
 * 注意：FFXIV 遊戲內座標 (X/Y/Z) 與此座標系【無關】，本專案不使用遊戲內座標。
 * ============================================================
 */

/**
 * 二維點座標。
 * x、y 皆為 Arena 邏輯座標（左上原點，y 向下）。
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * 所有 SafeArea 共用的選填識別欄位。
 *
 * Why 選填：editor 在 commit 時會自動分配 id 用於選取/刪除特定形狀；
 *           但既有手寫 dataset 沒有 id 也能正常被 player 載入運作
 *           （player 端命中判定不依賴 id，僅依靠 shape 與幾何欄位）。
 */
interface SafeAreaIdentifiable {
  /** 選填 - editor 分配的唯一識別碼，給編輯器選取/刪除用 */
  id?: string;
}

/**
 * 圓形區域。
 * 用於：散開點名安全區、單一定點安全區。
 */
export interface CircleArea extends SafeAreaIdentifiable {
  shape: 'circle';
  /** 圓心座標 */
  center: Point2D;
  /** 半徑（邏輯座標單位） */
  radius: number;
}

/**
 * 矩形區域（軸對齊矩形 AABB）。
 * 用於：四象限安全區、長條形安全區。
 *
 * 約定：(x, y) 為左上角座標，width/height 向右下延伸。
 */
export interface RectArea extends SafeAreaIdentifiable {
  shape: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 多邊形區域（任意凸/凹多邊形）。
 * 用於：扇形/不規則安全區（後台用滑鼠依序點擊頂點繪製）。
 *
 * points 至少需 3 個頂點，以閉合順序排列（順時針或逆時針皆可，
 * 命中判定使用 ray-casting 演算法，不受方向影響）。
 */
export interface PolygonArea extends SafeAreaIdentifiable {
  shape: 'polygon';
  points: Point2D[];
}

/**
 * 安全區的多型聯合 - 命中判定函式需 switch 處理所有 shape。
 *
 * 設計理由：不同機制的安全區形狀差異大（散開→圓、分組→矩形、扇形避開→多邊形），
 * 統一抽象為 SafeArea 後，前台命中判定函式可單一入口處理所有題型。
 */
export type SafeArea = CircleArea | RectArea | PolygonArea;
