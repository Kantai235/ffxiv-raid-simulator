/**
 * ========================================================================
 * Dataset 載入服務 - 唯讀 fetch 靜態 JSON
 * ========================================================================
 *
 * 【架構邊界】CLAUDE.md 第 7 點：Player 前台只能唯讀載入 data.json，
 *   絕不可包含寫檔邏輯。此檔案僅使用瀏覽器 fetch API。
 *
 * 【載入流程】
 *   1. 玩家進入設定畫面 → fetchIndex() 取得副本清單（輕量）
 *   2. 玩家選定副本 → fetchInstanceData(id) 懶載入該副本完整 JSON
 *   3. 載入後驗證 schema 版本，避免舊資料造成執行期 bug
 *
 * 【路徑來源】依賴 index.json 中 InstanceIndexEntry.dataPath，後台寫入時
 *   應確保此欄位是相對於 player 的 public/ 根目錄。
 * ========================================================================
 */

import {
  MIN_SUPPORTED_MAJOR,
  type DatasetIndex,
  type InstanceDataset,
} from '@ffxiv-sim/shared';

// ========================================================================
// 自訂錯誤型別
// ========================================================================

/**
 * Dataset 載入失敗的所有錯誤都繼承此類別。
 *
 * Why 自訂錯誤類別：
 *   - UI 層可用 `instanceof DatasetLoadError` 統一捕捉題庫相關錯誤
 *   - reason 欄位讓上層精準分支處理（網路錯 vs 解析錯 vs 版本錯）
 *   - cause 保留原始錯誤方便 console 除錯
 */
export class DatasetLoadError extends Error {
  /** 錯誤分類，UI 可依此顯示不同訊息 */
  readonly reason: 'network' | 'http' | 'parse' | 'schema-version' | 'unknown';
  /** 嘗試載入的路徑（用於錯誤訊息與除錯） */
  readonly path: string;

  constructor(
    reason: DatasetLoadError['reason'],
    path: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DatasetLoadError';
    this.reason = reason;
    this.path = path;
  }
}

// ========================================================================
// 路徑解析
// ========================================================================

/**
 * 取得 index.json 的完整 URL。
 *
 * Why 不寫死 '/assets/data/index.json'：
 *   GitHub Pages 部署時 base URL 可能是 '/<repo>/'，import.meta.env.BASE_URL
 *   會反映 Vite 設定的 base，避免硬編碼根路徑造成 404。
 */
function resolveIndexPath(): string {
  // import.meta.env.BASE_URL 結尾保證有 '/'，與相對路徑直接拼接
  return `${import.meta.env.BASE_URL}assets/data/index.json`;
}

/**
 * 取得副本資料檔的完整 URL。
 *
 * @param dataPath  index.json 中 InstanceIndexEntry.dataPath（已是相對路徑，
 *                  例如 'assets/data/m1s.json'）
 */
function resolveInstancePath(dataPath: string): string {
  return `${import.meta.env.BASE_URL}${dataPath}`;
}

// ========================================================================
// 共用 fetch + JSON 解析 + 錯誤包裝
// ========================================================================

/**
 * 安全 fetch JSON：將原生錯誤統一轉為 DatasetLoadError。
 *
 * 處理的錯誤情境：
 *   1. fetch reject（網路斷線、CORS）→ reason='network'
 *   2. response.ok === false（404、500）  → reason='http'
 *   3. response.json() 解析失敗（檔案不是合法 JSON）→ reason='parse'
 *
 * 注意：此函數不驗證資料 shape，shape 驗證由呼叫端（檢查 schemaVersion）負責。
 *      Why: shape validation 屬於業務邏輯，與「能否成功讀到 JSON」是兩件事。
 */
async function safeFetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch (cause) {
    throw new DatasetLoadError(
      'network',
      path,
      `無法連線至題庫檔案：${path}`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new DatasetLoadError(
      'http',
      path,
      `題庫檔案讀取失敗（HTTP ${response.status}）：${path}`,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new DatasetLoadError(
      'parse',
      path,
      `題庫檔案 JSON 解析失敗：${path}`,
      { cause },
    );
  }
}

/**
 * 驗證 schema major 版本是否被當前前台支援。
 *
 * Why 只檢查 major 不檢查 minor：
 *   依 CLAUDE.md 與 shared/constants/schema.ts 約定，minor 為向下相容的新增，
 *   舊前台對未知 minor 應「忽略不認識的欄位」而非報錯。
 *
 * @throws DatasetLoadError reason='schema-version'
 */
function assertSchemaCompatible(schemaVersion: string, path: string): void {
  const majorStr = schemaVersion.split('.')[0];
  const major = Number.parseInt(majorStr, 10);
  if (Number.isNaN(major) || major < MIN_SUPPORTED_MAJOR) {
    throw new DatasetLoadError(
      'schema-version',
      path,
      `題庫 schema 版本不相容（檔案：${schemaVersion}，前台最低支援：${MIN_SUPPORTED_MAJOR}.x）`,
    );
  }
}

// ========================================================================
// 對外 API
// ========================================================================

/**
 * 載入副本索引檔（index.json）。
 *
 * 在玩家進入設定畫面時呼叫，取得可選的副本列表。
 *
 * @throws DatasetLoadError 任何載入或解析失敗
 */
export async function fetchIndex(): Promise<DatasetIndex> {
  const path = resolveIndexPath();
  const data = await safeFetchJson<DatasetIndex>(path);
  assertSchemaCompatible(data.schemaVersion, path);
  return data;
}

/**
 * 載入指定副本的完整資料檔。
 *
 * @param entry  index.json 中對應的索引條目（含 dataPath 與 schemaVersion 預檢資訊）
 * @returns      完整 InstanceDataset
 * @throws       DatasetLoadError
 */
export async function fetchInstanceData(entry: {
  dataPath: string;
  schemaVersion: string;
}): Promise<InstanceDataset> {
  // 預檢：在發出 fetch 前先擋下不相容版本，省一次網路請求
  // Why: index.json 已宣告每個副本的 schemaVersion，無需等載入完才檢查
  assertSchemaCompatible(entry.schemaVersion, entry.dataPath);

  const path = resolveInstancePath(entry.dataPath);
  const data = await safeFetchJson<InstanceDataset>(path);

  // 二次檢查：實際檔案的 schemaVersion 與 index 宣告應一致
  // Why: 出題者可能更新了檔案 schemaVersion 但忘了同步 index.json
  assertSchemaCompatible(data.schemaVersion, path);

  return data;
}
