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

  // 取出 arena.grid 一次，供後續 arenaMask 邊界檢查使用
  // 由 assertValidInstance 保證 instance / arena 已存在且為物件
  const arena = (data.instance as Record<string, unknown>).arena as Record<string, unknown>;
  const gridSize = extractGridSize(arena.grid);

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
    assertValidQuestionExtensions(q, i, gridSize);
  }
}

// ========================================================================
// Phase 1 新增：實體與動態場地相關欄位驗證
// ========================================================================

/**
 * 若 arena.grid 存在則驗證其結構並回傳格數；否則回 null。
 *
 * Why 在此一次取出：questions 迴圈中每題都可能檢查 arenaMask 邊界，
 * 事先 resolve 出「總格數」避免在每題重複驗證 grid 結構。
 *
 * @returns  { rows, cols, total } 或 null（表 arena 沒設 grid）
 * @throws   DatasetValidationError  grid 結構不合法
 */
function extractGridSize(
  grid: unknown,
): { rows: number; cols: number; total: number } | null {
  if (grid === undefined) return null;
  if (!isPlainObject(grid)) {
    throw new DatasetValidationError('parse', 'arena.grid 必須為物件');
  }
  const { rows, cols } = grid;
  if (!Number.isInteger(rows) || (rows as number) <= 0) {
    throw new DatasetValidationError('parse', 'arena.grid.rows 必須為正整數');
  }
  if (!Number.isInteger(cols) || (cols as number) <= 0) {
    throw new DatasetValidationError('parse', 'arena.grid.cols 必須為正整數');
  }
  return {
    rows: rows as number,
    cols: cols as number,
    total: (rows as number) * (cols as number),
  };
}

/**
 * 驗證題目的 Phase 1 新欄位：enemies / arenaMask / tethers。
 *
 * 設計原則：欄位皆為選填，未提供則完全略過檢查（向下相容）；
 * 但提供則必須符合結構與邏輯約束（避免「格式不符 + 不驗證」導致執行期崩潰）。
 *
 * @param q        題目物件（已確認為 plain object）
 * @param idx      題目索引（錯誤訊息用）
 * @param gridSize 副本網格總格數，null 表無 grid
 */
function assertValidQuestionExtensions(
  q: Record<string, unknown>,
  idx: number,
  gridSize: { total: number } | null,
): void {
  // ----- enemies -----
  if (q.enemies !== undefined) {
    if (!Array.isArray(q.enemies)) {
      throw new DatasetValidationError('parse', `questions[${idx}].enemies 必須為陣列`);
    }
    for (let j = 0; j < q.enemies.length; j++) {
      const e = q.enemies[j];
      if (!isPlainObject(e)) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].enemies[${j}] 必須為物件`,
        );
      }
      if (typeof e.id !== 'string' || !e.id) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].enemies[${j}].id 必須為非空字串`,
        );
      }
      if (typeof e.name !== 'string') {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].enemies[${j}].name 必須為字串`,
        );
      }
      if (typeof e.facing !== 'number' || !Number.isFinite(e.facing)) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].enemies[${j}].facing 必須為有限數值`,
        );
      }
      if (!isPlainObject(e.position)) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].enemies[${j}].position 必須為物件`,
        );
      }
      if (typeof e.position.x !== 'number' || typeof e.position.y !== 'number') {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].enemies[${j}].position 需含數值 x / y`,
        );
      }
    }
  }

  // ----- arenaMask -----
  // 只有「提供且非空」才強制需要 grid；空陣列視同未使用（向下相容編輯中暫存）
  if (q.arenaMask !== undefined) {
    if (!Array.isArray(q.arenaMask)) {
      throw new DatasetValidationError(
        'parse',
        `questions[${idx}].arenaMask 必須為數字陣列`,
      );
    }
    if (q.arenaMask.length > 0) {
      if (!gridSize) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].arenaMask 有資料但所屬 arena 未設定 grid（需先在 arena.grid 定義 rows/cols）`,
        );
      }
      for (let j = 0; j < q.arenaMask.length; j++) {
        const v = q.arenaMask[j];
        if (!Number.isInteger(v)) {
          throw new DatasetValidationError(
            'parse',
            `questions[${idx}].arenaMask[${j}] 必須為整數`,
          );
        }
        if ((v as number) < 0 || (v as number) >= gridSize.total) {
          throw new DatasetValidationError(
            'parse',
            `questions[${idx}].arenaMask[${j}] (${v}) 超出 grid 範圍 [0, ${gridSize.total - 1}]`,
          );
        }
      }
    }
  }

  // ----- tethers -----
  if (q.tethers !== undefined) {
    if (!Array.isArray(q.tethers)) {
      throw new DatasetValidationError('parse', `questions[${idx}].tethers 必須為陣列`);
    }
    const allowedColors = new Set(['red', 'blue', 'purple', 'yellow', 'green']);
    for (let j = 0; j < q.tethers.length; j++) {
      const t = q.tethers[j];
      if (!isPlainObject(t)) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].tethers[${j}] 必須為物件`,
        );
      }
      if (typeof t.sourceId !== 'string' || !t.sourceId) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].tethers[${j}].sourceId 必須為非空字串`,
        );
      }
      if (typeof t.targetId !== 'string' || !t.targetId) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].tethers[${j}].targetId 必須為非空字串`,
        );
      }
      if (typeof t.color !== 'string' || !allowedColors.has(t.color)) {
        throw new DatasetValidationError(
          'parse',
          `questions[${idx}].tethers[${j}].color 必須為 ${[...allowedColors].join(' | ')}`,
        );
      }
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
