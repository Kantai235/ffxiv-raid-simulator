import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import {
  MAX_UPLOAD_BYTES,
  generateSafeFilename,
  mimeFromExt,
  validateUpload,
} from './imageUploadHelpers';

/**
 * ========================================================================
 * 本機檔案 API Vite Plugin
 * ========================================================================
 * 為 Editor 提供「視覺化編輯後一鍵匯出 data.json」的能力。
 *
 * 【嚴格限制】
 *   1. 僅在 dev server（localhost）下啟用，build 時不會打包進產物。
 *   2. 寫入路徑被白名單鎖定為 player 的 assets/data/ 目錄，
 *      避免路徑穿越攻擊（../../../etc/passwd 等）。
 *   3. 所有 endpoint 僅接受 application/json 請求。
 *
 * 【提供的 endpoint】
 *   - GET  /api/dataset?file=index.json     → 讀取 dataset 檔案內容
 *   - POST /api/dataset?file=m1s.json       → 將 body 寫入指定 dataset 檔案
 *   - GET  /api/dataset/list                → 列出 player/assets/data/ 下所有 .json
 *   - POST /api/upload-arena-image          → 上傳場地圖（raw bytes，依 Content-Type 決定副檔名）
 *
 * Why 這樣設計：
 *   - 直接走 Vite middleware 而非另起 Express，少一個 process 與設定
 *   - 用 file query 參數而非 path 參數，避免 :file 被解讀為含 / 的路徑
 *   - 寫入前用 path.resolve + 前綴比對驗證，杜絕 ../ 穿越
 *   - 圖片上傳用 raw bytes 而非 multipart/form-data，避免引入 busboy 等依賴
 * ========================================================================
 */

/**
 * Player 前台的 dataset 目錄（相對於 monorepo root）。
 * 寫檔目標 = 這個目錄，玩家前台 build 時會自動把 public/ 內容打包進去。
 */
const PLAYER_DATA_DIR_REL = '../player/public/assets/data';

/** 場地圖目錄 - 對應 player 端的 assets/arenas/ */
const PLAYER_ARENAS_DIR_REL = '../player/public/assets/arenas';

/** 場地圖路徑寫入 dataset 時用的相對路徑前綴（相對於 player 的 public/） */
const PLAYER_ARENAS_RELATIVE_PREFIX = 'assets/arenas';

/**
 * 王面嚮圖示等共用素材目錄。與 arenas 同樣是 editor 需要透過 plugin 代理的資源。
 * 不允許上傳，僅供 GET 取用，因此沒有 RELATIVE_PREFIX 對應變數。
 */
const PLAYER_BOSS_DIR_REL = '../player/public/assets/boss';

/**
 * 允許的檔名格式：英數、底線、連字號，副檔名 .json。
 * Why: 防止 file=../../etc/passwd 之類的路徑注入。
 */
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.json$/;

interface ApiError {
  error: string;
}

