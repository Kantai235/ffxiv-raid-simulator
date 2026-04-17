import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetLoadError, fetchIndex, fetchInstanceData } from './dataset';

/**
 * ========================================================================
 * Dataset 服務測試
 * ========================================================================
 * 用 vi.stubGlobal('fetch', ...) 替換全域 fetch，模擬各種失敗情境。
 *
 * 涵蓋路徑：
 *   - 成功路徑：fetchIndex / fetchInstanceData 回傳正確物件
 *   - 失敗路徑：network / http / parse / schema-version 四類錯誤
 * ========================================================================
 */

/** 建立 Response stub - 預設成功 200 + JSON body */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** 模擬 JSON 解析失敗的 Response */
function brokenJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchIndex', () => {
  it('成功時回傳 DatasetIndex', async () => {
    const mockIndex = {
      schemaVersion: '1.0',
      instances: [
        {
          id: 'm1s',
          name: 'M1S',
          shortName: 'M1S',
          dataPath: 'assets/data/m1s.json',
          schemaVersion: '1.0',
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(mockIndex));

    const result = await fetchIndex();
    expect(result).toEqual(mockIndex);
  });

  it('網路錯誤 → 拋出 DatasetLoadError reason=network', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchIndex()).rejects.toMatchObject({
      name: 'DatasetLoadError',
      reason: 'network',
    });
  });

  it('HTTP 404 → 拋出 reason=http 並含狀態碼', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 404));

    try {
      await fetchIndex();
      expect.fail('應拋出錯誤');
    } catch (err) {
      expect(err).toBeInstanceOf(DatasetLoadError);
      expect((err as DatasetLoadError).reason).toBe('http');
      expect((err as DatasetLoadError).message).toContain('404');
    }
  });

  it('JSON 解析失敗 → 拋出 reason=parse', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(brokenJsonResponse());

    await expect(fetchIndex()).rejects.toMatchObject({
      reason: 'parse',
    });
  });

  it('schema major 版本過舊 → 拋出 reason=schema-version', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ schemaVersion: '0.5', instances: [] }),
    );

    await expect(fetchIndex()).rejects.toMatchObject({
      reason: 'schema-version',
    });
  });

  it('schema 版本字串非數字（如 "abc"）→ 拋 schema-version', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ schemaVersion: 'abc', instances: [] }),
    );

    await expect(fetchIndex()).rejects.toMatchObject({
      reason: 'schema-version',
    });
  });
});

describe('fetchInstanceData', () => {
  const validEntry = { dataPath: 'assets/data/m1s.json', schemaVersion: '1.0' };

  it('成功時回傳 InstanceDataset', async () => {
    const mockData = {
      schemaVersion: '1.0',
      instance: { id: 'm1s', name: 'M1S' },
      strategies: [],
      questions: [],
      debuffLibrary: [],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(mockData));

    const result = await fetchInstanceData(validEntry);
    expect(result).toEqual(mockData);
  });

  it('index 宣告版本不相容 → 不應發出 fetch（預檢擋下）', async () => {
    const mockFetch = vi.mocked(fetch);

    await expect(
      fetchInstanceData({ dataPath: 'assets/data/old.json', schemaVersion: '0.1' }),
    ).rejects.toMatchObject({ reason: 'schema-version' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('index 宣告 1.x 但實際檔案 schemaVersion 是 0.x → 拋 schema-version', async () => {
    // index 寫對版本 1.0 → 預檢通過 → 發出 fetch
    // 但檔案內容版本錯亂 0.5 → 二次檢查擋下
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ schemaVersion: '0.5', instance: {}, strategies: [], questions: [], debuffLibrary: [] }),
    );

    await expect(fetchInstanceData(validEntry)).rejects.toMatchObject({
      reason: 'schema-version',
    });
  });

  it('HTTP 404 → reason=http', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(fetchInstanceData(validEntry)).rejects.toMatchObject({
      reason: 'http',
    });
  });
});
