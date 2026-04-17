import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChoiceQuestion,
  ChoiceRoleSolution,
  InstanceDataset,
  MapClickQuestion,
  MapClickRoleSolution,
  Question,
} from '@ffxiv-sim/shared';
import { ROLE_IDS } from '@ffxiv-sim/shared';
import { createBlankQuestion, useEditorStore } from './editor';
import * as api from '../services/datasetApi';

/**
 * Editor store 測試 - 重點覆蓋 mutation 行為與 dirty 旗標。
 */

function makeDataset(): InstanceDataset {
  return {
    schemaVersion: '1.0',
    instance: {
      id: 'm1s',
      name: 'M1S',
      shortName: 'M1S',
      arena: { shape: 'square', backgroundImage: '', size: { width: 1000, height: 1000 }, center: { x: 500, y: 500 } },
    },
    strategies: [
      { id: 'game8', instanceId: 'm1s', name: 'Game8', waymarks: { A: { x: 100, y: 100 } } },
      { id: 'soup', instanceId: 'm1s', name: '蘇帕醬', waymarks: {} },
    ],
    questions: [],
    debuffLibrary: [],
  };
}

/**
 * 帶 3 題的 dataset - 給 Question CRUD 測試用。
 *
 * 三題都歸屬於 'game8' 攻略（schema 1.1+ 必要欄位）。
 * Test fixture 中 makeDataset 含 'game8' 與 'soup' 兩個 strategies。
 */
function makeDatasetWithQuestions(): InstanceDataset {
  const ds = makeDataset();
  ds.questions = [
    createBlankQuestion('map-click', 'm1s', 'game8'),
    createBlankQuestion('single-choice', 'm1s', 'game8'),
    createBlankQuestion('map-click', 'm1s', 'game8'),
  ].map((q, i) => ({ ...q, id: `q${i}`, name: `題 ${i}` })) as Question[];
  ds.debuffLibrary = [
    { id: 'spread', name: '散開', icon: '' },
    { id: 'share', name: '分擔', icon: '' },
  ];
  return ds;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadDataset', () => {
  it('成功載入 → 設定 dataset / currentFilename / 預選第一個攻略 / dirty=false', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    const store = useEditorStore();
    await store.loadDataset('m1s.json');

    expect(store.dataset?.instance.id).toBe('m1s');
    expect(store.currentFilename).toBe('m1s.json');
    expect(store.selectedStrategyId).toBe('game8');
    expect(store.isDirty).toBe(false);
  });

  it('載入失敗 → error 設定且 dataset 保持 null', async () => {
    vi.spyOn(api, 'readDataset').mockRejectedValue(new api.DatasetApiError('http', '/x', '404'));
    const store = useEditorStore();
    await store.loadDataset('missing.json');

    expect(store.error).toContain('404');
    expect(store.dataset).toBeNull();
    expect(store.isLoading).toBe(false);
  });
});

describe('saveDataset', () => {
  it('成功 save → 呼叫 writeDataset 帶當前檔名與 dataset / dirty=false', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    const writeSpy = vi
      .spyOn(api, 'writeDataset')
      .mockResolvedValue({ path: 'apps/player/.../m1s.json' });
    const store = useEditorStore();
    await store.loadDataset('m1s.json');

    // 模擬一次 mutation → dirty
    store.updateWaymark('game8', 'B', { x: 200, y: 200 });
    expect(store.isDirty).toBe(true);

    const ok = await store.saveDataset();
    expect(ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('m1s.json', store.dataset);
    expect(store.isDirty).toBe(false);
  });

  it('未載入任何檔 → save 失敗回 false 且 error 設定', async () => {
    const store = useEditorStore();
    const ok = await store.saveDataset();
    expect(ok).toBe(false);
    expect(store.error).toContain('尚未載入');
  });

  it('write API 失敗 → save 回 false / dirty 維持', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    vi.spyOn(api, 'writeDataset').mockRejectedValue(new api.DatasetApiError('network', '/x', '斷線'));
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateWaymark('game8', 'B', { x: 0, y: 0 });

    const ok = await store.saveDataset();
    expect(ok).toBe(false);
    expect(store.isDirty).toBe(true);
    expect(store.error).toContain('斷線');
  });
});

describe('updateWaymark', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('更新已存在的 waymark → 座標變更 + dirty=true', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateWaymark('game8', 'A', { x: 300, y: 400 });

    const game8 = store.dataset!.strategies.find((s) => s.id === 'game8');
    expect(game8?.waymarks.A).toEqual({ x: 300, y: 400 });
    expect(store.isDirty).toBe(true);
  });

  it('更新不存在的 waymark → 自動新增', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateWaymark('game8', 'B', { x: 500, y: 500 });

    const game8 = store.dataset!.strategies.find((s) => s.id === 'game8');
    expect(game8?.waymarks.B).toEqual({ x: 500, y: 500 });
  });

  it('strategyId 不存在 → no-op，不影響其他攻略', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    const before = JSON.stringify(store.dataset);
    store.updateWaymark('nonexistent', 'A', { x: 0, y: 0 });
    expect(JSON.stringify(store.dataset)).toBe(before);
    expect(store.isDirty).toBe(false);
  });
});

