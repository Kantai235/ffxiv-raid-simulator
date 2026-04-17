/**
 * ========================================================================
 * 剪貼簿寫入 - 含 fallback 的封裝
 * ========================================================================
 *
 * 為何需要 fallback：
 *   - `navigator.clipboard.writeText` 只在 secure context（HTTPS / localhost）
 *     才可用；HTTP 站點會拋 DOMException
 *   - 部分瀏覽器/擴充功能會封鎖此 API 呼叫
 *   - iOS Safari 行動版在某些情境下也會失敗
 *
 * 三層 fallback：
 *   1. navigator.clipboard.writeText（現代 / 推薦）
 *   2. document.execCommand('copy')（相容但被列為 deprecated，仍廣泛支援）
 *   3. 兩者都失敗 → 回傳 false 讓 UI 顯示「請手動複製」
 * ========================================================================
 */

/**
 * 嘗試將文字寫入剪貼簿。
 *
 * @returns true 表示成功；false 表示兩層 fallback 都失敗，
 *          呼叫端應顯示「請手動複製」或類似提示。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 第一層：navigator.clipboard（現代 API）
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 失敗 → fallback，不拋出（此函數承諾「不拋」的契約，簡化呼叫端）
    }
  }

  // 第二層：document.execCommand('copy') + 隱藏 textarea
  // 雖已 deprecated 但廣泛支援；HTTP / 無 Clipboard API 環境下的救生索
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // 避免觸發 scroll / 影響 layout
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    // iOS 需要 setSelectionRange 才能真的選中
    textarea.setSelectionRange(0, text.length);
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
