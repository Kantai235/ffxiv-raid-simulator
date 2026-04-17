import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DatasetApiError,
  fetchPublishedDataset,
  fetchPublishedIndex,
  listDatasets,
  readDataset,
  uploadArenaImage,
  writeDataset,
} from './datasetApi';

/**
 * datasetApi 客戶端測試 - 用 stubbed fetch 驗證錯誤分類與正常路徑。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listDatasets', () => {
  it('成功 → 回傳 files 陣列', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ files: ['m1s.json', 'm2s.json'] }));
    expect(await listDatasets()).toEqual(['m1s.json', 'm2s.json']);
  });

  it('網路錯誤 → reason=network', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fail'));
    await expect(listDatasets()).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('readDataset', () => {
  it('成功 → 回傳 dataset', async () => {
    const mock = { schemaVersion: '1.0' };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(mock));
    const result = await readDataset('m1s.json');
    expect(result).toEqual(mock);
  });

  it('不合法檔名 → reason=invalid-filename（不發 fetch）', async () => {
    const fetchSpy = vi.mocked(fetch);
    await expect(readDataset('../etc/passwd')).rejects.toMatchObject({
      reason: 'invalid-filename',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP 404 → reason=http 並含後端 error 訊息', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: '檔案不存在' }, 404));
    try {
      await readDataset('missing.json');
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetApiError);
      expect((err as DatasetApiError).reason).toBe('http');
      expect((err as DatasetApiError).message).toContain('檔案不存在');
    }
  });
});

describe('writeDataset', () => {
  it('成功 → 用 POST 並帶 JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, path: 'apps/player/public/assets/data/x.json' }),
    );
    const body = { schemaVersion: '1.0', instance: {}, strategies: [], questions: [], debuffLibrary: [] } as never;
    await writeDataset('x.json', body);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toContain('/api/dataset?file=x.json');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(typeof call[1]?.body).toBe('string');
  });

  it('不合法檔名 → 不發 fetch', async () => {
    const fetchSpy = vi.mocked(fetch);
    await expect(
      writeDataset('a/b.json', {} as never),
    ).rejects.toMatchObject({ reason: 'invalid-filename' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchPublishedIndex', () => {
  it('用相對路徑 ../assets/data/index.json 取得 index', async () => {
    const mockIndex = { schemaVersion: '1.0', instances: [{ id: 'm1s' }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(mockIndex));
    const result = await fetchPublishedIndex();
    expect(result).toEqual(mockIndex);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('../assets/data/index.json');
  });

  it('HTTP 404 → reason=http', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: '找不到' }, 404));
    await expect(fetchPublishedIndex()).rejects.toMatchObject({ reason: 'http' });
  });

  it('網路錯誤 → reason=network', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fail'));
    await expect(fetchPublishedIndex()).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('fetchPublishedDataset', () => {
  it('用 ../<dataPath> 取得 dataset', async () => {
    const mockData = { schemaVersion: '1.0' };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(mockData));
    const result = await fetchPublishedDataset('assets/data/m1s.json');
    expect(result).toEqual(mockData);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('../assets/data/m1s.json');
  });

  it('HTTP 500 → reason=http', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: '伺服器錯誤' }, 500));
    await expect(fetchPublishedDataset('assets/data/m1s.json')).rejects.toMatchObject({
      reason: 'http',
    });
  });
});

describe('uploadArenaImage', () => {
  /**
   * 在 node 環境下 File 不存在，用最小相容物件模擬：
   *   - .arrayBuffer() 回傳 ArrayBuffer
   *   - .type 對應 MIME
   */
  function makeFakeFile(type: string, bytes = new Uint8Array([1, 2, 3, 4])): File {
    return {
      type,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as unknown as File;
  }

  it('成功上傳 → 回傳 server 提供的 path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, path: 'assets/arenas/abc.png' }));
    const result = await uploadArenaImage(makeFakeFile('image/png'));
    expect(result.path).toBe('assets/arenas/abc.png');
  });

  it('用 POST 並帶 Content-Type 與 binary body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, path: 'x' }));
    await uploadArenaImage(makeFakeFile('image/webp'));

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('/api/upload-arena-image');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toMatchObject({ 'Content-Type': 'image/webp' });
    // body 為 ArrayBuffer
    expect(call[1]?.body).toBeInstanceOf(ArrayBuffer);
  });

  it('未提供 file.type → fallback 到 application/octet-stream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, path: 'x' }));
    await uploadArenaImage(makeFakeFile(''));
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[1]?.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' });
  });

  it('HTTP 錯誤 → DatasetApiError reason=http', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: '太大了' }, 413));
    try {
      await uploadArenaImage(makeFakeFile('image/png'));
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetApiError);
      expect((err as DatasetApiError).reason).toBe('http');
      expect((err as DatasetApiError).message).toContain('太大了');
    }
  });
});
