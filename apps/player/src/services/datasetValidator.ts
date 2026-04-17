import {
  DatasetValidationError,
  assertValidInstanceDataset as sharedAssert,
  type InstanceDataset,
} from '@ffxiv-sim/shared';
import { DatasetLoadError } from './dataset';

/**
 * ========================================================================
 * Player 端自訂題庫匯入驗證 - 包裝 shared validator
 * ========================================================================
 *
 * 共用的驗證規則定義於 packages/shared/src/utils/validateDataset.ts；
 * 此檔負責將 shared 的 DatasetValidationError 包成 Player UI 熟悉的
 * DatasetLoadError，維持 UI 層（CustomImportZone / settings store）只需
 * catch 單一錯誤型別。
 *
 * 好處：
 *   1. Editor 與 Player 兩邊共用同一份驗證邏輯，規則不漂移
 *   2. Player UI 與測試不需要改動（對外 API 不變）
 *   3. Editor 可自由決定包裝成自家錯誤型別或直接用 shared 型別
 * ========================================================================
 */

const IMPORT_PATH_LABEL = '<匯入檔案>';

/**
 * 驗證並將未知輸入收斂為 InstanceDataset 型別。
 *
 * @throws DatasetLoadError（由 shared 的 DatasetValidationError 轉換而來）
 */
export function assertValidInstanceDataset(
  data: unknown,
): asserts data is InstanceDataset {
  try {
    sharedAssert(data);
  } catch (err) {
    if (err instanceof DatasetValidationError) {
      // reason 欄位一對一對映到 DatasetLoadError，UI 分支邏輯不變
      throw new DatasetLoadError(err.reason, IMPORT_PATH_LABEL, err.message, {
        cause: err,
      });
    }
    throw err;
  }
}

/**
 * 檔案內容 → 經驗證的 InstanceDataset。
 *
 * 組合 JSON.parse + assertValidInstanceDataset，統一錯誤為 DatasetLoadError。
 * UI 呼叫端只需捕 DatasetLoadError 就能涵蓋全部失敗情境。
 *
 * @throws DatasetLoadError reason='parse' 或 'schema-version'
 */
export function parseAndValidateDataset(text: string): InstanceDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DatasetLoadError(
      'parse',
      IMPORT_PATH_LABEL,
      `JSON 解析失敗：${cause instanceof Error ? cause.message : '未知錯誤'}`,
      { cause },
    );
  }
  assertValidInstanceDataset(parsed);
  return parsed;
}
