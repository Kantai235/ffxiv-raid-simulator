import type { DebuffDefinition } from './debuff';
import type { Instance, InstanceIndexEntry } from './instance';
import type { Question } from './question';
import type { Strategy } from './strategy';

/**
 * 單一副本的完整資料檔結構（對應 assets/data/<instanceId>.json）。
 *
 * 載入流程：
 *   1. 前台啟動 → fetch index.json 取得副本列表
 *   2. 玩家選定副本 → fetch 對應的 InstanceDataset
 *   3. 解析後存入 Pinia store，供練習與回顧使用
 */
export interface InstanceDataset {
  /**
   * Schema 版本（major.minor）。
   * 前台載入時必須驗證此欄位，major 不符則拒絕載入。
   * 見 constants/schema.ts 的 SCHEMA_VERSION。
   */
  schemaVersion: string;

  /** 副本本身的 metadata（僅 1 筆，與 index.json 對應） */
  instance: Instance;

  /** 該副本的所有攻略組（至少 1 筆） */
  strategies: Strategy[];

  /** 該副本的所有題目 */
  questions: Question[];

  /**
   * 該副本所用到的 debuff 定義庫。
   *
   * Why 放在副本層而非全域：不同副本的 debuff 圖示與名稱可能重複但語意不同
   *      （例如「死宣」在不同副本秒數不同），各副本獨立維護避免衝突。
   *      若未來確實有跨副本共用需求，再考慮提升到全域層。
   */
  debuffLibrary: DebuffDefinition[];
}

/**
 * 索引檔結構（對應 assets/data/index.json）。
 *
 * 前台啟動時第一個載入的檔案，僅含輕量元資料。
 */
export interface DatasetIndex {
  schemaVersion: string;
  instances: InstanceIndexEntry[];
}
