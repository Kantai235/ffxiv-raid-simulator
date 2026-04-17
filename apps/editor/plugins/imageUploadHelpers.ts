import { randomBytes } from 'node:crypto';

/**
 * ========================================================================
 * 場地圖上傳 - 純函數 helpers（無 fs 副作用，方便單元測試）
 * ========================================================================
 *
 * 抽出的目的：
 *   - MIME 白名單、副檔名映射、安全檔名生成、大小驗證 都是純邏輯，
 *     不該與 Node fs API 耦合，否則測試需 mock fs 才能驗證
 *   - plugin 主檔僅負責「組合 helper + 寫檔 + 回應」，邏輯路徑變短
 * ========================================================================
 */

/** 允許的 MIME 與對應副檔名（白名單） */
export const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * 反向映射：副檔名 → MIME（給「伺服已上傳圖片」時決定 Content-Type 用）。
 *
 * 注意：上傳時 image/jpeg 被存為 .jpg，所以這個 map 也要能認 .jpg。
 */
export const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * 依副檔名取得 Content-Type。
 * 白名單外的副檔名回 null 讓呼叫端回 404，避免 editor 代理任意檔案。
 */
export function mimeFromExt(ext: string): string | null {
  return EXT_TO_MIME[ext.toLowerCase()] ?? null;
}

/** 上傳大小上限：5 MB。場地圖通常 < 1MB，給足緩衝。 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type UploadValidationError =
  | { ok: false; reason: 'unsupported-mime'; message: string }
  | { ok: false; reason: 'too-large'; message: string }
  | { ok: false; reason: 'empty'; message: string };

export type UploadValidationOk = {
  ok: true;
  /** 對應的副檔名（不含點，如 'png'） */
  ext: string;
};

/**
 * 驗證上傳請求。
 *
 * @param mime    Content-Type header 中的 MIME（小寫）
 * @param size    body 位元組大小
 */
export function validateUpload(
  mime: string | undefined,
  size: number,
): UploadValidationOk | UploadValidationError {
  if (size <= 0) {
    return { ok: false, reason: 'empty', message: '上傳內容為空' };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: `檔案過大（${size} bytes，上限 ${MAX_UPLOAD_BYTES}）`,
    };
  }
  const normalizedMime = (mime ?? '').toLowerCase().split(';')[0].trim();
  const ext = ALLOWED_MIME_TO_EXT[normalizedMime];
  if (!ext) {
    return {
      ok: false,
      reason: 'unsupported-mime',
      message: `不支援的圖片格式：${mime ?? '(未提供)'}`,
    };
  }
  return { ok: true, ext };
}

/**
 * 產生安全的隨機檔名 - 16 bytes hex + 副檔名。
 *
 * 為何採用隨機檔名（而非保留使用者原檔名）：
 *   1. 完全杜絕路徑穿越風險（產出格式固定為 [a-f0-9]{32}\.ext）
 *   2. 避免檔名衝突
 *   3. 不需處理中文/特殊字元的 URL encoding
 *
 * 16 bytes = 128 bits 隨機，碰撞機率可忽略。
 *
 * @param ext   副檔名（不含點）
 * @param rng   隨機字節產生器（測試時可注入確定值；預設用 node:crypto）
 */
export function generateSafeFilename(
  ext: string,
  rng: (size: number) => Buffer = randomBytes,
): string {
  const random = rng(16).toString('hex');
  return `${random}.${ext}`;
}
