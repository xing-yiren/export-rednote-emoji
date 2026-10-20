import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchError, fetchAsset } from '@/services/fetcher';

function stubCrypto() {
  if (!globalThis.crypto?.subtle) {
    return import('node:crypto').then(({ webcrypto }) => {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    });
  }
  return Promise.resolve();
}

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0,
]);

function response(body: Uint8Array, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers),
    url: 'https://sns-webpic-qc.xhscdn.com/x',
    body: null,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('资源获取错误分类', () => {
  it('HTML 响应被拒绝为 not_image，不重试', async () => {
    await stubCrypto();
    vi.stubGlobal('fetch', vi.fn(async () => response(new TextEncoder().encode('<!doctype html><html>登录</html>'))));
    const err = await fetchAsset('https://sns-webpic-qc.xhscdn.com/a', new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).code).toBe('not_image');
    expect((err as FetchError).retriable).toBe(false);
    expect((err as FetchError).message).toContain('网页而非图片');
  });

  it('403 标记为 permission 且不自动重试', async () => {
    await stubCrypto();
    vi.stubGlobal('fetch', vi.fn(async () => response(new Uint8Array(), { status: 403 })));
    const err = (await fetchAsset('https://x/a', new AbortController().signal).catch((e) => e)) as FetchError;
    expect(err.code).toBe('permission');
    expect(err.retriable).toBe(false);
  });

  it('429 带 Retry-After 时提供暂停时长', async () => {
    await stubCrypto();
    vi.stubGlobal('fetch', vi.fn(async () => response(new Uint8Array(), { status: 429, headers: { 'retry-after': '7' } })));
    const err = (await fetchAsset('https://x/a', new AbortController().signal).catch((e) => e)) as FetchError;
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(7000);
  });

  it('空响应可重试', async () => {
    await stubCrypto();
    vi.stubGlobal('fetch', vi.fn(async () => response(new Uint8Array())));
    const err = (await fetchAsset('https://x/a', new AbortController().signal).catch((e) => e)) as FetchError;
    expect(err.code).toBe('empty');
    expect(err.retriable).toBe(true);
  });

  it('超过单文件上限', async () => {
    await stubCrypto();
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    vi.stubGlobal('fetch', vi.fn(async () => response(big)));
    const err = (await fetchAsset('https://x/a', new AbortController().signal).catch((e) => e)) as FetchError;
    expect(err.code).toBe('too_large');
  });

  it('正常 PNG 返回格式、尺寸与哈希', async () => {
    await stubCrypto();
    vi.stubGlobal('fetch', vi.fn(async () => response(PNG, { headers: { 'content-type': 'image/png' } })));
    const out = await fetchAsset('https://x/a', new AbortController().signal);
    expect(out.asset.format).toBe('png');
    expect(out.asset.sha256).toHaveLength(64);
    expect(out.asset.byteLength).toBe(PNG.length);
  });

  it('外部取消返回 cancelled', async () => {
    await stubCrypto();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const ac = new AbortController();
    const p = fetchAsset('https://x/a', ac.signal).catch((e) => e);
    ac.abort();
    const err = (await p) as FetchError;
    expect(err.code).toBe('cancelled');
  });
});
