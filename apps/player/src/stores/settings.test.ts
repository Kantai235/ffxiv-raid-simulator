import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceDataset } from '@ffxiv-sim/shared';
import { useSettingsStore } from './settings';
import * as datasetService from '../services/dataset';

/**
 * ========================================================================
 * Settings Store 測試
 * ========================================================================
 * 重點：
 *   1. canStart 的三條件 AND 邏輯
 *   2. 重置連動：換副本 → 清攻略+職能；換攻略 → 清職能
 *   3. fetch 失敗時 error 訊息正確設定且不污染 state
 *
 * 用 vi.spyOn 替換 service 模組，避免真的發 HTTP 請求。
 * ========================================================================
 */

const mockIndex = {
  schemaVersion: '1.0',
  instances: [
    {
      id: 'm1s',
      name: 'M1S',
      shortName: 'M1S',
      dataPath: 'assets/data/m1s.json',
      schemaVersion: '1.0',
    },
    {
      id: 'm2s',
      name: 'M2S',
      shortName: 'M2S',
      dataPath: 'assets/data/m2s.json',
      schemaVersion: '1.0',
    },
  ],
};

// 測試用最小化 dataset - 僅滿足 store 使用到的欄位（filter by strategyId、find by id）
// cast 為 InstanceDataset 以通過型別檢查；未被 store 存取的 Question 欄位不在此 mock 內
const mockDataset = {
  schemaVersion: '1.0',
  instance: {
    id: 'm1s',
    name: 'M1S',
    shortName: 'M1S',
    arena: { shape: 'square' as const, backgroundImage: '', size: { width: 1000, height: 1000 }, center: { x: 500, y: 500 } },
  },
  strategies: [
    { id: 'game8', instanceId: 'm1s', name: 'Game8', waymarks: {} },
    { id: 'soup', instanceId: 'm1s', name: '蘇帕醬', waymarks: {} },
  ],
  // game8 有題目 / soup 無題目 - 覆蓋兩種 canStart 分支
  questions: [{ id: 'q1', strategyId: 'game8' }],
  debuffLibrary: [],
} as unknown as InstanceDataset;

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canStart getter', () => {
  it('三項都未選 → false', () => {
    const store = useSettingsStore();
    expect(store.canStart).toBe(false);
  });

  it('只選副本 → false', async () => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    vi.spyOn(datasetService, 'fetchInstanceData').mockResolvedValue(mockDataset);
    const store = useSettingsStore();
    await store.loadIndex();
    await store.selectInstance('m1s');
    expect(store.canStart).toBe(false);
  });

  it('選了副本 + 攻略，未選職能 → false', async () => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    vi.spyOn(datasetService, 'fetchInstanceData').mockResolvedValue(mockDataset);
    const store = useSettingsStore();
    await store.loadIndex();
    await store.selectInstance('m1s');
    store.selectStrategy('game8');
    expect(store.canStart).toBe(false);
  });

  it('三項皆選 → true', async () => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    vi.spyOn(datasetService, 'fetchInstanceData').mockResolvedValue(mockDataset);
    const store = useSettingsStore();
    await store.loadIndex();
    await store.selectInstance('m1s');
    store.selectStrategy('game8');
    store.selectRole('MT');
    expect(store.canStart).toBe(true);
  });
});

