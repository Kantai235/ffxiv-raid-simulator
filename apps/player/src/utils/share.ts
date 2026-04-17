import type { RoleId, SessionResult } from '@ffxiv-sim/shared';

/**
 * ========================================================================
 * 成績單分享 - 序列化編解碼
 * ========================================================================
 *
 * 玩家結算後可產生「分享連結」讓朋友看到成績並被導去挑戰同副本。
 *
 * 【URL 長度約束】
 * 瀏覽器與多數聊天工具的 URL 長度硬限約 8KB，但 Discord/Line 等預覽
 * 常在 2KB 就截斷。因此 payload 必須極度精簡：
 *   - 絕對不放完整 answers 陣列或 dataset
 *   - 只放「可顯示成績單所需的最少欄位」
 *   - 評價等衍生值由接收端即時計算，不存 payload（既省 bytes 也防造假）
 *
 * 【編碼：JSON → UTF-8 bytes → Base64URL】
 * base64 預設字元集含 '+' '/' '='，在 URL 中會被聊天工具截斷。
 * 使用 Base64URL（RFC 4648 §5）：'+' → '-'、'/' → '_'、去除 '=' padding。
 *
 * 中文處理：`btoa` 只接受 latin-1，直接丟中文會拋 InvalidCharacterError。
 * 最簡乾淨的現代解法是 `TextEncoder.encode` 先轉 UTF-8 bytes，
 * 再逐 byte 轉回 latin-1 給 btoa 吃。
 * 避免舊解法 `btoa(encodeURIComponent(...))` 造成的 3x 膨脹。
 *
 * 【版本號】
 * payload 帶 v=1 欄位；未來升版可檢查舊連結並給出相容訊息。
 * ========================================================================
 */

/** 分享 payload schema version。新增必要欄位時升版 */
export const SHARE_PAYLOAD_VERSION = 1;

/**
 * payload 最大 base64url 字串長度門檻。
 * 正常 payload <200 chars，設 4000 作上限防止惡意塞巨大 URL 爆 decode 記憶體。
 */
const MAX_ENCODED_LENGTH = 4000;

/**
 * 精簡成績單 payload。
 *
 * 鍵名刻意縮短（v/i/s/r/c/t/d）降低 URL 長度，對聊天工具的預覽更友善。
 * 對比用 `instanceName` 等全名，單次分享可省 30-50 bytes。
 */
export interface SharedScorecard {
  /** schema version（= SHARE_PAYLOAD_VERSION） */
  v: number;
  /** 副本名稱 */
  i: string;
  /** 攻略名稱 */
  s: string;
  /** 玩家職能 */
  r: RoleId;
  /** 正確題數 */
  c: number;
  /** 總題數 */
  t: number;
  /** 完成時間（epoch ms） */
  d: number;
}

/** 編解碼失敗統一錯誤型別 */
export class ShareScorecardError extends Error {
  readonly reason: 'encode' | 'decode' | 'version' | 'invalid' | 'too-large';

