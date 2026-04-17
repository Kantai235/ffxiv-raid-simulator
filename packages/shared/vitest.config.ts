import { defineConfig } from 'vitest/config';

/**
 * Vitest 設定 - shared 套件的純函數單元測試。
 *
 * 不需 jsdom（無 DOM 操作），採 node 環境最快。
 * 涵蓋率設定預留，待測試達一定規模再啟用 c8/v8 報告。
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false, // 測試檔顯式 import { describe, it, expect }，避免污染全域
    include: ['src/**/*.test.ts'],
  },
});
