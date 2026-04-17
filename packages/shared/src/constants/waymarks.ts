/**
 * FFXIV 場地標記（Waymarks）代號。
 *
 * Why: 遊戲內可用的場地標記固定為 A/B/C/D（彩色十字）與 1/2/3/4（彩色圓點），
 * 共 8 個。Strategy（攻略組）會為每個 waymark 指派一個座標，前台依此繪製。
 *
 * 攻略組可選擇只使用部分標記（例如只用 A、B、1、2），未定義者前台不繪製。
 */
export const WAYMARK_IDS = ['A', 'B', 'C', 'D', '1', '2', '3', '4'] as const;

export type WaymarkId = (typeof WAYMARK_IDS)[number];

/**
 * Waymark 預設顏色（HEX），對應遊戲內視覺。
 * A=紅、B=黃、C=藍、D=紫；1=紅、2=黃、3=藍、4=紫。
 */
export const WAYMARK_COLOR: Record<WaymarkId, string> = {
  A: '#E74C3C',
  B: '#F1C40F',
  C: '#3498DB',
  D: '#9B59B6',
  '1': '#E74C3C',
  '2': '#F1C40F',
  '3': '#3498DB',
  '4': '#9B59B6',
};
