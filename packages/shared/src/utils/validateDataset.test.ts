import { describe, expect, it } from 'vitest';
import {
  DatasetValidationError,
  assertValidInstanceDataset,
  isValidInstanceDataset,
} from './validateDataset';

/**
 * 合法的最小可行 dataset（測試基底）。
 * 與 player 的 datasetValidator.test.ts 的 makeValidDataset 同構，
 * 確保兩邊規則一致。
 */
function makeValidDataset(): unknown {
  return {
    schemaVersion: '1.0',
    instance: {
      id: 'm1s',
      name: 'M1S',
      shortName: 'M1S',
      arena: {
        shape: 'square',
        backgroundImage: '',
        size: { width: 1000, height: 1000 },
        center: { x: 500, y: 500 },
      },
    },
    strategies: [],
    questions: [],
    debuffLibrary: [],
  };
}

describe('assertValidInstanceDataset', () => {
  it('合法 dataset → 不拋錯', () => {
    expect(() => assertValidInstanceDataset(makeValidDataset())).not.toThrow();
  });

  it('最外層非物件 → parse 錯誤', () => {
    try {
      assertValidInstanceDataset(null);
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetValidationError);
      expect((err as DatasetValidationError).reason).toBe('parse');
    }
  });

  it('最外層為陣列 → parse 錯誤', () => {
    expect(() => assertValidInstanceDataset([])).toThrow(DatasetValidationError);
  });

  it('缺 schemaVersion → schema-version 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete d.schemaVersion;
    try {
      assertValidInstanceDataset(d);
      expect.fail();
    } catch (err) {
      expect((err as DatasetValidationError).reason).toBe('schema-version');
    }
  });

  it('schemaVersion major 過舊 → schema-version 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.schemaVersion = '0.9';
    expect(() => assertValidInstanceDataset(d)).toThrow(/0\.9/);
  });

  it('缺 instance → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete d.instance;
    expect(() => assertValidInstanceDataset(d)).toThrow(/instance/);
  });

  it('instance.arena 缺失 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete (d.instance as Record<string, unknown>).arena;
    expect(() => assertValidInstanceDataset(d)).toThrow(/arena/);
  });

  it('arena.shape 不合法 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).shape = 'triangle';
    expect(() => assertValidInstanceDataset(d)).toThrow(/shape/);
  });

  it('strategies 非陣列 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.strategies = {};
    expect(() => assertValidInstanceDataset(d)).toThrow(/strategies/);
  });

  it('index.json 結構（只有 schemaVersion + instances 陣列） → parse 錯誤', () => {
    // 這是此次 bug 的重點 case：使用者誤選 index.json 不會再讓 Editor 崩潰
    const indexJson = {
      schemaVersion: '1.0',
      instances: [{ id: 'm1s', name: 'M1S', shortName: 'M1S', dataPath: 'x', schemaVersion: '1.0' }],
    };
    try {
      assertValidInstanceDataset(indexJson);
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetValidationError);
      expect((err as DatasetValidationError).reason).toBe('parse');
      expect((err as DatasetValidationError).message).toContain('instance');
    }
  });
});

// ========================================================================
// Phase 1 擴充欄位：arena.grid / enemies / arenaMask / tethers
// ========================================================================

/** 產生含 1 題 map-click 的 dataset（給 Phase 1 擴充欄位測試用） */
function makeDatasetWithQuestion(extra: Record<string, unknown> = {}): unknown {
  const ds = makeValidDataset() as Record<string, unknown>;
  (ds.questions as unknown[]) = [
    {
      id: 'q1',
      instanceId: 'm1s',
      strategyId: 'game8',
      name: '測試題',
      type: 'map-click',
      clickCount: 1,
      boss: { skillName: 'x', castTime: 8, facing: 0 },
      roleSolutions: {},
      ...extra,
    },
  ];
  return ds;
}

describe('arena.grid 驗證', () => {
  it('合法 { rows, cols } → 不拋錯', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).grid = {
      rows: 4,
      cols: 4,
    };
    expect(() => assertValidInstanceDataset(d)).not.toThrow();
  });

  it('rows 非正整數 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).grid = {
      rows: 0,
      cols: 4,
    };
    expect(() => assertValidInstanceDataset(d)).toThrow(/rows/);
  });

  it('cols 小數 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).grid = {
      rows: 4,
      cols: 4.5,
    };
    expect(() => assertValidInstanceDataset(d)).toThrow(/cols/);
  });

  it('grid 為陣列（非物件）→ parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).grid = [4, 4];
    expect(() => assertValidInstanceDataset(d)).toThrow(/grid/);
  });
});

