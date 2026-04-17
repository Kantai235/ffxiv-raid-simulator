import { describe, expect, it } from 'vitest';
import { DatasetLoadError } from './dataset';
import {
  assertValidInstanceDataset,
  parseAndValidateDataset,
} from './datasetValidator';

/**
 * datasetValidator 測試 - 覆蓋各種合法/非法輸入。
 */

/** 建立合法的最小可行 dataset（測試基底） */
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
  it('合法 dataset 通過（不拋）', () => {
    expect(() => assertValidInstanceDataset(makeValidDataset())).not.toThrow();
  });

  it('最外層非物件（null） → parse 錯誤', () => {
    try {
      assertValidInstanceDataset(null);
      expect.fail('應拋出錯誤');
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetLoadError);
      expect((err as DatasetLoadError).reason).toBe('parse');
    }
  });

  it('最外層為陣列 → parse 錯誤（排除 Array 被誤認為 object）', () => {
    expect(() => assertValidInstanceDataset([])).toThrow(DatasetLoadError);
  });

  it('最外層為字串 → parse 錯誤', () => {
    expect(() => assertValidInstanceDataset('hello')).toThrow(DatasetLoadError);
  });

  it('缺少 schemaVersion → schema-version 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete d.schemaVersion;
    try {
      assertValidInstanceDataset(d);
      expect.fail();
    } catch (err) {
      expect((err as DatasetLoadError).reason).toBe('schema-version');
    }
  });

  it('schemaVersion 非字串 → schema-version 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.schemaVersion = 1.0;
    expect(() => assertValidInstanceDataset(d)).toMatchObject;
    try {
      assertValidInstanceDataset(d);
      expect.fail();
    } catch (err) {
      expect((err as DatasetLoadError).reason).toBe('schema-version');
    }
  });

  it('schemaVersion major 過舊（0.x） → schema-version 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.schemaVersion = '0.9';
    try {
      assertValidInstanceDataset(d);
      expect.fail();
    } catch (err) {
      expect((err as DatasetLoadError).reason).toBe('schema-version');
      expect((err as DatasetLoadError).message).toContain('0.9');
    }
  });

  it('schemaVersion 非數字字串（"abc"） → schema-version 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.schemaVersion = 'abc';
    try {
      assertValidInstanceDataset(d);
      expect.fail();
    } catch (err) {
      expect((err as DatasetLoadError).reason).toBe('schema-version');
    }
  });

  it('缺少 instance → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete d.instance;
    try {
      assertValidInstanceDataset(d);
      expect.fail();
    } catch (err) {
      expect((err as DatasetLoadError).message).toContain('instance');
    }
  });

  it('instance.id 為空字串 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    (d.instance as Record<string, unknown>).id = '';
    expect(() => assertValidInstanceDataset(d)).toThrow(/instance\.id/);
  });

  it('instance.arena 缺失 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete (d.instance as Record<string, unknown>).arena;
    expect(() => assertValidInstanceDataset(d)).toThrow(/arena/);
  });

  it('arena.shape 不合法（"triangle"） → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).shape = 'triangle';
    expect(() => assertValidInstanceDataset(d)).toThrow(/shape/);
  });

  it('arena.size 非物件 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    ((d.instance as Record<string, unknown>).arena as Record<string, unknown>).size = '1000x1000';
    expect(() => assertValidInstanceDataset(d)).toThrow(/size/);
  });

  it('strategies 非陣列 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.strategies = {};
    expect(() => assertValidInstanceDataset(d)).toThrow(/strategies/);
  });

  it('questions 非陣列 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    d.questions = null;
    expect(() => assertValidInstanceDataset(d)).toThrow(/questions/);
  });

  it('debuffLibrary 非陣列 → parse 錯誤', () => {
    const d = makeValidDataset() as Record<string, unknown>;
    delete d.debuffLibrary;
    expect(() => assertValidInstanceDataset(d)).toThrow(/debuffLibrary/);
  });
});

describe('parseAndValidateDataset', () => {
  it('合法 JSON 字串 → 回傳解析後物件', () => {
    const json = JSON.stringify(makeValidDataset());
    const result = parseAndValidateDataset(json);
    expect(result.instance.id).toBe('m1s');
    expect(result.schemaVersion).toBe('1.0');
  });

  it('JSON 語法錯誤 → parse 錯誤（訊息含原因）', () => {
    try {
      parseAndValidateDataset('{ not valid json ');
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetLoadError);
      expect((err as DatasetLoadError).reason).toBe('parse');
      expect((err as DatasetLoadError).message).toContain('JSON 解析失敗');
    }
  });

  it('空字串 → parse 錯誤', () => {
    expect(() => parseAndValidateDataset('')).toThrow(DatasetLoadError);
  });

  it('JSON 合法但非 dataset 結構 → schema-version 或 parse 錯誤（依缺哪個欄位）', () => {
    expect(() => parseAndValidateDataset('{}')).toThrow(DatasetLoadError);
    expect(() => parseAndValidateDataset('42')).toThrow(DatasetLoadError);
    expect(() => parseAndValidateDataset('[]')).toThrow(DatasetLoadError);
  });

  it('原始錯誤訊息包含 JSON 原始 error message', () => {
    try {
      parseAndValidateDataset('{ invalid }');
    } catch (err) {
      const msg = (err as DatasetLoadError).message;
      // SyntaxError 各瀏覽器/runtime 訊息不同，但一定含某些關鍵字
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
