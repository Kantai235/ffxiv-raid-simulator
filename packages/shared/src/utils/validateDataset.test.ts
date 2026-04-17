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
