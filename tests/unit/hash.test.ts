import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '@/shared/hash';

describe('sha256Hex', () => {
  it('与标准实现一致（Uint8Array / Blob）', async () => {
    if (!globalThis.crypto?.subtle) {
      const { webcrypto } = await import('node:crypto');
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    }
    const data = new Uint8Array([1, 2, 3, 4, 255]);
    const expected = createHash('sha256').update(data).digest('hex');
    expect(await sha256Hex(data)).toBe(expected);
    expect(await sha256Hex(new Blob([data]))).toBe(expected);
  });
  it('不同字节得到不同摘要', async () => {
    const a = await sha256Hex(new Uint8Array([1]));
    const b = await sha256Hex(new Uint8Array([2]));
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });
});