  constructor(reason: ShareScorecardError['reason'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ShareScorecardError';
    this.reason = reason;
  }
}

// ========================================================================
// Base64URL 工具
// ========================================================================

/** Uint8Array → Base64（latin-1 逐 byte） → 轉 Base64URL */
function bytesToBase64Url(bytes: Uint8Array): string {
  // 小塊 chunk 處理避免 String.fromCharCode(...很長 array) 爆 stack
  // 64KB chunk 對 payload size <5MB 都安全
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  // 轉 URL-safe：+ → -、/ → _、去除 = padding
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64URL → Uint8Array */
function base64UrlToBytes(s: string): Uint8Array {
  // 還原標準 base64 字元集
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  // 補回 padding 讓 atob 接受（長度必須為 4 的倍數）
  const pad = padded.length % 4;
  const base64 = pad === 0 ? padded : padded + '='.repeat(4 - pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ========================================================================
// 對外 API
// ========================================================================

/**
 * 將 SessionResult 精簡後編碼為 URL-safe 字串。
 *
 * 取用欄位：總題數、正確題數、完成時間、職能；副本/攻略名稱從外部傳入
 * （SessionResult 只有 id，顯示名稱要另外查表，避免編碼時依賴 store）。
 *
 * @param result          SessionResult 或其簡化輸入
 * @param instanceName    副本顯示名（如 '阿卡迪亞零式輕量級 M1S'）
 * @param strategyName    攻略顯示名（如 'Game8 攻略'）
 * @returns               Base64URL 字串，直接可放進 URL 的 ?data=<string>
 * @throws ShareScorecardError reason='encode'
 */
export function encodeScorecard(
  result: Pick<SessionResult, 'roleId' | 'correctCount' | 'totalCount' | 'finishedAt'>,
  instanceName: string,
  strategyName: string,
): string {
  try {
    const payload: SharedScorecard = {
      v: SHARE_PAYLOAD_VERSION,
      i: instanceName,
      s: strategyName,
      r: result.roleId,
      c: result.correctCount,
      t: result.totalCount,
      d: result.finishedAt,
    };
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    return bytesToBase64Url(bytes);
  } catch (cause) {
    throw new ShareScorecardError('encode', '成績單編碼失敗', { cause });
  }
}

/**
 * 解碼 Base64URL 字串為 SharedScorecard。
 *
 * 驗證層級：
 *   1. 長度不超過 MAX_ENCODED_LENGTH（防惡意大 URL）
 *   2. Base64URL 解碼成功
 *   3. JSON 解析成功
 *   4. 版本號相容（payload.v ≤ SHARE_PAYLOAD_VERSION）
 *   5. 必要欄位齊全且型別正確
 *
 * @param encoded  從 URL query 取得的 Base64URL 字串
 * @returns        解析後的 SharedScorecard
 * @throws ShareScorecardError 各類失敗情境（reason 可分支處理）
 */
export function decodeScorecard(encoded: string): SharedScorecard {
  if (!encoded || typeof encoded !== 'string') {
    throw new ShareScorecardError('invalid', '分享資料為空');
  }
  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new ShareScorecardError(
      'too-large',
      `分享資料過大（${encoded.length} 字元，上限 ${MAX_ENCODED_LENGTH}）`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(encoded);
  } catch (cause) {
    throw new ShareScorecardError('decode', 'Base64 解碼失敗', { cause });
  }

  let parsed: unknown;
  try {
    const json = new TextDecoder().decode(bytes);
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new ShareScorecardError('decode', 'JSON 解析失敗', { cause });
  }

  // 結構驗證
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ShareScorecardError('invalid', '分享資料格式錯誤');
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.v !== 'number') {
    throw new ShareScorecardError('invalid', '缺少版本欄位');
  }
  if (p.v > SHARE_PAYLOAD_VERSION) {
    throw new ShareScorecardError(
      'version',
      `分享連結由較新版本產生（v${p.v}），請更新 Player 後重試`,
    );
  }
  if (
    typeof p.i !== 'string' ||
    typeof p.s !== 'string' ||
    typeof p.r !== 'string' ||
    typeof p.c !== 'number' ||
    typeof p.t !== 'number' ||
    typeof p.d !== 'number'
  ) {
    throw new ShareScorecardError('invalid', '分享資料欄位缺失或型別錯誤');
  }
  // totalCount 必須為正數（避免除以 0）；correctCount 不可超過 total
  if (p.t <= 0 || p.c < 0 || p.c > p.t) {
    throw new ShareScorecardError('invalid', '分享資料數值不合理');
  }

  return {
    v: p.v,
    i: p.i,
    s: p.s,
    r: p.r as RoleId,
    c: p.c,
    t: p.t,
    d: p.d,
  };
}

/**
 * 產生完整分享 URL。
 *
 * 使用 location.origin + location.pathname 作為 base，保留目前 GitHub Pages
 * 子路徑（例如 /ffxiv-raid-simulator/）。
 *
 * @param encoded  encodeScorecard 的輸出
 * @returns        形如 'https://foo.github.io/repo/#/scorecard?data=xxx'
 */
export function buildShareUrl(encoded: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/scorecard?data=${encoded}`;
}
