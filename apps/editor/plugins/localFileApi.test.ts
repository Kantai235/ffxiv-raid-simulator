import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { localFileApiPlugin } from './localFileApi';

type MiddlewareHandler = (
  req: {
    method?: string;
    url?: string;
    headers: Record<string, string>;
    [Symbol.asyncIterator](): AsyncGenerator<Buffer, void, void>;
  },
  res: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(chunk?: string | Buffer): void;
  },
  next: () => void,
) => Promise<unknown> | unknown;

interface TestResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  setHeader(name: string, value: string): void;
  end(chunk?: string | Buffer): void;
}

async function createWorkspace(): Promise<{
  repoRoot: string;
  editorRoot: string;
  writePlayerAsset: (relativePath: string, content: Buffer) => Promise<void>;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'ffxiv-local-file-api-'));
  const editorRoot = join(repoRoot, 'apps', 'editor');
  await mkdir(editorRoot, { recursive: true });

  return {
    repoRoot,
    editorRoot,
    async writePlayerAsset(relativePath: string, content: Buffer): Promise<void> {
      const target = join(repoRoot, 'apps', 'player', 'public', 'assets', relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    },
  };
}

function captureMiddleware(editorRoot: string): MiddlewareHandler {
  let handler: MiddlewareHandler | null = null;
  const plugin = localFileApiPlugin();
  const configureServer =
    typeof plugin.configureServer === 'function' ? plugin.configureServer : null;
  if (!configureServer) throw new Error('localFileApi configureServer 未提供');

  configureServer({
    config: { root: editorRoot },
    middlewares: {
      use(fn: MiddlewareHandler) {
        handler = fn;
      },
    },
  } as never);

  if (!handler) throw new Error('localFileApi middleware 未註冊');
  return handler;
}

function createResponse(): TestResponse {
  const response: TestResponse = {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(name: string, value: string): void {
      response.headers[name] = value;
    },
    end(chunk?: string | Buffer): void {
      response.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? '', 'utf-8');
    },
  };
  return response;
}

async function invoke(
  handler: MiddlewareHandler,
  request: { method?: string; url: string },
): Promise<{ nextCalled: boolean; response: TestResponse }> {
  const response = createResponse();
  let nextCalled = false;

  await handler(
    {
      method: request.method ?? 'GET',
      url: request.url,
      headers: {},
      async *[Symbol.asyncIterator]() {
        return;
      },
    },
    response,
    () => {
      nextCalled = true;
    },
  );

  return { nextCalled, response };
}

describe('localFileApiPlugin - 共用素材代理', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('會代理 /assets/icons/* 到 player/public/assets/icons', async () => {
    const workspace = await createWorkspace();
    tempDirs.push(workspace.repoRoot);
    await workspace.writePlayerAsset(
      join('icons', 'arrow-end.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const handler = captureMiddleware(workspace.editorRoot);
    const { nextCalled, response } = await invoke(handler, {
      url: '/assets/icons/arrow-end.png',
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('image/png');
    expect(response.headers['Cache-Control']).toBe('public, max-age=300');
    expect([...response.body]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('既有 /assets/boss/* 代理在重構後仍可正常服務', async () => {
    const workspace = await createWorkspace();
    tempDirs.push(workspace.repoRoot);
    await workspace.writePlayerAsset(
      join('boss', 'boss-marker.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const handler = captureMiddleware(workspace.editorRoot);
    const { nextCalled, response } = await invoke(handler, {
      url: '/assets/boss/boss-marker.png',
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('image/png');
    expect(response.headers['Cache-Control']).toBe('public, max-age=300');
  });
});