describe('addWaymark', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('新增不存在的 waymark → 設為 defaultPoint', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.addWaymark('game8', 'C', { x: 500, y: 500 });

    const game8 = store.dataset!.strategies.find((s) => s.id === 'game8');
    expect(game8?.waymarks.C).toEqual({ x: 500, y: 500 });
    expect(store.isDirty).toBe(true);
  });

  it('已存在則不覆蓋（避免拖一半被重置）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // A 已存在於 (100, 100)
    store.addWaymark('game8', 'A', { x: 999, y: 999 });

    const game8 = store.dataset!.strategies.find((s) => s.id === 'game8');
    expect(game8?.waymarks.A).toEqual({ x: 100, y: 100 });
    expect(store.isDirty).toBe(false);
  });
});

describe('removeWaymark', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('移除已存在的 waymark', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.removeWaymark('game8', 'A');

    const game8 = store.dataset!.strategies.find((s) => s.id === 'game8');
    expect(game8?.waymarks.A).toBeUndefined();
    expect(store.isDirty).toBe(true);
  });

  it('移除不存在的 waymark → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.removeWaymark('game8', 'B');
    expect(store.isDirty).toBe(false);
  });
});

describe('selectStrategy', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('切換到合法攻略', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectStrategy('soup');
    expect(store.selectedStrategyId).toBe('soup');
    expect(store.selectedStrategy?.id).toBe('soup');
  });

  it('切換到不存在的攻略 → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectStrategy('nonexistent');
    expect(store.selectedStrategyId).toBe('game8'); // 未變
  });
});

describe('refreshFileList', () => {
  it('成功 → availableFiles 更新', async () => {
    vi.spyOn(api, 'listDatasets').mockResolvedValue(['a.json', 'b.json']);
    const store = useEditorStore();
    await store.refreshFileList();
    expect(store.availableFiles).toEqual(['a.json', 'b.json']);
  });

  it('過濾 index.json（它是 Player 用的副本索引，非 Editor 編輯對象）', async () => {
    vi.spyOn(api, 'listDatasets').mockResolvedValue(['index.json', 'm1s.json', 'm2s.json']);
    const store = useEditorStore();
    await store.refreshFileList();
    expect(store.availableFiles).toEqual(['m1s.json', 'm2s.json']);
  });

  it('失敗 → error 設定，availableFiles 保留先前值', async () => {
    vi.spyOn(api, 'listDatasets')
      .mockResolvedValueOnce(['a.json'])
      .mockRejectedValueOnce(new api.DatasetApiError('network', '/x', '斷線'));
    const store = useEditorStore();
    await store.refreshFileList();
    await store.refreshFileList();
    expect(store.availableFiles).toEqual(['a.json']);
    expect(store.error).toContain('斷線');
  });
});

// 結構驗證防線：即使檔案被載入了但結構不符，也不能讓 store.dataset 變髒
describe('loadDataset 結構驗證', () => {
  it('非法結構（index.json 誤載） → error 設定且 dataset 保持 null', async () => {
    // 模擬 index.json 的內容（只有 instances 陣列，無 instance / strategies）
    const indexJsonContent = {
      schemaVersion: '1.0',
      instances: [{ id: 'm1s', name: 'M1S', shortName: 'M1S', dataPath: 'x', schemaVersion: '1.0' }],
    };
    vi.spyOn(api, 'readDataset').mockResolvedValue(
      indexJsonContent as unknown as InstanceDataset,
    );
    const store = useEditorStore();
    await store.loadDataset('index.json');

    expect(store.dataset).toBeNull();
    expect(store.error).toContain('結構錯誤');
    expect(store.isLoading).toBe(false);
  });

  it('非法結構（缺 arena） → error 設定且 dataset 保持 null', async () => {
    const brokenContent = {
      schemaVersion: '1.0',
      instance: { id: 'm1s', name: 'M1S', shortName: 'M1S' }, // 缺 arena
      strategies: [],
      questions: [],
      debuffLibrary: [],
    };
    vi.spyOn(api, 'readDataset').mockResolvedValue(
      brokenContent as unknown as InstanceDataset,
    );
    const store = useEditorStore();
    await store.loadDataset('bad.json');

    expect(store.dataset).toBeNull();
    expect(store.error).toContain('結構錯誤');
  });

  it('驗證失敗時不覆蓋先前成功載入的 dataset', async () => {
    const readSpy = vi.spyOn(api, 'readDataset');
    const store = useEditorStore();
    // 第一次：合法
    readSpy.mockResolvedValueOnce(makeDataset());
    await store.loadDataset('m1s.json');
    expect(store.dataset?.instance.id).toBe('m1s');

    // 第二次：不合法（例如誤選 index.json）
    readSpy.mockResolvedValueOnce({ schemaVersion: '1.0', instances: [] } as unknown as InstanceDataset);
    await store.loadDataset('index.json');

    // 預期：error 設定，但 dataset 保留先前的合法值，不被非法內容覆蓋
    expect(store.error).toContain('結構錯誤');
    expect(store.dataset?.instance.id).toBe('m1s');
  });
});

