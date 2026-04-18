import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DatasetIndex, InstanceDataset } from '../types';
import { assertValidInstanceDataset } from './validateDataset';

/**
 * ========================================================================
 * 正式出貨題庫驗證
 * ========================================================================
 *
 * shared 的 validator 單元測試已覆蓋 schema 規則，但仍需要再補一層
 * 「實際 repo 內的正式題庫 JSON 能不能被目前程式載入」的驗證。
 *
 * Why：
 *   1. 題庫常是手工編輯，最容易出現逗號 / 欄位遺漏 / 型別飄移
 *   2. 即使 validator 規則沒壞，正式資料檔也可能先壞掉
 *   3. 這層測試能在 CI 第一時間擋下「官方題庫不能載入」的回歸
 * ========================================================================
 */

function readJson(relativePath: string): unknown {
  const absPath = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

describe('published datasets', () => {
  it('index.json 列出的每一份官方題庫都應可 parse 並通過 shared validator', () => {
    const index = readJson('../../../../apps/player/public/assets/data/index.json') as DatasetIndex;

    expect(index.instances.length).toBeGreaterThan(0);

    for (const entry of index.instances) {
      const dataset = readJson(`../../../../apps/player/public/${entry.dataPath}`) as InstanceDataset;

      expect(() => assertValidInstanceDataset(dataset)).not.toThrow();
      expect(dataset.instance.id).toBe(entry.id);
      expect(dataset.schemaVersion).toBe(entry.schemaVersion);
      expect(dataset.strategies.length).toBeGreaterThan(0);
      expect(dataset.questions.length).toBeGreaterThan(0);
      expect(new Set(dataset.questions.map((question) => question.id)).size).toBe(
        dataset.questions.length,
      );
    }
  });

  it('m1s Game8 題組應保留至少 8 題，避免正式題庫被意外刪減', () => {
    const dataset = readJson('../../../../apps/player/public/assets/data/m1s.json') as InstanceDataset;
    const game8QuestionCount = dataset.questions.filter(
      (question) => question.strategyId === 'm1s-game8',
    ).length;

    expect(dataset.strategies.some((strategy) => strategy.id === 'm1s-game8')).toBe(true);
    expect(game8QuestionCount).toBeGreaterThanOrEqual(8);
  });
});