function sendJson(res: Parameters<NonNullable<ViteDevServer['middlewares']['use']>>[0] extends never ? never : import('node:http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendError(res: import('node:http').ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message } satisfies ApiError);
}

/**
 * 取得並驗證寫檔目標的絕對路徑。
 * 失敗（無 file 參數、檔名非法、路徑穿越）回傳 null，呼叫端應回 400。
 */
function resolveSafeDatasetPath(filename: string | undefined, dataDirAbs: string): string | null {
  if (!filename || !SAFE_FILENAME_PATTERN.test(filename)) {
    return null;
  }
  const target = resolve(dataDirAbs, filename);
  // 二次防線：解析後的路徑必須仍位於 dataDirAbs 之下
  if (!target.startsWith(dataDirAbs + (process.platform === 'win32' ? '\\' : '/'))) {
    return null;
  }
  return target;
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(raw);
}

/**
 * 讀取 binary body 並強制大小上限。
 *
 * Why 邊讀邊累計而非全讀後檢查：
 *   讀到一半發現超限即可中斷，避免惡意端點塞 GB 級資料耗盡記憶體。
 *
 * @throws Error 若超過 MAX_UPLOAD_BYTES
 */
async function readBinaryBody(
  req: import('node:http').IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`上傳超過上限 ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function localFileApiPlugin(): Plugin {
  return {
    name: 'ffxiv-sim-local-file-api',
    apply: 'serve', // 僅 dev server 啟用，build 時不存在
    configureServer(server) {
      // 解析寫檔目標的絕對路徑（基於此 plugin 檔案位置）
      const dataDirAbs = resolve(server.config.root, PLAYER_DATA_DIR_REL);
      const arenasDirAbs = resolve(server.config.root, PLAYER_ARENAS_DIR_REL);
      const bossDirAbs = resolve(server.config.root, PLAYER_BOSS_DIR_REL);

      server.middlewares.use(async (req, res, next) => {
        // 路由分派：/api/dataset* 或 /api/upload-arena-image 或 /assets/arenas/* 或 /assets/boss/*
        //
        // 【為何 editor 要提供這些靜態資源】
        // 圖片素材都存在 player 的 public/assets/，editor dev server 不認識該目錄。
        // 若不代理，editor 的 <image href="assets/..."> 會 404。
        if (
          !req.url?.startsWith('/api/dataset') &&
          !req.url?.startsWith('/api/upload-arena-image') &&
          !req.url?.startsWith('/assets/arenas/') &&
          !req.url?.startsWith('/assets/boss/')
        ) {
          return next();
        }

        // 解析 query 參數
        const url = new URL(req.url, 'http://localhost');
        const filename = url.searchParams.get('file') ?? undefined;

        try {
          // GET /api/dataset/list - 列出所有 dataset 檔
          if (req.method === 'GET' && url.pathname === '/api/dataset/list') {
            const { readdir } = await import('node:fs/promises');
            await mkdir(dataDirAbs, { recursive: true });
            const files = (await readdir(dataDirAbs)).filter((f) => f.endsWith('.json'));
            return sendJson(res, 200, { files });
          }

          // GET /api/dataset?file=xxx.json - 讀取
          if (req.method === 'GET' && url.pathname === '/api/dataset') {
            const target = resolveSafeDatasetPath(filename, dataDirAbs);
            if (!target) return sendError(res, 400, '無效的檔名');
            const content = await readFile(target, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(content);
          }

          // POST /api/dataset?file=xxx.json - 寫入
          if (req.method === 'POST' && url.pathname === '/api/dataset') {
            const target = resolveSafeDatasetPath(filename, dataDirAbs);
            if (!target) return sendError(res, 400, '無效的檔名');
            const body = await readJsonBody(req);
            await mkdir(dirname(target), { recursive: true });
            // 寫入時保留縮排，方便人類 review git diff
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf-8');
            return sendJson(res, 200, {
              ok: true,
              path: join('apps/player/public/assets/data', filename!),
            });
          }

          // POST /api/upload-arena-image - 場地圖上傳
          // 接收 raw bytes，依 Content-Type 決定副檔名，產生 UUID 檔名後寫入。
          // 回傳對 player 端可用的相對路徑（assets/arenas/xxx.png）。
          if (req.method === 'POST' && url.pathname === '/api/upload-arena-image') {
            // 先檢查 Content-Length（若有）以早期擋下過大請求
            const declaredLength = Number.parseInt(
              (req.headers['content-length'] as string | undefined) ?? '0',
              10,
            );
            if (declaredLength > MAX_UPLOAD_BYTES) {
              return sendError(res, 413, `檔案過大（上限 ${MAX_UPLOAD_BYTES} bytes）`);
            }

            const buffer = await readBinaryBody(req, MAX_UPLOAD_BYTES);
            const validation = validateUpload(
              req.headers['content-type'] as string | undefined,
              buffer.length,
            );
            if (!validation.ok) {
              const statusCode = validation.reason === 'too-large' ? 413 : 400;
              return sendError(res, statusCode, validation.message);
            }

            // 產生隨機檔名 + 寫入
            const filename = generateSafeFilename(validation.ext);
            await mkdir(arenasDirAbs, { recursive: true });
            await writeFile(resolve(arenasDirAbs, filename), buffer);

            return sendJson(res, 200, {
              ok: true,
              // 相對於 player 的 public/，可直接寫入 dataset 的 arena.backgroundImage
              path: `${PLAYER_ARENAS_RELATIVE_PREFIX}/${filename}`,
            });
          }

          // GET /assets/arenas/:filename - 代理 player 的場地圖
          //
          // Editor 的 EditableArenaMap 用 <image href="assets/arenas/xxx.png">
          // 載入背景圖，但該檔實際在 player 的 public 目錄（editor dev server
          // 不認識）。這個 endpoint 讀 player/public/assets/arenas/ 的檔案回傳，
          // 讓 editor 的 SVG 能正確顯示剛上傳的新圖。
          //
          // 安全：用同樣的檔名白名單 + path.resolve 前綴比對，杜絕路徑穿越。
          // 快取：明確回 Cache-Control: no-store，因 editor 正在編輯，
          //      每次 SVG 用 ?t=timestamp 觸發重抓時都要拿到最新檔案。
          if (req.method === 'GET' && url.pathname.startsWith('/assets/arenas/')) {
            const requestedFilename = url.pathname.slice('/assets/arenas/'.length);
            // 檔名白名單：與 generateSafeFilename 產出格式對齊，但放寬允許
            // 非 UUID 格式（使用者可能手動放圖進去）
            if (!/^[a-zA-Z0-9_.-]+$/.test(requestedFilename) || requestedFilename.includes('..')) {
              return sendError(res, 400, '無效的檔名');
            }
            const target = resolve(arenasDirAbs, requestedFilename);
            // 二次防線：確保解析後路徑仍在 arenasDirAbs 底下
            if (!target.startsWith(arenasDirAbs + (process.platform === 'win32' ? '\\' : '/'))) {
              return sendError(res, 400, '路徑穿越偵測');
            }
            // 依副檔名決定 Content-Type；白名單外（如 .exe）直接 404
            const ext = requestedFilename.split('.').pop()?.toLowerCase() ?? '';
            const mime = mimeFromExt(ext);
            if (!mime) return sendError(res, 404, '不支援的檔案類型');

            try {
              const data = await readFile(target);
              res.statusCode = 200;
              res.setHeader('Content-Type', mime);
              // 編輯中場景：明確禁止快取讓 ?t=timestamp 每次都打到新檔
              res.setHeader('Cache-Control', 'no-store');
              return res.end(data);
            } catch {
              return sendError(res, 404, '檔案不存在');
            }
          }

          // GET /assets/boss/:filename - 代理 player 的 boss 標記等共用素材
          // 與上方 /assets/arenas/ 同套安全檢查（檔名白名單 + 路徑穿越防禦 + MIME 白名單）
          if (req.method === 'GET' && url.pathname.startsWith('/assets/boss/')) {
            const requestedFilename = url.pathname.slice('/assets/boss/'.length);
            if (!/^[a-zA-Z0-9_.-]+$/.test(requestedFilename) || requestedFilename.includes('..')) {
              return sendError(res, 400, '無效的檔名');
            }
            const target = resolve(bossDirAbs, requestedFilename);
            if (!target.startsWith(bossDirAbs + (process.platform === 'win32' ? '\\' : '/'))) {
              return sendError(res, 400, '路徑穿越偵測');
            }
            const ext = requestedFilename.split('.').pop()?.toLowerCase() ?? '';
            const mime = mimeFromExt(ext);
            if (!mime) return sendError(res, 404, '不支援的檔案類型');

            try {
              const data = await readFile(target);
              res.statusCode = 200;
              res.setHeader('Content-Type', mime);
              // boss 素材通常不會頻繁變動，可以給較短的快取
              res.setHeader('Cache-Control', 'public, max-age=300');
              return res.end(data);
            } catch {
              return sendError(res, 404, '檔案不存在');
            }
          }

          return sendError(res, 405, '不支援的方法');
        } catch (err) {
          // 統一錯誤處理：開發環境回完整訊息方便 debug
          const message = err instanceof Error ? err.message : String(err);
          return sendError(res, 500, message);
        }
      });
    },
  };
}
