/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Player 前台 Vite 設定。
 *
 * ============================================================
 * 【base 路徑策略】
 * ============================================================
 * GitHub Pages 的 project page 部署在 `https://<user>.github.io/<repo>/`，
 * 需要 base 設定為 `/<repo>/` 才能讓靜態資源（JS / CSS / assets）正確解析。
 *
 * 解析順序（由高到低）：
 *   1. 環境變數 VITE_BASE_PATH（CI/CD 注入、最靈活）
 *   2. 環境變數 PLAYER_BASE_PATH（舊相容，保留避免破壞既有流程）
 *   3. production 模式：使用 PRODUCTION_BASE_PATH 常數（下方請改為您的 repo 名稱）
 *   4. development 模式：'/'（本機 dev server）
 *
 * 【部署前請務必修改】
 * 將 PRODUCTION_BASE_PATH 改為您的 GitHub repo 名稱，格式為 '/<repo-name>/'：
 *   - 例如 repo 名稱為 ffxiv-raid-simulator  → '/ffxiv-raid-simulator/'
 *   - 若使用自訂網域（CNAME）或部署在 user/organization page，則改為 '/'
 *
 * CI workflow 建議透過 VITE_BASE_PATH 環境變數覆寫此值以避免寫死 repo 名稱。
 *
 * CLAUDE.md 第 7 點：此 app 嚴禁包含任何寫檔/Node.js 邏輯，僅做純靜態 UI。
 * ============================================================
 */

/**
 * 【請依實際 GitHub repo 名稱修改】production 模式下的預設 base 路徑。
 * 格式必須以斜線開頭與結尾（例如 '/my-repo/'），否則 Vite 會 build 出錯誤的資源路徑。
 */
const PRODUCTION_BASE_PATH = '/ffxiv-raid-simulator/';

function resolveBasePath(mode: string): string {
  if (process.env.VITE_BASE_PATH) return process.env.VITE_BASE_PATH;
  if (process.env.PLAYER_BASE_PATH) return process.env.PLAYER_BASE_PATH;
  return mode === 'production' ? PRODUCTION_BASE_PATH : '/';
}

export default defineConfig(({ mode }) => ({
  base: resolveBasePath(mode),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
}));
