/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { localFileApiPlugin } from './plugins/localFileApi';

/**
 * Editor Vite 設定。
 *
 * ============================================================
 * 【雙模式架構】
 * ============================================================
 * Editor 同時支援兩種使用情境：
 *
 * 1. 【本機模式】（dev server：您自己出題用）
 *    - 有 localFileApiPlugin 提供 /api/dataset 等寫檔 endpoint
 *    - 編輯後直接寫回 apps/player/public/assets/data/
 *    - 場地圖上傳 API 可用
 *    - server.host 鎖 localhost，禁對外
 *
 * 2. 【靜態模式】（production build：部署 GH Pages 給朋友用）
 *    - 純前端，不含 Node 寫檔邏輯
 *    - 「儲存」改為下載 JSON、「載入」改為拖放上傳 JSON
 *    - 場地圖上傳 UI 會 disable（仍需本機模式處理）
 *    - apply:'serve' 確保 localFileApiPlugin 不會被 build 進 bundle
 *
 * CLAUDE.md 第 7 點要求「editor 寫檔邏輯不可部署」依然遵守：
 * localFileApiPlugin 內部 apply: 'serve' 已保證只在 dev 執行，
 * build 產出的靜態檔完全沒有 Node fs API 引用。
 * ============================================================
 */

/**
 * 【請依實際 GitHub repo 名稱修改】production base 路徑。
 * 與 Player 同 repo 共用 GH Pages，editor 放在 /editor/ 子路徑避免衝突。
 * 格式：'/<repo-name>/editor/'；若使用自訂網域則改為 '/editor/'。
 */
const PRODUCTION_BASE_PATH = '/ffxiv-raid-simulator/editor/';

function resolveBasePath(mode: string): string {
  if (process.env.VITE_BASE_PATH) return process.env.VITE_BASE_PATH;
  return mode === 'production' ? PRODUCTION_BASE_PATH : '/';
}

export default defineConfig(({ mode }) => ({
  base: resolveBasePath(mode),
  plugins: [vue(), localFileApiPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 鎖定 localhost，避免本機工具被區網其他人連線
    host: 'localhost',
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // editor store / service 為純資料邏輯，node 環境足夠（無 DOM 操作）
    // 拖曳互動依賴 SVG CTM API，jsdom 不實作 → 由人工驗證，不寫元件測試
    environment: 'node',
    globals: false,
    // include 涵蓋 src 與 plugins（plugins 內含本機 API 的純函數 helpers）
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
  },
}));
