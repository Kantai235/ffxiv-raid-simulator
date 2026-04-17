import type { Arena } from './arena';

/**
 * 副本（Instance）- 資料模型最上層。
 *
 * 一個 Instance 對應遊戲內的一個高難度副本，例如：
 *   - 「阿卡迪亞零式輕量級 M1S」
 *   - 「絕奧米茄狂詩曲」
 *
 * 一個 Instance 之下可掛載多組 Strategy（攻略組），
 * 並擁有屬於自己的所有 Question（題目）。
 *
 * Why 這樣切：題目綁副本而非攻略，是為了「同一道機制題可套用不同攻略組」
 *            （只是場地標記位置變了，機制本身不變）。
 */
export interface Instance {
  /**
   * 唯一識別碼，用於 strategyId / questionId 的外鍵關聯。
   * 慣例採用副本縮寫小寫，例如：'m1s', 'fru', 'ucob'。
   */
  id: string;

  /** 顯示名稱（繁體中文） */
  name: string;

  /** 副本縮寫，用於 UI 角標顯示。例如 'M1S' */
  shortName: string;

  /** 場地資訊 */
  arena: Arena;

  /**
   * 標籤，用於前台篩選與分類顯示。
   * 例如：['零式', '輕量級', '7.x']。
   */
  tags?: string[];
}

/**
 * 副本索引條目 - 用於 index.json 列出系統支援的副本清單。
 *
 * Why: CLAUDE.md 決議按副本拆檔懶載入，玩家在前台選副本時，
 *      只需先載入索引檔（輕量），選定後再 fetch 該副本完整 JSON。
 */
export interface InstanceIndexEntry {
  /** 對應 Instance.id */
  id: string;
  /** 顯示名稱 */
  name: string;
  /** 簡稱 */
  shortName: string;
  /** 該副本詳細 JSON 的相對路徑，例如 'assets/data/m1s.json' */
  dataPath: string;
  /** 該副本資料檔的 schema 版本（預檢用） */
  schemaVersion: string;
  /** 縮圖（選填），用於選擇畫面 */
  thumbnail?: string;
  /** 標籤 */
  tags?: string[];
}