describe('reset', () => {
  it('清空所有狀態', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateWaymark('game8', 'A', { x: 0, y: 0 });

    store.reset();
    expect(store.dataset).toBeNull();
    expect(store.currentFilename).toBeNull();
    expect(store.selectedStrategyId).toBeNull();
    expect(store.isDirty).toBe(false);
    expect(store.mode).toBe('waymarks');
    expect(store.selectedLineId).toBeNull();
  });
});

// ========================================================================
// 模式切換
// ========================================================================

describe('setMode / selectLine', () => {
  it('預設模式為 waymarks', () => {
    const store = useEditorStore();
    expect(store.mode).toBe('waymarks');
  });

  it('setMode("arena") → mode 變更', () => {
    const store = useEditorStore();
    store.setMode('arena');
    expect(store.mode).toBe('arena');
  });

  it('離開 arena 模式時清掉 selectedLineId', () => {
    const store = useEditorStore();
    store.setMode('arena');
    store.selectLine('line-1');
    expect(store.selectedLineId).toBe('line-1');
    store.setMode('waymarks');
    expect(store.selectedLineId).toBeNull();
  });
});

// ========================================================================
// Arena 編輯
// ========================================================================

describe('updateArena', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('部分更新 shape → 其他欄位不動', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateArena({ shape: 'circle' });
    expect(store.dataset!.instance.arena.shape).toBe('circle');
    // size 與 center 不變
    expect(store.dataset!.instance.arena.size).toEqual({ width: 1000, height: 1000 });
    expect(store.dataset!.instance.arena.center).toEqual({ x: 500, y: 500 });
    expect(store.isDirty).toBe(true);
  });

  it('更新 size 與 center', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateArena({ size: { width: 2000, height: 1500 } });
    store.updateArena({ center: { x: 999, y: 700 } });
    expect(store.dataset!.instance.arena.size).toEqual({ width: 2000, height: 1500 });
    expect(store.dataset!.instance.arena.center).toEqual({ x: 999, y: 700 });
  });

  it('未載入 dataset → no-op', () => {
    const store = useEditorStore();
    store.updateArena({ shape: 'circle' });
    expect(store.dataset).toBeNull();
    expect(store.isDirty).toBe(false);
  });
});

describe('setBackgroundImage', () => {
  it('寫入 backgroundImage 路徑 + dirty=true', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.setBackgroundImage('assets/arenas/abc.png');
    expect(store.dataset!.instance.arena.backgroundImage).toBe('assets/arenas/abc.png');
    expect(store.isDirty).toBe(true);
  });
});

describe('uploadAndSetBackground', () => {
  function makeFakeFile(): File {
    return {
      type: 'image/png',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as File;
  }

  it('成功 → backgroundImage 被設定為 server 回傳的 path', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    vi.spyOn(api, 'uploadArenaImage').mockResolvedValue({ path: 'assets/arenas/xyz.png' });
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    const ok = await store.uploadAndSetBackground(makeFakeFile());
    expect(ok).toBe(true);
    expect(store.dataset!.instance.arena.backgroundImage).toBe('assets/arenas/xyz.png');
    expect(store.isUploadingImage).toBe(false);
  });

  it('未載入 dataset → 失敗 + error 設定', async () => {
    const store = useEditorStore();
    const ok = await store.uploadAndSetBackground(makeFakeFile());
    expect(ok).toBe(false);
    expect(store.error).toContain('尚未載入');
  });

  it('upload API 失敗 → ok=false / error 設定', async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
    vi.spyOn(api, 'uploadArenaImage').mockRejectedValue(
      new api.DatasetApiError('http', '/x', 'HTTP 413'),
    );
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    const ok = await store.uploadAndSetBackground(makeFakeFile());
    expect(ok).toBe(false);
    expect(store.error).toContain('413');
    expect(store.isUploadingImage).toBe(false);
  });
});