describe('Question.arenaMask 驗證', () => {
  function withGrid(d: Record<string, unknown>, rows = 4, cols = 4): void {
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).grid = {
      rows,
      cols,
    };
  }

  it('合法 index（0 到 total-1）→ 不拋錯', () => {
    const d = makeDatasetWithQuestion({ arenaMask: [0, 5, 15] }) as Record<string, unknown>;
    withGrid(d);
    expect(() => assertValidInstanceDataset(d)).not.toThrow();
  });

  it('空陣列 + 無 grid → 視同未使用，不拋錯（向下相容）', () => {
    const d = makeDatasetWithQuestion({ arenaMask: [] });
    expect(() => assertValidInstanceDataset(d)).not.toThrow();
  });

  it('非空 arenaMask 但 arena 未設 grid → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ arenaMask: [0] });
    expect(() => assertValidInstanceDataset(d)).toThrow(/grid/);
  });

  it('index 超過上界 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ arenaMask: [16] }) as Record<string, unknown>;
    withGrid(d, 4, 4); // total = 16，合法範圍 0..15
    expect(() => assertValidInstanceDataset(d)).toThrow(/超出/);
  });

  it('index 為負 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ arenaMask: [-1] }) as Record<string, unknown>;
    withGrid(d);
    expect(() => assertValidInstanceDataset(d)).toThrow(/超出/);
  });

  it('index 為小數 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ arenaMask: [1.5] }) as Record<string, unknown>;
    withGrid(d);
    expect(() => assertValidInstanceDataset(d)).toThrow(/整數/);
  });

  it('arenaMask 非陣列 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ arenaMask: 'abc' });
    expect(() => assertValidInstanceDataset(d)).toThrow(/arenaMask/);
  });
});

describe('Question.enemies 驗證', () => {
  it('合法 enemies → 不拋錯', () => {
    const d = makeDatasetWithQuestion({
      enemies: [{ id: 'e1', name: '模仿貓 1', position: { x: 100, y: 200 }, facing: 90 }],
    });
    expect(() => assertValidInstanceDataset(d)).not.toThrow();
  });

  it('enemies 非陣列 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ enemies: {} });
    expect(() => assertValidInstanceDataset(d)).toThrow(/enemies/);
  });

  it('enemy 缺 id → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({
      enemies: [{ name: 'x', position: { x: 0, y: 0 }, facing: 0 }],
    });
    expect(() => assertValidInstanceDataset(d)).toThrow(/id/);
  });

  it('enemy.position 缺 y → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({
      enemies: [{ id: 'e1', name: 'x', position: { x: 0 }, facing: 0 }],
    });
    expect(() => assertValidInstanceDataset(d)).toThrow(/position/);
  });

  it('enemy.facing 為 NaN → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({
      enemies: [{ id: 'e1', name: 'x', position: { x: 0, y: 0 }, facing: Number.NaN }],
    });
    expect(() => assertValidInstanceDataset(d)).toThrow(/facing/);
  });
});

describe('Question.tethers 驗證', () => {
  it('合法 tethers → 不拋錯', () => {
    const d = makeDatasetWithQuestion({
      tethers: [{ sourceId: 'boss', targetId: 'A', color: 'red' }],
    });
    expect(() => assertValidInstanceDataset(d)).not.toThrow();
  });

  it('color 不在白名單 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({
      tethers: [{ sourceId: 'boss', targetId: 'A', color: 'black' }],
    });
    expect(() => assertValidInstanceDataset(d)).toThrow(/color/);
  });

  it('sourceId 空字串 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({
      tethers: [{ sourceId: '', targetId: 'A', color: 'red' }],
    });
    expect(() => assertValidInstanceDataset(d)).toThrow(/sourceId/);
  });

  it('tethers 非陣列 → parse 錯誤', () => {
    const d = makeDatasetWithQuestion({ tethers: 'x' });
    expect(() => assertValidInstanceDataset(d)).toThrow(/tethers/);
  });
});

describe('isValidInstanceDataset', () => {
  it('合法 → true', () => {
    expect(isValidInstanceDataset(makeValidDataset())).toBe(true);
  });

  it('非法 → false（不拋）', () => {
    expect(isValidInstanceDataset({})).toBe(false);
    expect(isValidInstanceDataset(null)).toBe(false);
    expect(isValidInstanceDataset({ schemaVersion: '1.0' })).toBe(false);
  });
});
