import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_TO_EXT,
  MAX_UPLOAD_BYTES,
  generateSafeFilename,
  mimeFromExt,
  validateUpload,
} from './imageUploadHelpers';

describe('validateUpload', () => {
  it('合法 PNG → ok + ext=png', () => {
    const result = validateUpload('image/png', 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ext).toBe('png');
  });

  it('image/jpeg → ext=jpg（不是 jpeg）', () => {
    const result = validateUpload('image/jpeg', 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ext).toBe('jpg');
  });

  it('支援 webp / gif', () => {
    expect(validateUpload('image/webp', 100).ok).toBe(true);
    expect(validateUpload('image/gif', 100).ok).toBe(true);
  });

  it('Content-Type 含 charset 等附加參數仍可解析', () => {
    const result = validateUpload('image/png; charset=binary', 100);
    expect(result.ok).toBe(true);
  });

  it('不支援的 MIME → reason=unsupported-mime', () => {
    const result = validateUpload('application/pdf', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-mime');
  });

  it('未提供 MIME → reason=unsupported-mime', () => {
    const result = validateUpload(undefined, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-mime');
  });

  it('空 body → reason=empty', () => {
    const result = validateUpload('image/png', 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('超過大小上限 → reason=too-large', () => {
    const result = validateUpload('image/png', MAX_UPLOAD_BYTES + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });

  it('大小剛好 = 上限 → 仍合法（≤ 而非 <）', () => {
    const result = validateUpload('image/png', MAX_UPLOAD_BYTES);
    expect(result.ok).toBe(true);
  });
});

describe('generateSafeFilename', () => {
  it('產生 32 字元 hex + 副檔名格式', () => {
    const name = generateSafeFilename('png');
    expect(name).toMatch(/^[a-f0-9]{32}\.png$/);
  });

  it('副檔名直接套用（不限定白名單，由 validateUpload 把關）', () => {
    expect(generateSafeFilename('webp')).toMatch(/\.webp$/);
  });

  it('用注入的 rng 確保可重現', () => {
    const fakeRng = (size: number) => Buffer.alloc(size, 0xab);
    const name = generateSafeFilename('jpg', fakeRng);
    expect(name).toBe('abababababababababababababababab.jpg');
  });

  it('連續呼叫 32 次都不重複（簡單碰撞抽樣）', () => {
    const set = new Set<string>();
    for (let i = 0; i < 32; i++) set.add(generateSafeFilename('png'));
    expect(set.size).toBe(32);
  });
});

describe('ALLOWED_MIME_TO_EXT 表', () => {
  it('涵蓋常見的 4 種圖片 MIME', () => {
    expect(Object.keys(ALLOWED_MIME_TO_EXT).sort()).toEqual([
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});

describe('mimeFromExt', () => {
  it('常見副檔名正確映射', () => {
    expect(mimeFromExt('png')).toBe('image/png');
    expect(mimeFromExt('jpg')).toBe('image/jpeg');
    expect(mimeFromExt('jpeg')).toBe('image/jpeg');
    expect(mimeFromExt('webp')).toBe('image/webp');
    expect(mimeFromExt('gif')).toBe('image/gif');
  });

  it('大小寫不敏感', () => {
    expect(mimeFromExt('PNG')).toBe('image/png');
    expect(mimeFromExt('Jpg')).toBe('image/jpeg');
  });

  it('不支援的副檔名 → null（防止代理任意檔案）', () => {
    expect(mimeFromExt('exe')).toBeNull();
    expect(mimeFromExt('js')).toBeNull();
    expect(mimeFromExt('')).toBeNull();
    expect(mimeFromExt('html')).toBeNull();
  });
});