describe('arena lines mutations', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('addArenaLine → 新增到 arena.lines + dirty=true', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.addArenaLine({ id: 'l1', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    expect(store.dataset!.instance.arena.lines).toHaveLength(1);
    expect(store.dataset!.instance.arena.lines![0].id).toBe('l1');
    expect(store.isDirty).toBe(true);
  });

  it('addArenaLine 第二條 → append（不覆蓋）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.addArenaLine({ id: 'l1', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    store.addArenaLine({ id: 'l2', start: { x: 200, y: 200 }, end: { x: 300, y: 300 } });
    expect(store.dataset!.instance.arena.lines).toHaveLength(2);
  });

  it('removeArenaLine → 移除指定 id 的線', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.addArenaLine({ id: 'l1', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    store.addArenaLine({ id: 'l2', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    store.removeArenaLine('l1');
    expect(store.dataset!.instance.arena.lines).toHaveLength(1);
    expect(store.dataset!.instance.arena.lines![0].id).toBe('l2');
  });

  it('removeArenaLine 若該線正被選取 → 同時清掉 selectedLineId', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.addArenaLine({ id: 'l1', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    store.selectLine('l1');
    store.removeArenaLine('l1');
    expect(store.selectedLineId).toBeNull();
  });

  it('updateArenaLine 部分更新（如改顏色）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.addArenaLine({ id: 'l1', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    store.updateArenaLine('l1', { color: '#FF0000', thickness: 5 });
    const line = store.dataset!.instance.arena.lines![0];
    expect(line.color).toBe('#FF0000');
    expect(line.thickness).toBe(5);
    // 未變更欄位保留
    expect(line.start).toEqual({ x: 0, y: 0 });
  });

  it('updateArenaLine 對不存在的 id → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateArenaLine('nonexistent', { color: 'red' });
    expect(store.isDirty).toBe(false);
  });
});

// ========================================================================
// createBlankQuestion 純函數
// ========================================================================

describe('createBlankQuestion', () => {
  it('map-click 預設 clickCount=1, safeAreas=[], 含 strategyId', () => {
    const q = createBlankQuestion('map-click', 'm1s', 'game8');
    expect(q.type).toBe('map-click');
    expect(q.instanceId).toBe('m1s');
    expect(q.strategyId).toBe('game8');
    expect((q as MapClickQuestion).clickCount).toBe(1);
    // 8 職能皆有空骨架
    for (const role of ROLE_IDS) {
      const sol = q.roleSolutions[role] as MapClickRoleSolution;
      expect(sol.debuffs).toEqual([]);
      expect(sol.safeAreas).toEqual([]);
    }
  });

  it('single-choice 預設 options 兩個 + correctOptionIds=[]', () => {
    const q = createBlankQuestion('single-choice', 'm1s', 'game8') as ChoiceQuestion;
    expect(q.type).toBe('single-choice');
    expect(q.strategyId).toBe('game8');
    expect(q.options).toHaveLength(2);
    for (const role of ROLE_IDS) {
      const sol = q.roleSolutions[role] as ChoiceRoleSolution;
      expect(sol.correctOptionIds).toEqual([]);
    }
  });

  it('8 職能 RoleSolution 各持獨立物件 reference（不共享）', () => {
    const q = createBlankQuestion('map-click', 'm1s', 'game8') as MapClickQuestion;
    // 改 MT 的 debuffs 不該影響 ST
    q.roleSolutions.MT.debuffs.push('x');
    expect(q.roleSolutions.ST.debuffs).toEqual([]);
  });

  it('id 唯一（連續呼叫 3 次不撞）', () => {
    const ids = new Set([
      createBlankQuestion('map-click', 'm1s', 'game8').id,
      createBlankQuestion('map-click', 'm1s', 'game8').id,
      createBlankQuestion('map-click', 'm1s', 'game8').id,
    ]);
    expect(ids.size).toBe(3);
  });
});

// ========================================================================
// Question CRUD - addQuestion / updateQuestion / deleteQuestion
// ========================================================================

describe('addQuestion', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDataset());
  });

  it('成功新增 → 回傳新 id + 自動寫入 strategyId + dirty=true', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    expect(store.dataset!.questions).toHaveLength(0);
    // loadDataset 預設選第一個 strategy = 'game8'
    const newId = store.addQuestion('map-click', 'm1s');
    expect(newId).not.toBeNull();
    expect(store.dataset!.questions).toHaveLength(1);
    expect(store.dataset!.questions[0].id).toBe(newId);
    expect(store.dataset!.questions[0].strategyId).toBe('game8');
    expect(store.isDirty).toBe(true);
  });

  it('未載入 dataset → 回 null', () => {
    const store = useEditorStore();
    expect(store.addQuestion('map-click', 'm1s')).toBeNull();
  });

  it('未選攻略 → 回 null（schema 1.1+ 題目必須綁攻略）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // 強制清掉 selectedStrategyId 模擬「沒選攻略」狀態
    store.selectedStrategyId = null;
    const newId = store.addQuestion('map-click', 'm1s');
    expect(newId).toBeNull();
    expect(store.dataset!.questions).toHaveLength(0);
  });

  it('切到不同攻略再新增 → 新題綁定當前攻略', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectStrategy('soup');
    const newId = store.addQuestion('map-click', 'm1s');
    expect(newId).not.toBeNull();
    const created = store.dataset!.questions.find((q) => q.id === newId);
    expect(created?.strategyId).toBe('soup');
  });
});

describe('updateQuestion', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('同題型部分更新 - 其他欄位保留', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateQuestion('q0', { name: '更名後' });
    expect(store.dataset!.questions[0].name).toBe('更名後');
    expect(store.dataset!.questions[0].type).toBe('map-click');
  });

  it('更新 boss 欄位', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateQuestion('q0', {
      boss: { skillName: '新技', castTime: 12, facing: 90 },
    });
    expect(store.dataset!.questions[0].boss.skillName).toBe('新技');
    expect(store.dataset!.questions[0].boss.facing).toBe(90);
  });

  it('題型變動 → 8 職能 RoleSolution 重置為新題型空骨架', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // q0 原為 map-click，先塞 debuff 與 safeArea
    store.updateRoleSolution('q0', 'MT', {
      debuffs: ['spread'],
      safeAreas: [{ shape: 'circle', center: { x: 0, y: 0 }, radius: 10 }],
    } as Partial<MapClickRoleSolution>);

    // 切到 single-choice
    store.updateQuestion('q0', { type: 'single-choice' });

    const q = store.dataset!.questions[0];
    expect(q.type).toBe('single-choice');
    // 8 職能全部變空骨架（含 MT 的 debuff 也被清）
    for (const role of ROLE_IDS) {
      const sol = q.roleSolutions[role] as ChoiceRoleSolution;
      expect(sol.debuffs).toEqual([]);
      expect(sol.correctOptionIds).toEqual([]);
      // safeAreas 不應殘留
      expect('safeAreas' in sol).toBe(false);
    }
    // 新題型特有欄位有預設
    expect((q as ChoiceQuestion).options).toBeDefined();
  });

  it('題型不變 → 不重置 RoleSolution', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateRoleSolution('q0', 'MT', { debuffs: ['spread'] });
    store.updateQuestion('q0', { type: 'map-click', name: '更名' });
    expect(store.dataset!.questions[0].roleSolutions.MT.debuffs).toEqual(['spread']);
  });

  it('不存在的 questionId → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    const before = JSON.stringify(store.dataset);
    store.updateQuestion('nonexistent', { name: 'x' });
    expect(JSON.stringify(store.dataset)).toBe(before);
    expect(store.isDirty).toBe(false);
  });
});

