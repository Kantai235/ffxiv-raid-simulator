/**
 * ========================================================================
 * 結算評價分類 - 純函數
 * ========================================================================
 * 依正確率對應 FFXIV 風格的評價標籤。
 *
 * 門檻（依需求文件）：
 *   - 100%   → Perfect       「完美通關」
 *   - >= 80% → Duty Complete  「通關」
 *   - 其他   → Wipe           「滅團」
 *
 * 邊界：
 *   - 80% 整數 → 算 Duty Complete（>=，含等號）
 *   - 0 題或無法計算 → 視為 Wipe（顯示時呼叫端應自行擋掉「0/0」情境）
 *
 * 抽成純函數的好處：ResultView 與 ReviewView header 共用，
 *                  且可獨立寫單元測試覆蓋邊界。
 * ========================================================================
 */

export type RatingTier = 'perfect' | 'complete' | 'wipe';

export interface Rating {
  tier: RatingTier;
  /** 顯示用標籤（繁體中文） */
  label: string;
  /** 對應的 Tailwind 文字色 class */
  colorClass: string;
}

const RATING_MAP: Record<RatingTier, Rating> = {
  perfect: { tier: 'perfect', label: '完美通關 (Perfect)', colorClass: 'text-ffxiv-accent' },
  complete: { tier: 'complete', label: '通關 (Duty Complete)', colorClass: 'text-ffxiv-safe' },
  wipe: { tier: 'wipe', label: '滅團 (Wipe)', colorClass: 'text-ffxiv-danger' },
};

/**
 * 依「正確 / 總題」算出評價。
 *
 * @param correctCount  正確題數
 * @param totalCount    總題數（必須 > 0，呼叫端應自行驗證）
 * @returns             Rating 物件（含 tier、label、color class）
 */
export function calculateRating(correctCount: number, totalCount: number): Rating {
  if (totalCount <= 0) return RATING_MAP.wipe;
  // 用比例比較而非百分比 round，避免 79.999 因四捨五入變 80 後誤判 complete
  const ratio = correctCount / totalCount;
  if (ratio >= 1) return RATING_MAP.perfect;
  if (ratio >= 0.8) return RATING_MAP.complete;
  return RATING_MAP.wipe;
}
