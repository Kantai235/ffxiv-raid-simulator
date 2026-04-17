import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

/**
 * clipboard 測試 - 三層 fallback 鏈：
 *   1. navigator.clipboard.writeText
 *   2. document.execCommand('copy')
 *   3. 都失敗 → 回 false
 */

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalExec = document.execCommand;

  afterEach(() => {
    // 還原 navigator.clipboard
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
    document.execCommand = originalExec;
    vi.restoreAllMocks();
  });

  it('navigator.clipboard 可用 → 走第一層並回 true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard('hello');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('navigator.clipboard.writeText 拋例外 → fallback 到 execCommand', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true);

    const result = await copyToClipboard('hello');
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('navigator.clipboard 不存在 → 直接走 execCommand', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true);

    const result = await copyToClipboard('hello');
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('兩層都失敗 → 回 false（不拋）', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false);

    const result = await copyToClipboard('hello');
    expect(result).toBe(false);
  });

  it('execCommand 拋例外 → 回 false（不拋）', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('not allowed');
    });

    const result = await copyToClipboard('hello');
    expect(result).toBe(false);
  });
});
