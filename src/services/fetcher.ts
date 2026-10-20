/**
 * 资源获取：带并发限制、超时/限额、重试策略与取消。
 * 只 fetch 已登记候选的 URL；调用方负责保证 URL 已校验。
 */
import { sniffImage } from '../shared/format';
import { sha256Hex } from '../shared/hash';
import type { Asset } from '../shared/types';

export const LIMITS = {
  maxCandidatesPerSession: 500,
  maxFileBytes: 20 * 1024 * 1024,
  maxZipRawBytes: 100 * 1024 * 1024,
  maxZipItems: 200,
  concurrency: 3,
  maxAutoRetries: 2,
  requestTimeoutMs: 30_000,
};

export class FetchError extends Error {
  constructor(
    public code: 'http' | 'network' | 'timeout' | 'too_large' | 'empty' | 'not_image' | 'permission' | 'cancelled',
    message: string,
    public status?: number,
    /** 建议重试 */
    public retriable = false,
  ) {
    super(message);
  }
}

export interface FetchOutcome {
  asset: Asset;
  /** 实际请求的 URL（用于记录重定向） */
  finalUrl: string;
}

export async function fetchAsset(url: string, signal: AbortSignal): Promise<FetchOutcome> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('timeout')), LIMITS.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new FetchError('http', `HTTP ${res.status}`, res.status, res.status === 429 || res.status >= 500);
    }
    const lengthHeader = Number(res.headers.get('content-length') ?? 0);
    if (lengthHeader > LIMITS.maxFileBytes) throw new FetchError('too_large', '文件超过单文件上限', undefined, false);
    const reader = res.body?.getReader();
    let bytes: Uint8Array;
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > LIMITS.maxFileBytes) {
          await reader.cancel().catch(() => {});
          throw new FetchError('too_large', '文件超过单文件上限');
        }
        chunks.push(value);
      }
      bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > LIMITS.maxFileBytes) throw new FetchError('too_large', '文件超过单文件上限');
    }
    if (bytes.byteLength === 0) throw new FetchError('empty', '响应为空', undefined, true);
    const sniff = sniffImage(bytes);
    if (sniff.format === 'unknown') {
      const reason = sniff.detail?.reason === 'html' ? '服务器返回了网页而非图片（可能链接过期或需登录）' : '无法识别文件格式';
      throw new FetchError('not_image', reason, res.status, false);
    }
    const sha256 = await sha256Hex(bytes);
    const contentType = res.headers.get('content-type') ?? undefined;
    const blob = new Blob([bytes as BlobPart], { type: contentType || `image/${sniff.format}` });
    return {
      asset: {
        sha256,
        blob,
        format: sniff.format,
        animated: sniff.animated,
        width: sniff.width || undefined,
        height: sniff.height || undefined,
        byteLength: bytes.byteLength,
        contentType,
        fetchedAt: new Date().toISOString(),
      },
      finalUrl: res.url || url,
    };
  } catch (e) {
    if (e instanceof FetchError) throw e;
    if (signal.aborted) throw new FetchError('cancelled', '已取消');
    if (controller.signal.aborted) throw new FetchError('timeout', '请求超时', undefined, true);
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|permission/i.test(msg)) {
      throw new FetchError('network', msg, undefined, true);
    }
    throw new FetchError('network', msg, undefined, true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** 根据 Retry-After 计算等待毫秒数。 */
export function retryDelay(attempt: number, retryAfterHeader?: string | null): number {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 60_000);
  return Math.min(500 * 2 ** attempt, 8000);
}
