/**
 * Debuff（玩家身上狀態）資料庫條目。
 *
 * Why 抽出共用：許多題目會重複用到「散開點名」「分組分擔」等通用 debuff，
 *      若每題重複塞圖片路徑與名稱，維護困難（換圖要改 N 處）。
 *      因此 data.json 內維護一個 debuffLibrary，題目只引用 id。
 */
export interface DebuffDefinition {
  /** 唯一識別碼，例如 'spread-marker', 'share-tank-buster' */
  id: string;

  /** 顯示名稱（繁體中文） */
  name: string;

  /**
   * Debuff 圖示路徑（相對於 player 的 public/）。
   * 例如：'assets/debuffs/spread.png'。
   *
   * CLAUDE.md 第 9 點：載入失敗時前台需顯示 placeholder，不可崩潰。
   */
  icon: string;

  /**
   * 顯示用倒數秒數（選填）。
   * 用於模擬「玩家身上 debuff 還剩 X 秒爆炸」的視覺壓力。
   * 若不填則前台不顯示倒數，僅顯示靜態圖示。
   */
  duration?: number;

  /** 補充描述（hover tooltip 用） */
  description?: string;
}
