/** URL 校验与处理：只接受经过登记的资源域名。 */

/** P0 实测得到的评论图片 CDN；其他域名需要用户另外授权。 */
export const KNOWN_IMAGE_HOSTS = ['sns-webpic-qc.xhscdn.com', 'sns-avatar-qc.xhscdn.com'];

export const NOTE_URL_RE = /^https:\/\/(www\.)?xiaohongshu\.com\/(explore|discovery\/item)\/([0-9a-f]{24})/;

export function isNoteUrl(url: string): boolean {
  return NOTE_URL_RE.test(url);
}

/** 从笔记 URL 提取 noteId；解析失败返回 null。 */
export function parseNoteId(url: string): string | null {
  const m = NOTE_URL_RE.exec(url);
  return m?.[3] ?? null;
}

/** 域名匹配：支持精确域名与 `*.example.com` 通配。 */
export function isAllowedHost(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some((h) => (h.startsWith('*.') ? hostname.endsWith(h.slice(1)) : hostname === h));
}

/** 规范化图片资源 URL；仅允许 https 与允许的 CDN 域名。 */
export function validateResourceUrl(raw: string, allowedHosts: readonly string[]): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!u.pathname.startsWith('/')) return null;
  return isAllowedHost(u.hostname, allowedHosts) ? u : null;
}

/** 用于候选层去重的规范化键：保留全部查询参数，只去掉 hash。 */
export function resourceDedupeKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.href;
  } catch {
    return raw;
  }
}
