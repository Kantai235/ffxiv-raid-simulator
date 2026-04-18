import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
  it('m1s.json 應可通過 shared validator，且 Game8 題組已有正式題庫', () => {
    const dataset = readJson('../../../../apps/player/public/assets/data/m1s.json') as {
      strategies: Array<{ id: string }>;
      questions: Array<{ id: string; strategyId: string }>;
    };

    expect(() => assertValidInstanceDataset(dataset)).not.toThrow();

    const game8QuestionCount = dataset.questions.filter(
      (question) => question.strategyId === 'm1s-game8',
    ).length;

    expect(dataset.strategies.some((strategy) => strategy.id === 'm1s-game8')).toBe(true);
    expect(game8QuestionCount).toBeGreaterThanOrEqual(8);
    expect(new Set(dataset.questions.map((question) => question.id)).size).toBe(
      dataset.questions.length,
    );
  });
});