describe('重置連動規則', () => {
  beforeEach(() => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    vi.spyOn(datasetService, 'fetchInstanceData').mockResolvedValue(mockDataset);
  });

  it('換副本 → 攻略與職能應被清空', async () => {
    const store = useSettingsStore();
    await store.loadIndex();

    // 完成全 wizard
    await store.selectInstance('m1s');
    store.selectStrategy('game8');
    store.selectRole('MT');
    expect(store.canStart).toBe(true);

    // 換到 m2s
    await store.selectInstance('m2s');
    expect(store.selectedInstanceId).toBe('m2s');
    expect(store.selectedStrategyId).toBeNull();
    expect(store.selectedRoleId).toBeNull();
    expect(store.canStart).toBe(false);
  });

  it('換副本 → 舊 dataset 應被清空後重 fetch', async () => {
    const fetchSpy = vi.spyOn(datasetService, 'fetchInstanceData');
    const store = useSettingsStore();
    await store.loadIndex();

    await store.selectInstance('m1s');
    expect(store.dataset).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await store.selectInstance('m2s');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('換攻略 → 職能應被清空（同副本內）', async () => {
    const store = useSettingsStore();
    await store.loadIndex();
    await store.selectInstance('m1s');
    store.selectStrategy('game8');
    store.selectRole('MT');

    store.selectStrategy('soup');
    expect(store.selectedStrategyId).toBe('soup');
    expect(store.selectedRoleId).toBeNull();
    // 副本不變，dataset 應仍存在
    expect(store.dataset).not.toBeNull();
  });

  it('reset() 應清空所有選擇與 dataset', async () => {
    const store = useSettingsStore();
    await store.loadIndex();
    await store.selectInstance('m1s');
    store.selectStrategy('game8');
    store.selectRole('MT');

    store.reset();
    expect(store.selectedInstanceId).toBeNull();
    expect(store.selectedStrategyId).toBeNull();
    expect(store.selectedRoleId).toBeNull();
    expect(store.dataset).toBeNull();
    // index 不應被 reset 清掉（避免每次重置都要重 fetch）
    expect(store.index).not.toBeNull();
  });
});

describe('錯誤處理', () => {
  it('loadIndex 失敗時錯誤訊息存於 indexError', async () => {
    vi.spyOn(datasetService, 'fetchIndex').mockRejectedValue(
      new datasetService.DatasetLoadError('network', '/x', '網路斷線'),
    );
    const store = useSettingsStore();
    await store.loadIndex();

    expect(store.indexError).toBe('網路斷線');
    expect(store.index).toBeNull();
    expect(store.isLoadingIndex).toBe(false);
  });

  it('selectInstance fetch 失敗時錯誤訊息存於 datasetError，dataset 為 null', async () => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    vi.spyOn(datasetService, 'fetchInstanceData').mockRejectedValue(
      new datasetService.DatasetLoadError('http', '/x', 'HTTP 500'),
    );
    const store = useSettingsStore();
    await store.loadIndex();
    await store.selectInstance('m1s');

    expect(store.datasetError).toBe('HTTP 500');
    expect(store.dataset).toBeNull();
    expect(store.isLoadingDataset).toBe(false);
    // 即使失敗，selectedInstanceId 仍應被設置（給「重試」按鈕參考）
    expect(store.selectedInstanceId).toBe('m1s');
  });

  it('selectInstance 傳入不存在的 ID → datasetError 提示且不發 fetch', async () => {
    const fetchSpy = vi.spyOn(datasetService, 'fetchInstanceData');
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    const store = useSettingsStore();
    await store.loadIndex();

    await store.selectInstance('nonexistent');
    expect(store.datasetError).toContain('nonexistent');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('成功的 selectInstance 後再次 select 同 ID 應清掉前次的 datasetError', async () => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    const fetchSpy = vi
      .spyOn(datasetService, 'fetchInstanceData')
      .mockRejectedValueOnce(new datasetService.DatasetLoadError('network', '/x', '斷線'))
      .mockResolvedValueOnce(mockDataset);
    const store = useSettingsStore();
    await store.loadIndex();

    await store.selectInstance('m1s');
    expect(store.datasetError).toBe('斷線');

    // 重試
    await store.selectInstance('m1s');
    expect(store.datasetError).toBeNull();
    expect(store.dataset).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ========================================================================
// 自訂題庫匯入 - loadCustomDataset / clearCustomDataset
// ========================================================================

/** 產生合法 dataset 測試資料（最小可行結構） */
function makeValidCustomDataset(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: '1.0',
    instance: {
      id: 'custom-m1s',
      name: '自訂 M1S',
      shortName: 'M1S',
      arena: {
        shape: 'square',
        backgroundImage: '',
        size: { width: 1000, height: 1000 },
        center: { x: 500, y: 500 },
      },
    },
    strategies: [{ id: 'custom-strat', instanceId: 'custom-m1s', name: '自訂攻略', waymarks: {} }],
    questions: [],
    debuffLibrary: [],
    ...overrides,
  };
}

describe('loadCustomDataset', () => {
  it('合法物件 → 成功載入 + isCustomDataset=true', () => {
    const store = useSettingsStore();
    const ok = store.loadCustomDataset(makeValidCustomDataset());
    expect(ok).toBe(true);
    expect(store.isCustomDataset).toBe(true);
    expect(store.dataset?.instance.id).toBe('custom-m1s');
    expect(store.customImportError).toBeNull();
  });

  it('合法 JSON 字串也能載入（與物件等價）', () => {
    const store = useSettingsStore();
    const ok = store.loadCustomDataset(JSON.stringify(makeValidCustomDataset()));
    expect(ok).toBe(true);
    expect(store.dataset?.instance.id).toBe('custom-m1s');
  });

  it('自動選取匯入的副本 id', () => {
    const store = useSettingsStore();
    store.loadCustomDataset(makeValidCustomDataset());
    expect(store.selectedInstanceId).toBe('custom-m1s');
  });

  it('構造虛擬 index（只含此一條），讓 InstanceSelector UI 可渲染', () => {
    const store = useSettingsStore();
    store.loadCustomDataset(makeValidCustomDataset());
    expect(store.index?.instances).toHaveLength(1);
    expect(store.index?.instances[0].id).toBe('custom-m1s');
  });

  it('覆蓋前次狀態：清空 strategyId/roleId', () => {
    vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    vi.spyOn(datasetService, 'fetchInstanceData').mockResolvedValue(mockDataset);
    const store = useSettingsStore();
    // 假設玩家先用官方題庫走到 wizard 中段
    return store
      .loadIndex()
      .then(() => store.selectInstance('m1s'))
      .then(() => {
        store.selectStrategy('game8');
        store.selectRole('MT');
        expect(store.canStart).toBe(true);
        // 此時匯入自訂題庫
        store.loadCustomDataset(makeValidCustomDataset());
        expect(store.selectedStrategyId).toBeNull();
        expect(store.selectedRoleId).toBeNull();
        expect(store.canStart).toBe(false);
      });
  });

  it('覆蓋前次狀態：清空 indexError / datasetError', () => {
    const store = useSettingsStore();
    store.indexError = '舊的 index 錯誤';
    store.datasetError = '舊的 dataset 錯誤';
    store.loadCustomDataset(makeValidCustomDataset());
    expect(store.indexError).toBeNull();
    expect(store.datasetError).toBeNull();
  });

  it('schema 版本不符（0.9） → 失敗 + customImportError 設定 + 不動既有狀態', () => {
    const store = useSettingsStore();
    const ok = store.loadCustomDataset(
      makeValidCustomDataset({ schemaVersion: '0.9' }),
    );
    expect(ok).toBe(false);
    expect(store.customImportError).toContain('0.9');
    expect(store.isCustomDataset).toBe(false);
    expect(store.dataset).toBeNull();
  });

  it('缺少必要欄位（instance） → 失敗', () => {
    const store = useSettingsStore();
    const ok = store.loadCustomDataset(
      makeValidCustomDataset({ instance: undefined }),
    );
    expect(ok).toBe(false);
    expect(store.customImportError).toContain('instance');
  });

  it('JSON 語法錯誤字串 → 失敗 + 錯誤訊息含原因', () => {
    const store = useSettingsStore();
    const ok = store.loadCustomDataset('{ not valid json');
    expect(ok).toBe(false);
    expect(store.customImportError).toBeTruthy();
  });

  it('非物件（陣列）→ 失敗', () => {
    const store = useSettingsStore();
    expect(store.loadCustomDataset([])).toBe(false);
  });

  it('二次匯入會成功覆蓋先前匯入', () => {
    const store = useSettingsStore();
    store.loadCustomDataset(makeValidCustomDataset());
    const ok = store.loadCustomDataset(
      makeValidCustomDataset({
        instance: {
          id: 'custom-m2s',
          name: '自訂 M2S',
          shortName: 'M2S',
          arena: {
            shape: 'circle',
            backgroundImage: '',
            size: { width: 800, height: 800 },
            center: { x: 400, y: 400 },
          },
        },
      }),
    );
    expect(ok).toBe(true);
    expect(store.dataset?.instance.id).toBe('custom-m2s');
    expect(store.selectedInstanceId).toBe('custom-m2s');
  });
});

describe('clearCustomDataset', () => {
  it('清除自訂 + 呼叫 loadIndex 重取官方題庫', async () => {
    const fetchIndexSpy = vi.spyOn(datasetService, 'fetchIndex').mockResolvedValue(mockIndex);
    const store = useSettingsStore();
    store.loadCustomDataset(makeValidCustomDataset());
    expect(store.isCustomDataset).toBe(true);

    await store.clearCustomDataset();
    expect(store.isCustomDataset).toBe(false);
    expect(store.dataset).toBeNull();
    expect(fetchIndexSpy).toHaveBeenCalled();
  });
});

describe('selectInstance 在 custom 模式下的行為', () => {
  it('custom 模式下 selectInstance 不發 fetch（dataPath 是虛擬值）', async () => {
    const fetchSpy = vi.spyOn(datasetService, 'fetchInstanceData');
    const store = useSettingsStore();
    store.loadCustomDataset(makeValidCustomDataset());

    await store.selectInstance('custom-m1s');
    expect(fetchSpy).not.toHaveBeenCalled();
    // dataset 仍保留（未被清空）
    expect(store.dataset?.instance.id).toBe('custom-m1s');
  });
});

describe('reset 清掉 isCustomDataset', () => {
  it('reset 後 isCustomDataset=false + customImportError=null', () => {
    const store = useSettingsStore();
    store.loadCustomDataset(makeValidCustomDataset());
    expect(store.isCustomDataset).toBe(true);
    store.reset();
    expect(store.isCustomDataset).toBe(false);
    expect(store.customImportError).toBeNull();
  });
});