describe('deleteQuestion', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('刪除非當前選取題目 → 列表少 1，selectedQuestionId 不變', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    expect(store.selectedQuestionId).toBe('q0'); // loadDataset 預設第一題
    store.deleteQuestion('q1');
    expect(store.dataset!.questions.map((q) => q.id)).toEqual(['q0', 'q2']);
    expect(store.selectedQuestionId).toBe('q0');
  });

  it('刪除當前選取題目（非末尾）→ 自動指向同 index 位置（即原下一題）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    store.deleteQuestion('q1');
    // q1 被刪後，原 index=1 的位置變成 q2
    expect(store.selectedQuestionId).toBe('q2');
  });

  it('刪除當前選取且為末尾 → 指向新末尾', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q2'); // 末尾
    store.deleteQuestion('q2');
    expect(store.selectedQuestionId).toBe('q1');
  });

  it('刪到最後一題 → selectedQuestionId 變 null', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.deleteQuestion('q0');
    store.deleteQuestion('q1');
    store.deleteQuestion('q2');
    expect(store.dataset!.questions).toHaveLength(0);
    expect(store.selectedQuestionId).toBeNull();
  });
});

describe('duplicateQuestion', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('複製成功 → 新題附加在原題之後 + 新 id + 名字加「（副本）」', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    const newId = store.duplicateQuestion('q1');
    expect(newId).not.toBeNull();
    expect(newId).not.toBe('q1');

    const ids = store.dataset!.questions.map((q) => q.id);
    expect(ids).toEqual(['q0', 'q1', newId, 'q2']);

    const newQ = store.dataset!.questions[2];
    expect(newQ.name).toContain('副本');
  });

  it('深拷貝 - 改副本 RoleSolution 不影響原題', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // 原題塞 debuff
    store.updateRoleSolution('q0', 'MT', { debuffs: ['spread'] });
    const newId = store.duplicateQuestion('q0')!;
    // 改副本
    store.updateRoleSolution(newId, 'MT', { debuffs: ['share'] });
    // 原題不受影響
    const original = store.dataset!.questions.find((q) => q.id === 'q0')!;
    expect(original.roleSolutions.MT.debuffs).toEqual(['spread']);
  });

  it('深拷貝 - 改副本 boss 不影響原題', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    const newId = store.duplicateQuestion('q0')!;
    store.updateQuestion(newId, {
      boss: { skillName: '改', castTime: 5, facing: 180 },
    });
    const original = store.dataset!.questions.find((q) => q.id === 'q0')!;
    expect(original.boss.skillName).not.toBe('改');
  });

  it('不存在的 id → 回 null', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    expect(store.duplicateQuestion('nonexistent')).toBeNull();
  });
});

// ========================================================================
// updateRoleSolution
// ========================================================================

describe('updateRoleSolution', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('更新 debuffs', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateRoleSolution('q0', 'MT', { debuffs: ['spread', 'share'] });
    expect(store.dataset!.questions[0].roleSolutions.MT.debuffs).toEqual(['spread', 'share']);
    expect(store.isDirty).toBe(true);
  });

  it('更新 note', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateRoleSolution('q0', 'H1', { note: '純補站圈圈' });
    expect(store.dataset!.questions[0].roleSolutions.H1.note).toBe('純補站圈圈');
  });

  it('改 MT 的解答不影響 ST（reference 隔離）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateRoleSolution('q0', 'MT', { debuffs: ['spread'] });
    expect(store.dataset!.questions[0].roleSolutions.ST.debuffs).toEqual([]);
  });

  it('不存在的 questionId → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.updateRoleSolution('nonexistent', 'MT', { debuffs: ['x'] });
    expect(store.isDirty).toBe(false);
  });
});

// ========================================================================
// 模式與選取
// ========================================================================

