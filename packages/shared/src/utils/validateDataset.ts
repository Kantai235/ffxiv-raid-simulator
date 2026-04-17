import { MIN_SUPPORTED_MAJOR } from '../constants/schema';
import type { InstanceDataset } from '../types/dataset';

/**
 * ========================================================================
 * InstanceDataset 結構驗證 - 純函數
 * ========================================================================
 *
 * 供 Player 匯入與 Editor 載入兩端共用。驗證通過即保證下游可安全存取
 * dataset.instance.arena / dataset.strategies / dataset.questions 等欄位。
 *
 * 【三層驗證策略】
 *   L1 結構：top-level 必要欄位齊全且型別正確
 *   L2 Schema 版本：與 constants/schema.ts 的 MIN_SUPPORTED_MAJOR 比對
 *   L3 內層輕度檢查：instance.arena 存在、strategies/questions 為 array
 *
 * 【錯誤型別】
 *   所有驗證失敗統一丟 DatasetValidationError，呼叫端（Player / Editor）
 *   可依需要 catch 後包裝為自家的錯誤型別（DatasetLoadError 等）。
 *
 * 【為何放 shared 而非各 app 內】
 *   Player 的匯入與 Editor 的 loadDataset 都需要這個驗證。
 *   放在 shared 避免兩邊各寫一份導致規則漂移。
 * ========================================================================
 */

/**
 * Dataset 結構驗證失敗的統一錯誤型別。
 *
 * reason:
 *   - 'parse'          : 結構或欄位型別錯誤
 *   - 'schema-version' : schemaVersion 缺失、非字串、或 major 版本過舊
 */
export class DatasetValidationError extends Error {
  readonly reason: 'parse' | 'schema-version';

  constructor(reason: DatasetValidationError['reason'], message: string) {
    super(message);
    this.name = 'DatasetValidationError';
    this.reason = reason;
  }
}

/**
 * 檢查 value 是否為 plain object（排除 null / array）。
 * Array.isArray 明確排除；Object.prototype.toString 處理 edge case。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/**
 * 驗證 schemaVersion 欄位格式與版本支援度。
 *
 * @throws DatasetValidationError reason='schema-version'
 */
function assertValidSchemaVersion(data: Record<string, unknown>): void {
  const v = data.schemaVersion;
  if (typeof v !== 'string') {
    throw new DatasetValidationError(
      'schema-version',
      '資料缺少 schemaVersion 欄位或型別錯誤',
    );
  }
  const majorStr = v.split('.')[0];
  const major = Number.parseInt(majorStr, 10);
  if (Number.isNaN(major) || major < MIN_SUPPORTED_MAJOR) {
    throw new DatasetValidationError(
      'schema-version',
      `題庫 schema 版本不相容（檔案：${v}，前台最低支援：${MIN_SUPPORTED_MAJOR}.x）`,
    );
  }
}

/**
 * 驗證 instance 欄位的基本結構。
 *
 * 要求：
 *   - 是物件
 *   - 有 id（string）、name（string）、arena（物件）
 *   - arena 有 size（物件）、center（物件）、shape 為 'square' | 'circle'
 */
function assertValidInstance(data: Record<string, unknown>): void {
  const instance = data.instance;
  if (!isPlainObject(instance)) {
    throw new DatasetValidationError('parse', '資料缺少 instance 欄位或格式錯誤');
  }
  if (typeof instance.id !== 'string' || !instance.id) {
    throw new DatasetValidationError('parse', 'instance.id 必須為非空字串');
  }
  if (typeof instance.name !== 'string') {
    throw new DatasetValidationError('parse', 'instance.name 必須為字串');
  }
  if (!isPlainObject(instance.arena)) {
    throw new DatasetValidationError('parse', 'instance.arena 欄位缺失或格式錯誤');
  }
  const arena = instance.arena;
  if (!isPlainObject(arena.size) || !isPlainObject(arena.center)) {
    throw new DatasetValidationError(
      'parse',
      'instance.arena 必須包含 size 與 center 物件',
    );
  }
  if (arena.shape !== 'square' && arena.shape !== 'circle') {
    throw new DatasetValidationError(
      'parse',
      'instance.arena.shape 必須為 "square" 或 "circle"',
    );
  }
}

/**
 * 驗證並將未知輸入收斂為 InstanceDataset 型別（TypeScript assertion function）。
 *
 * 成功時呼叫端可安全將 data 當作 InstanceDataset 使用。
 *
 * @throws DatasetValidationError 任何驗證失敗
 */
export function assertValidInstanceDataset(
  data: unknown,
): asserts data is InstanceDataset {
  // L1：top-level 結構
  if (!isPlainObject(data)) {
    throw new DatasetValidationError('parse', '資料最外層必須為 JSON 物件');
  }

  // L2：schema 版本
  assertValidSchemaVersion(data);

  // L3：內層必要欄位
  assertValidInstance(data);

  if (!Array.isArray(data.strategies)) {
    throw new DatasetValidationError('parse', 'strategies 必須為陣列');
  }
  if (!Array.isArray(data.questions)) {
    throw new DatasetValidationError('parse', 'questions 必須為陣列');
  }
  if (!Array.isArray(data.debuffLibrary)) {
    throw new DatasetValidationError('parse', 'debuffLibrary 必須為陣列');
  }

  // 每題必須有 strategyId（schema 1.1+ 新增的必要欄位 - 題目綁攻略）
  // 不檢查該 strategyId 是否存在於 strategies 陣列中：
  //   1. 編輯期可能先建題目再建攻略（順序自由）
  //   2. 完整引用檢查會讓 validator 變複雜，且 Player 端載入後會自動過濾孤兒題
  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    if (!isPlainObject(q)) {
      throw new DatasetValidationError('parse', `questions[${i}] 必須為物件`);
    }
    if (typeof q.strategyId !== 'string' || !q.strategyId) {
      throw new DatasetValidationError(
        'parse',
        `questions[${i}].strategyId 必須為非空字串（題目須綁定攻略組）`,
      );
    }
  }
}

/**
 * 快速檢查（不拋錯，回 boolean）- 給 UI 條件渲染用。
 *
 * @returns true 表示 data 是合法 InstanceDataset
 */
export function isValidInstanceDataset(data: unknown): data is InstanceDataset {
  try {
    assertValidInstanceDataset(data);
    return true;
  } catch {
    return false;
  }
}
