/**
 * FFXIV 8 人團職能編制常數。
 *
 * Why: 整個系統以「職能」為解答的維度（同一題目，8 職能各有解答），
 * 因此職能代號必須在前後台、JSON Schema、UI 顯示間保持單一真實來源（SSOT）。
 *
 * 命名沿用社群慣例：MT/ST = 主副坦、H1/H2 = 純治癒/盾治癒、D1~D4 = 近遠輸出。
 */
export const ROLE_IDS = ['MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4'] as const;

/**
 * 職能代號型別，等價於 'MT' | 'ST' | ... | 'D4'。
 */
export type RoleId = (typeof ROLE_IDS)[number];

/**
 * 職能大分類：用於 UI 上色（坦/補/輸出）與篩選邏輯。
 */
export const ROLE_CATEGORY: Record<RoleId, 'tank' | 'healer' | 'dps'> = {
  MT: 'tank',
  ST: 'tank',
  H1: 'healer',
  H2: 'healer',
  D1: 'dps',
  D2: 'dps',
  D3: 'dps',
  D4: 'dps',
};

/**
 * 職能在 UI 上的中文顯示名稱（繁體中文/台灣用語）。
 *
 * Why: CLAUDE.md 第 8 點要求台灣用語，且需自然口語化。
 * 「主坦/副坦/純補/盾補/近D/遠D」為台服與台灣社群最常見講法。
 */
export const ROLE_DISPLAY_NAME: Record<RoleId, string> = {
  MT: '主坦 (MT)',
  ST: '副坦 (ST)',
  H1: '純補 (H1)',
  H2: '盾補 (H2)',
  D1: '近D1 (D1)',
  D2: '近D2 (D2)',
  D3: '遠D1 (D3)',
  D4: '遠D2 (D4)',
};