describe('selectQuestion / selectRole', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('loadDataset 預設選第一題', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    expect(store.selectedQuestionId).toBe('q0');
    expect(store.selectedQuestion?.id).toBe('q0');
  });

  it('selectQuestion 切到合法 ID', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q2');
    expect(store.selectedQuestionId).toBe('q2');
  });

  it('selectQuestion 不存在的 ID → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('nonexistent');
    expect(store.selectedQuestionId).toBe('q0');
  });

  it('selectStrategy → selectedQuestionId 自動清空（避免選到不屬於新攻略的題目）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // 預設選 game8 + q0
    expect(store.selectedQuestionId).toBe('q0');
    store.selectStrategy('soup');
    expect(store.selectedStrategyId).toBe('soup');
    expect(store.selectedQuestionId).toBeNull();
  });

  it('selectRole 切換職能', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    expect(store.selectedRoleId).toBe('MT');
    store.selectRole('D3');
    expect(store.selectedRoleId).toBe('D3');
  });

  it('selectedRoleSolution 連動 selectedQuestionId 與 selectedRoleId', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // 給 q1 的 D3 加 note
    store.updateRoleSolution('q1', 'D3', { note: 'D3 站位' });

    store.selectQuestion('q1');
    store.selectRole('D3');
    expect(store.selectedRoleSolution?.note).toBe('D3 站位');

    store.selectRole('MT');
    expect(store.selectedRoleSolution?.note).toBeUndefined();
  });
});

describe('setMode 包含 questions', () => {
  it('可切換到 questions', () => {
    const store = useEditorStore();
    store.setMode('questions');
    expect(store.mode).toBe('questions');
  });
});

// ========================================================================
// 繪圖狀態機 - startDrawing / cancelDrawing / appendDrawingPoint / commitSafeArea
// ========================================================================

describe('startDrawing / cancelDrawing / appendDrawingPoint', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('預設工具為 null + drawingPoints 為空', () => {
    const store = useEditorStore();
    expect(store.activeDrawingTool).toBeNull();
    expect(store.drawingPoints).toEqual([]);
  });

  it('startDrawing 設定工具且清空 drawingPoints', () => {
    const store = useEditorStore();
    store.appendDrawingPoint({ x: 10, y: 10 });
    store.startDrawing('circle');
    expect(store.activeDrawingTool).toBe('circle');
    expect(store.drawingPoints).toEqual([]);
  });

  it('startDrawing 同工具 → toggle off', () => {
    const store = useEditorStore();
    store.startDrawing('rect');
    expect(store.activeDrawingTool).toBe('rect');
    store.startDrawing('rect');
    expect(store.activeDrawingTool).toBeNull();
  });

  it('startDrawing 不同工具 → 切換並清點', () => {
    const store = useEditorStore();
    store.startDrawing('circle');
    store.appendDrawingPoint({ x: 50, y: 50 });
    store.startDrawing('polygon');
    expect(store.activeDrawingTool).toBe('polygon');
    expect(store.drawingPoints).toEqual([]);
  });

  it('cancelDrawing 清點但保留工具', () => {
    const store = useEditorStore();
    store.startDrawing('polygon');
    store.appendDrawingPoint({ x: 1, y: 1 });
    store.appendDrawingPoint({ x: 2, y: 2 });
    store.cancelDrawing();
    expect(store.drawingPoints).toEqual([]);
    expect(store.activeDrawingTool).toBe('polygon');
  });

  it('appendDrawingPoint 累積頂點', () => {
    const store = useEditorStore();
    store.startDrawing('polygon');
    store.appendDrawingPoint({ x: 1, y: 2 });
    store.appendDrawingPoint({ x: 3, y: 4 });
    expect(store.drawingPoints).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('appendDrawingPoint 寫入新物件副本（非 reference 共享）', () => {
    const store = useEditorStore();
    const p = { x: 10, y: 20 };
    store.appendDrawingPoint(p);
    p.x = 999;
    expect(store.drawingPoints[0]).toEqual({ x: 10, y: 20 });
  });
});

describe('commitSafeArea', () => {
  beforeEach(async () => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('Circle 寫入當前選取題目/職能的 safeAreas + dirty=true', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // q0 預設 = map-click，selectedQuestionId='q0'，selectedRoleId='MT'
    const ok = store.commitSafeArea({
      shape: 'circle',
      center: { x: 100, y: 100 },
      radius: 50,
    });
    expect(ok).toBe(true);
    const sol = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    expect(sol.safeAreas).toHaveLength(1);
    // 用 toMatchObject 容忍 commit 自動分配的 id 欄位
    expect(sol.safeAreas[0]).toMatchObject({
      shape: 'circle',
      center: { x: 100, y: 100 },
      radius: 50,
    });
    expect(store.isDirty).toBe(true);
  });

  it('連續 commit 多個 safeArea → 累加（不覆蓋）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    store.commitSafeArea({ shape: 'rect', x: 0, y: 0, width: 10, height: 10 });
    store.commitSafeArea({
      shape: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    });
    const sol = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    expect(sol.safeAreas).toHaveLength(3);
    expect(sol.safeAreas.map((a) => a.shape)).toEqual(['circle', 'rect', 'polygon']);
  });

  it('commit 後 drawingPoints 清空但 activeDrawingTool 保留（連續繪製）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.startDrawing('circle');
    store.appendDrawingPoint({ x: 50, y: 50 });
    store.commitSafeArea({ shape: 'circle', center: { x: 50, y: 50 }, radius: 10 });
    expect(store.drawingPoints).toEqual([]);
    expect(store.activeDrawingTool).toBe('circle');
  });

  it('寫入指定職能（非 MT）', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectRole('D3');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 5 });

    const q = store.dataset!.questions[0] as MapClickQuestion;
    expect(q.roleSolutions.D3.safeAreas).toHaveLength(1);
    expect(q.roleSolutions.MT.safeAreas).toEqual([]); // MT 不應受影響
  });

  it('題型非 map-click → no-op 回 false', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // q1 是 single-choice
    store.selectQuestion('q1');
    const ok = store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    expect(ok).toBe(false);
    expect(store.isDirty).toBe(false);
  });

  it('未選任何題目 → no-op 回 false', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion(null);
    const ok = store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    expect(ok).toBe(false);
  });

  it('未載入 dataset → no-op 回 false', () => {
    const store = useEditorStore();
    const ok = store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    expect(ok).toBe(false);
  });
});

