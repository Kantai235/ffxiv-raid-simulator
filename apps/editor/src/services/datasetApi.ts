/**
 * ========================================================================
 * Editor Dataset API 客戶端 - 包裝 localFileApi Vite plugin
 * ========================================================================
 *
 * 此模組是 Editor UI 與 Vite plugin（plugins/localFileApi.ts）之間的橋樑。
 * 所有對 dataset 檔案的讀寫都應走此模組，便於：
 *   1. 集中錯誤處理（網路 / HTTP / parse 三類錯誤統一包裝）
 *   2. 未來若要換成 Express server 或 IPC 只需改此檔
 *
 * 【架構邊界】CLAUDE.md 第 7 點：editor 為本機工具，這些 endpoint
 *   只在 dev server 內存在；apps/player 嚴禁引用此模組。
 *
 * 【URL 設計】
 *   - GET  /api/dataset/list           → 列出所有 *.json
 *   - GET  /api/dataset?file=xxx.json  → 讀取
 *   - POST /api/dataset?file=xxx.json  → 寫入
 * ========================================================================
 */

import type { InstanceDataset } from '@ffxiv-sim/shared';

/**
 * Dataset API 失敗錯誤型別。
 *
 * UI 層用 `instanceof DatasetApiError` 統一捕捉，並依 reason 分支顯示。
 */
export class DatasetApiError extends Error {
  readonly reason: 'network' | 'http' | 'parse' | 'invalid-filename';
  readonly path: string;

  constructor(
    reason: DatasetApiError['reason'],
    path: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DatasetApiError';
    this.reason = reason;
    this.path = path;
  }
}

/**
 * 檔名白名單 - 與 plugins/localFileApi.ts 的 SAFE_FILENAME_PATTERN 對齊。
 *
 * Why 客戶端也檢查：可在發送 request 前提早給出錯誤訊息，
 *      避免送到 server 後才被拒絕（雖然 server 仍是最終防線）。
 */
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.json$/;

function assertSafeFilename(filename: string): void {
  if (!SAFE_FILENAME_PATTERN.test(filename)) {
    throw new DatasetApiError(
      'invalid-filename',
      filename,
      `不合法的檔名：${filename}（僅允許英數、底線、連字號 + .json）`,
    );
  }
}

/**
 * 共用 fetch + 統一錯誤包裝。
 */
async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    throw new DatasetApiError('network', input, `無法連線至本機 API：${input}`, { cause });
  }
  if (!response.ok) {
    // 嘗試解析後端的 error 訊息
    let detail = '';
    try {
      const body = (await response.json()) as { error?: string };
      detail = body.error ? `（${body.error}）` : '';
    } catch {
      // 後端可能未回 JSON；忽略
    }
    throw new DatasetApiError(
      'http',
      input,
      `API 呼叫失敗 HTTP ${response.status}${detail}`,
    );
  }
  return response;
}

/**
 * 列出 player/assets/data/ 下所有 .json 檔。
 */
export async function listDatasets(): Promise<string[]> {
  const res = await safeFetch('/api/dataset/list');
  try {
    const body = (await res.json()) as { files: string[] };
    return body.files;
  } catch (cause) {
    throw new DatasetApiError('parse', '/api/dataset/list', '回應 JSON 解析失敗', { cause });
  }
}

/**
 * 讀取指定 dataset 檔。
 */
export async function readDataset(filename: string): Promise<InstanceDataset> {
  assertSafeFilename(filename);
  const path = `/api/dataset?file=${encodeURIComponent(filename)}`;
  const res = await safeFetch(path);
  try {
    return (await res.json()) as InstanceDataset;
  } catch (cause) {
    throw new DatasetApiError('parse', path, '回應 JSON 解析失敗', { cause });
  }
}

/**
 * 寫入指定 dataset 檔。
 *
 * @param filename  目標檔名（白名單檢查）
 * @param data      完整 InstanceDataset 物件
 * @returns         server 回傳的相對路徑（給 UI 顯示「已寫入 X」）
 */
export async function writeDataset(
  filename: string,
  data: InstanceDataset,
): Promise<{ path: string }> {
  assertSafeFilename(filename);
  const path = `/api/dataset?file=${encodeURIComponent(filename)}`;
  const res = await safeFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  try {
    return (await res.json()) as { path: string };
  } catch (cause) {
    throw new DatasetApiError('parse', path, '回應 JSON 解析失敗', { cause });
  }
}

/**
 * 上傳場地圖到 player 的 assets/arenas/。
 *
 * 採 raw bytes + Content-Type 標示格式（非 multipart/form-data）。
 * server 端依 MIME 白名單驗證、產生隨機 UUID 檔名，回傳相對路徑。
 *
 * @param file  瀏覽器 File 物件（從 <input type="file"> 取得）
 * @returns     server 回傳的相對路徑（如 'assets/arenas/abc123.png'），
 *              可直接寫入 Arena.backgroundImage
 */
export async function uploadArenaImage(file: File): Promise<{ path: string }> {
  // 用 ArrayBuffer 作 body - fetch 自動處理 binary
  const buffer = await file.arrayBuffer();
  const path = '/api/upload-arena-image';
  const res = await safeFetch(path, {
    method: 'POST',
    // Content-Type 至關重要：server 依此判斷副檔名與 MIME 白名單
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: buffer,
  });
  try {
    return (await res.json()) as { path: string };
  } catch (cause) {
    throw new DatasetApiError('parse', path, '回應 JSON 解析失敗', { cause });
  }
}

/**
 * 探測當前環境是否有 local file API 可用。
 *
 * 【為何動態探測而非 import.meta.env.DEV】
 * `import.meta.env.DEV` 只反映 build 當時的模式；朋友用的 GH Pages 版本
 * 是 production build，但也不保證「所有 production build 都沒 API」
 * （未來若有其他部署情境）。
 *
 * 最可靠的是實際 fetch 一次 /api/dataset/list：
 *   - 200 → 有 API（本機 dev server 跑著 Vite plugin）
 *   - 任何錯誤（404 / network） → 無 API（靜態 GH Pages）
 *
 * 此探測應在 app 啟動時呼叫一次，結果存入 store 供全域使用。
 *
 * @returns true 表有 API（支援寫回 dataset / 上傳圖片），false 表靜態環境
 */
export async function detectLocalApi(): Promise<boolean> {
  try {
    const res = await fetch('/api/dataset/list', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
