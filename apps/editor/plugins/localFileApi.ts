import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  MAX_UPLOAD_BYTES,
  generateSafeFilename,
  mimeFromExt,
  validateUpload,
} from './imageUploadHelpers';

/**
 * Editor dev server 直接讀寫的 player 資料目錄。
 */
const PLAYER_DATA_DIR_REL = '../player/public/assets/data';

/**
 * arena 背景圖寫回 dataset 時使用的相對路徑前綴。
 */
const PLAYER_ARENAS_RELATIVE_PREFIX = 'assets/arenas';

/**
 * Editor 會在本地開發時直接代理 player/public/assets 內的共用素材。
 *
 * Why:
 * - editor 自己沒有 public/，但畫布上的 `<image href="assets/...">` 仍會發請求
 * - 用表驅動集中管理，比散落白名單與重複 handler 更不容易漏資料夾
 */
const SHARED_ASSET_SOURCES = {
  arenas: {
    urlPrefix: '/assets/arenas/',
    dirRel: '../player/public/assets/arenas',
    cacheControl: 'no-store',
  },
  boss: {
    urlPrefix: '/assets/boss/',
    dirRel: '../player/public/assets/boss',
    cacheControl: 'public, max-age=300',
  },
  icons: {
    urlPrefix: '/assets/icons/',
    dirRel: '../player/public/assets/icons',
    cacheControl: 'public, max-age=300',
  },
} as const;

type SharedAssetSourceKey = keyof typeof SHARED_ASSET_SOURCES;

interface SharedAssetSource {
  key: SharedAssetSourceKey;
  urlPrefix: string;
  dirAbs: string;
  cacheControl: string;
}

/**
 * dataset 檔名白名單，只接受 monorepo 內的 `x.json` 形式。
 */
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.json$/;

interface ApiError {
  error: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message } satisfies ApiError);
}

function isPathInsideDir(target: string, dirAbs: string): boolean {
  return target.startsWith(dirAbs + (process.platform === 'win32' ? '\\' : '/'));
}

function resolveSafeDatasetPath(filename: string | undefined, dataDirAbs: string): string | null {
  if (!filename || !SAFE_FILENAME_PATTERN.test(filename)) {
    return null;
  }
  const target = resolve(dataDirAbs, filename);
  return isPathInsideDir(target, dataDirAbs) ? target : null;
}

function resolveSharedAssetSources(root: string): SharedAssetSource[] {
  return Object.entries(SHARED_ASSET_SOURCES).map(([key, source]) => ({
    key: key as SharedAssetSourceKey,
    urlPrefix: source.urlPrefix,
    dirAbs: resolve(root, source.dirRel),
    cacheControl: source.cacheControl,
  }));
}

function matchSharedAssetSource(
  pathname: string,
  sources: SharedAssetSource[],
): SharedAssetSource | null {
  return sources.find((source) => pathname.startsWith(source.urlPrefix)) ?? null;
}

function resolveSafeSharedAssetPath(pathname: string, source: SharedAssetSource): string | null {
  const requestedFilename = pathname.slice(source.urlPrefix.length);
  if (!/^[a-zA-Z0-9_.-]+$/.test(requestedFilename) || requestedFilename.includes('..')) {
    return null;
  }
  const target = resolve(source.dirAbs, requestedFilename);
  return isPathInsideDir(target, source.dirAbs) ? target : null;
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

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
      throw new Error(`上傳內容超過限制 ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function serveSharedAsset(
  res: ServerResponse,
  pathname: string,
  source: SharedAssetSource,
): Promise<void> {
  const target = resolveSafeSharedAssetPath(pathname, source);
  if (!target) {
    sendError(res, 400, '不合法的檔名');
    return;
  }

  const ext = target.split('.').pop()?.toLowerCase() ?? '';
  const mime = mimeFromExt(ext);
  if (!mime) {
    sendError(res, 404, '不支援的檔案類型');
    return;
  }

  try {
    const data = await readFile(target);
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', source.cacheControl);
    res.end(data);
  } catch {
    sendError(res, 404, '檔案不存在');
  }
}

export function localFileApiPlugin(): Plugin {
  return {
    name: 'ffxiv-sim-local-file-api',
    apply: 'serve',
    configureServer(server) {
      const dataDirAbs = resolve(server.config.root, PLAYER_DATA_DIR_REL);
      const sharedAssetSources = resolveSharedAssetSources(server.config.root);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();

        const url = new URL(req.url, 'http://localhost');
        const sharedAssetSource = matchSharedAssetSource(url.pathname, sharedAssetSources);

        if (
          !url.pathname.startsWith('/api/dataset') &&
          url.pathname !== '/api/upload-arena-image' &&
          !sharedAssetSource
        ) {
          return next();
        }

        const filename = url.searchParams.get('file') ?? undefined;

        try {
          if (req.method === 'GET' && url.pathname === '/api/dataset/list') {
            const { readdir } = await import('node:fs/promises');
            await mkdir(dataDirAbs, { recursive: true });
            const files = (await readdir(dataDirAbs)).filter((file) => file.endsWith('.json'));
            return sendJson(res, 200, { files });
          }

          if (req.method === 'GET' && url.pathname === '/api/dataset') {
            const target = resolveSafeDatasetPath(filename, dataDirAbs);
            if (!target) return sendError(res, 400, '不合法的檔名');

            const content = await readFile(target, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(content);
          }

          if (req.method === 'POST' && url.pathname === '/api/dataset') {
            const target = resolveSafeDatasetPath(filename, dataDirAbs);
            if (!target) return sendError(res, 400, '不合法的檔名');

            const body = await readJsonBody(req);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf-8');

            return sendJson(res, 200, {
              ok: true,
              path: join('apps/player/public/assets/data', filename!),
            });
          }

          if (req.method === 'POST' && url.pathname === '/api/upload-arena-image') {
            const declaredLength = Number.parseInt(
              (req.headers['content-length'] as string | undefined) ?? '0',
              10,
            );
            if (declaredLength > MAX_UPLOAD_BYTES) {
              return sendError(res, 413, `上傳內容超過限制 ${MAX_UPLOAD_BYTES} bytes`);
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

            const arenasSource = sharedAssetSources.find((source) => source.key === 'arenas');
            if (!arenasSource) {
              return sendError(res, 500, 'arenas 資產目錄未設定');
            }

            const generatedFilename = generateSafeFilename(validation.ext);
            await mkdir(arenasSource.dirAbs, { recursive: true });
            await writeFile(resolve(arenasSource.dirAbs, generatedFilename), buffer);

            return sendJson(res, 200, {
              ok: true,
              path: `${PLAYER_ARENAS_RELATIVE_PREFIX}/${generatedFilename}`,
            });
          }

          if (req.method === 'GET' && sharedAssetSource) {
            await serveSharedAsset(res, url.pathname, sharedAssetSource);
            return;
          }

          return sendError(res, 405, '不支援的操作');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return sendError(res, 500, message);
        }
      });
    },
  };
}