describe('removeSafeArea', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('移除指定 index 的 safeArea', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    store.commitSafeArea({ shape: 'rect', x: 0, y: 0, width: 10, height: 10 });
    store.removeSafeArea(0);
    const sol = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    expect(sol.safeAreas).toHaveLength(1);
    expect(sol.safeAreas[0].shape).toBe('rect');
  });

  it('index 越界 → no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    const before = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT.safeAreas.length;
    store.removeSafeArea(99);
    store.removeSafeArea(-1);
    const after = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT.safeAreas.length;
    expect(after).toBe(before);
  });
});

describe('連動：切題/切職能/切模式時自動 cancelDrawing', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('selectQuestion → drawingPoints 清空', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.startDrawing('polygon');
    store.appendDrawingPoint({ x: 1, y: 1 });
    store.selectQuestion('q2');
    expect(store.drawingPoints).toEqual([]);
  });

  it('selectRole → drawingPoints 清空', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.startDrawing('polygon');
    store.appendDrawingPoint({ x: 1, y: 1 });
    store.selectRole('H1');
    expect(store.drawingPoints).toEqual([]);
  });

  it('setMode 離開 questions → 工具與點全清', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.setMode('questions');
    store.startDrawing('rect');
    store.appendDrawingPoint({ x: 1, y: 1 });
    store.setMode('waymarks');
    expect(store.activeDrawingTool).toBeNull();
    expect(store.drawingPoints).toEqual([]);
  });
});

// ========================================================================
// SafeArea ID 自動分配與 selectSafeArea / removeSafeAreaById
// ========================================================================

describe('SafeArea id 與選取', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('commitSafeArea 自動為形狀分配 id', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    const sol = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    expect(sol.safeAreas[0].id).toBeDefined();
    expect(typeof sol.safeAreas[0].id).toBe('string');
  });

  it('呼叫端已給 id 則保留', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({
      shape: 'circle',
      center: { x: 0, y: 0 },
      radius: 1,
      id: 'my-custom-id',
    });
    const sol = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    expect(sol.safeAreas[0].id).toBe('my-custom-id');
  });

  it('連續 3 次 commit → 各自獨立 id', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    for (let i = 0; i < 3; i++) {
      store.commitSafeArea({ shape: 'circle', center: { x: i, y: i }, radius: 1 });
    }
    const sol = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    const ids = sol.safeAreas.map((a) => a.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('selectSafeArea 設定/清除', () => {
    const store = useEditorStore();
    store.selectSafeArea('foo');
    expect(store.selectedSafeAreaId).toBe('foo');
    store.selectSafeArea(null);
    expect(store.selectedSafeAreaId).toBeNull();
  });

  it('removeSafeAreaById → 從陣列中移除指定 id', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    store.commitSafeArea({ shape: 'rect', x: 0, y: 0, width: 10, height: 10 });
    const sol1 = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    const targetId = sol1.safeAreas[0].id!;

    const ok = store.removeSafeAreaById(targetId);
    expect(ok).toBe(true);
    const sol2 = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT;
    expect(sol2.safeAreas).toHaveLength(1);
    expect(sol2.safeAreas[0].shape).toBe('rect');
  });

  it('removeSafeAreaById 該 id 為當前選取 → 連動清掉 selectedSafeAreaId', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    const id = (store.dataset!.questions[0] as MapClickQuestion).roleSolutions.MT.safeAreas[0].id!;
    store.selectSafeArea(id);
    store.removeSafeAreaById(id);
    expect(store.selectedSafeAreaId).toBeNull();
  });

  it('removeSafeAreaById 不存在的 id → false', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    expect(store.removeSafeAreaById('nonexistent')).toBe(false);
  });

  it('切題 → selectedSafeAreaId 自動清空', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectSafeArea('foo');
    store.selectQuestion('q2');
    expect(store.selectedSafeAreaId).toBeNull();
  });

  it('切職能 → selectedSafeAreaId 自動清空', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectSafeArea('foo');
    store.selectRole('H1');
    expect(store.selectedSafeAreaId).toBeNull();
  });

  it('startDrawing → selectedSafeAreaId 自動清空', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectSafeArea('foo');
    store.startDrawing('circle');
    expect(store.selectedSafeAreaId).toBeNull();
  });

  it('離開 questions 模式 → selectedSafeAreaId 自動清空', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.setMode('questions');
    store.selectSafeArea('foo');
    store.setMode('waymarks');
    expect(store.selectedSafeAreaId).toBeNull();
  });
});

