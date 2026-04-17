import { describe, expect, it } from 'vitest';
import {
  SHARE_PAYLOAD_VERSION,
  ShareScorecardError,
  buildShareUrl,
  decodeScorecard,
  encodeScorecard,
} from './share';

/**
 * share.ts 測試 - 覆蓋：
 *   1. 編/解碼來回（含中文）
 *   2. Base64URL 字元集（無 + / =）
 *   3. 各種損毀情境（亂碼、缺欄位、版本過新、過大、數值不合理）
 *   4. buildShareUrl 含 hash router 格式
 */

function makeResult(overrides: Partial<Parameters<typeof encodeScorecard>[0]> = {}) {
  return {
    roleId: 'MT' as const,
    correctCount: 8,
    totalCount: 10,
    finishedAt: 1700000000000,
    ...overrides,
  };
}

describe('encodeScorecard', () => {
  it('編碼成功 → 回傳 Base64URL 字串', () => {
    const encoded = encodeScorecard(makeResult(), 'M1S', 'Game8');
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('輸出不含 Base64URL 禁用字元（+ / =）', () => {
    const encoded = encodeScorecard(makeResult(), 'M1S', 'Game8');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('相同輸入 → 相同輸出（純函數）', () => {
    const a = encodeScorecard(makeResult(), 'M1S', 'Game8');
    const b = encodeScorecard(makeResult(), 'M1S', 'Game8');
    expect(a).toBe(b);
  });
});

describe('decodeScorecard', () => {
  it('encode → decode 來回還原', () => {
    const encoded = encodeScorecard(makeResult(), 'M1S', 'Game8');
    const decoded = decodeScorecard(encoded);
    expect(decoded.v).toBe(SHARE_PAYLOAD_VERSION);
    expect(decoded.i).toBe('M1S');
    expect(decoded.s).toBe('Game8');
    expect(decoded.r).toBe('MT');
    expect(decoded.c).toBe(8);
    expect(decoded.t).toBe(10);
    expect(decoded.d).toBe(1700000000000);
  });

  it('中文字元正確往返（不會亂碼）', () => {
    const encoded = encodeScorecard(
      makeResult(),
      '阿卡迪亞零式輕量級 M1S',
      'Game8 攻略（蘇帕醬版本）',
    );
    const decoded = decodeScorecard(encoded);
    expect(decoded.i).toBe('阿卡迪亞零式輕量級 M1S');
    expect(decoded.s).toBe('Game8 攻略（蘇帕醬版本）');
  });

  it('emoji 正確往返', () => {
    const encoded = encodeScorecard(makeResult(), 'M1S 🎮', 'Game8 ⚔️');
    const decoded = decodeScorecard(encoded);
    expect(decoded.i).toBe('M1S 🎮');
    expect(decoded.s).toBe('Game8 ⚔️');
  });

  it('極端長中文字串也能往返', () => {
    const long = '阿'.repeat(200);
    const encoded = encodeScorecard(makeResult(), long, 'x');
    const decoded = decodeScorecard(encoded);
    expect(decoded.i).toBe(long);
  });

  it('空字串 → invalid', () => {
    expect(() => decodeScorecard('')).toThrow(ShareScorecardError);
    try {
      decodeScorecard('');
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('invalid');
    }
  });

  it('過長字串 → too-large（防惡意塞 URL）', () => {
    const bigString = 'A'.repeat(5000);
    try {
      decodeScorecard(bigString);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('too-large');
    }
  });

  it('亂碼字串 → decode 錯誤', () => {
    try {
      // 非 base64 的字元（Chinese）且通過長度檢查
      decodeScorecard('這不是_base64');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareScorecardError);
    }
  });

  it('合法 base64 但非 JSON → decode 錯誤', () => {
    // 'not json' 的 base64 - 過 base64 解析但不是合法 JSON
    const notJsonBase64 = 'bm90IGpzb24';
    try {
      decodeScorecard(notJsonBase64);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('decode');
    }
  });

  it('合法 JSON 但非物件 → invalid', () => {
    // '42' 的 base64
    const encoded = encodeNumberAsJson(42);
    try {
      decodeScorecard(encoded);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('invalid');
    }
  });

  it('缺少版本欄位 → invalid', () => {
    const encoded = encodeRawObject({ i: 'x', s: 'y', r: 'MT', c: 1, t: 1, d: 0 });
    try {
      decodeScorecard(encoded);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('invalid');
    }
  });

  it('版本過新（未來版本） → version 錯誤', () => {
    const encoded = encodeRawObject({
      v: 999,
      i: 'x',
      s: 'y',
      r: 'MT',
      c: 1,
      t: 1,
      d: 0,
    });
    try {
      decodeScorecard(encoded);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('version');
      expect((err as ShareScorecardError).message).toContain('999');
    }
  });

  it('缺必要欄位（無 roleId） → invalid', () => {
    const encoded = encodeRawObject({ v: 1, i: 'x', s: 'y', c: 1, t: 1, d: 0 });
    try {
      decodeScorecard(encoded);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('invalid');
    }
  });

  it('數值不合理（correctCount > totalCount） → invalid', () => {
    const encoded = encodeRawObject({ v: 1, i: 'x', s: 'y', r: 'MT', c: 10, t: 5, d: 0 });
    try {
      decodeScorecard(encoded);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('invalid');
    }
  });

  it('totalCount = 0 → invalid（避免除零）', () => {
    const encoded = encodeRawObject({ v: 1, i: 'x', s: 'y', r: 'MT', c: 0, t: 0, d: 0 });
    try {
      decodeScorecard(encoded);
      expect.fail();
    } catch (err) {
      expect((err as ShareScorecardError).reason).toBe('invalid');
    }
  });
});

describe('buildShareUrl', () => {
  it('生成符合 hash router 格式的完整 URL', () => {
    // jsdom 的 location 預設為 http://localhost/
    const url = buildShareUrl('ABC_-123');
    expect(url).toContain('#/scorecard?data=ABC_-123');
    expect(url).toMatch(/^https?:\/\//);
  });
});

// ----------------------------------------------------------------------
// 輔助：以「非正規 payload」直接 base64url 編碼，繞過 encodeScorecard 的型別檢查
// 僅用於測試 decode 遭遇異常輸入的情境
// ----------------------------------------------------------------------

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeNumberAsJson(n: number): string {
  return toBase64Url(JSON.stringify(n));
}

function encodeRawObject(obj: Record<string, unknown>): string {
  return toBase64Url(JSON.stringify(obj));
}