// ========================================================================
// QuestionOption CRUD
// ========================================================================

describe('Question Options CRUD', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('addQuestionOption → 推入 options + 回傳新 id', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1'); // single-choice
    const before = (store.dataset!.questions[1] as ChoiceQuestion).options.length;
    const newId = store.addQuestionOption('靠近王');
    expect(newId).not.toBeNull();
    const after = (store.dataset!.questions[1] as ChoiceQuestion).options;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].label).toBe('靠近王');
    expect(after[after.length - 1].id).toBe(newId);
  });

  it('addQuestionOption 在 map-click 題型 → null', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // q0 為 map-click
    expect(store.addQuestionOption('x')).toBeNull();
  });

  it('updateQuestionOption 更新 label', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    const opts = (store.dataset!.questions[1] as ChoiceQuestion).options;
    const targetId = opts[0].id;
    store.updateQuestionOption(targetId, '新 label');
    expect((store.dataset!.questions[1] as ChoiceQuestion).options[0].label).toBe('新 label');
  });

  it('removeQuestionOption → 移除 + 連動清掉所有職能 correctOptionIds 中此 id', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    const opts = (store.dataset!.questions[1] as ChoiceQuestion).options;
    const targetId = opts[0].id;
    // 在 MT 與 D3 都標記為正解
    store.setCorrectOptionIds('q1', 'MT', [targetId]);
    store.setCorrectOptionIds('q1', 'D3', [targetId, opts[1].id]);

    store.removeQuestionOption(targetId);

    const q = store.dataset!.questions[1] as ChoiceQuestion;
    expect(q.options.find((o) => o.id === targetId)).toBeUndefined();
    expect(q.roleSolutions.MT.correctOptionIds).toEqual([]);
    expect(q.roleSolutions.D3.correctOptionIds).toEqual([opts[1].id]);
  });

  it('moveQuestionOption 上移/下移', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    const opts = (store.dataset!.questions[1] as ChoiceQuestion).options;
    const [a, b] = opts;
    store.moveQuestionOption(b.id, 'up');
    const after = (store.dataset!.questions[1] as ChoiceQuestion).options.map((o) => o.id);
    expect(after).toEqual([b.id, a.id]);
  });

  it('moveQuestionOption 邊界 no-op', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    const opts = (store.dataset!.questions[1] as ChoiceQuestion).options;
    store.moveQuestionOption(opts[0].id, 'up'); // 已最上
    expect((store.dataset!.questions[1] as ChoiceQuestion).options[0].id).toBe(opts[0].id);
  });
});

// ========================================================================
// setCorrectOptionIds + 切題型清資料
// ========================================================================

describe('setCorrectOptionIds', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('設定指定職能正解', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    const opts = (store.dataset!.questions[1] as ChoiceQuestion).options;
    store.setCorrectOptionIds('q1', 'D3', [opts[0].id]);
    const q = store.dataset!.questions[1] as ChoiceQuestion;
    expect(q.roleSolutions.D3.correctOptionIds).toEqual([opts[0].id]);
    expect(q.roleSolutions.MT.correctOptionIds).toEqual([]);
  });
});

describe('題型切換時資料清理', () => {
  beforeEach(() => {
    vi.spyOn(api, 'readDataset').mockResolvedValue(makeDatasetWithQuestions());
  });

  it('map-click → single-choice：safeAreas 清掉，options 出現預設值', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    // q0 = map-click，先塞個 safeArea
    store.commitSafeArea({ shape: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    store.updateQuestion('q0', { type: 'single-choice' });
    const q = store.dataset!.questions[0] as ChoiceQuestion;
    expect(q.type).toBe('single-choice');
    expect('safeAreas' in q.roleSolutions.MT).toBe(false);
    expect(q.options).toBeDefined();
    expect(q.options.length).toBeGreaterThanOrEqual(2);
  });

  it('single-choice → map-click：options 與 correctOptionIds 都清掉', async () => {
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1'); // 已是 single-choice
    const opts = (store.dataset!.questions[1] as ChoiceQuestion).options;
    store.setCorrectOptionIds('q1', 'MT', [opts[0].id]);

    store.updateQuestion('q1', { type: 'map-click' });
    const q = store.dataset!.questions[1] as MapClickQuestion;
    expect(q.type).toBe('map-click');
    expect('options' in q).toBe(false);
    expect('correctOptionIds' in q.roleSolutions.MT).toBe(false);
    expect(q.roleSolutions.MT.safeAreas).toEqual([]);
    // clickCount 預設出現
    expect(q.clickCount).toBeDefined();
  });

  it('single-choice → ordering：options 保留結構但 RoleSolution 重置', async () => {
    // 注意 mergeWithTypeChange 會用 createBlankQuestion 產出新 options（即兩個空選項），
    // 所以原本的 options 不會保留 - 這是當前契約。測試紀錄此行為。
    const store = useEditorStore();
    await store.loadDataset('m1s.json');
    store.selectQuestion('q1');
    store.updateQuestion('q1', { type: 'ordering' });
    const q = store.dataset!.questions[1] as ChoiceQuestion;
    expect(q.type).toBe('ordering');
    expect(q.options).toBeDefined();
    expect(q.roleSolutions.MT.correctOptionIds).toEqual([]);
  });
});
