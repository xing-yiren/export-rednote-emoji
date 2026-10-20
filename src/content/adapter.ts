/**
 * 小红书评论区适配器。
 * 选择器来自 P0 实测（docs/VALIDATION.md），集中维护在此，便于站点改版时修复。
 */
import type { ScanSource, ScannedImage } from '../shared/types';

export interface AdapterOptions {
  /** 允许的资源域名（不含通配符实现在 url.ts） */
  isAllowedImageUrl: (url: string) => boolean;
}

const SEL = {
  commentItem: '.comment-item',
  commentAvatar: '.avatar',
  commentPicture: '.comment-picture',
  pictureImg: 'img.inner',
  commentText: '.content, .note-text, .comment-content, .desc',
  noteAuthor: '#noteContainer .author, .note-container .author',
  noteRoot: '#noteContainer, .note-container',
} as const;

/** 找到评论列表的宿主容器（优先详情页，其次任意出现评论项的容器）。 */
export function findCommentRoot(doc: Document = document): Element | null {
  // 顶部评论列表容器优先；不存在时退化为最浅层的评论项父节点（避免落入嵌套回复）
  const list = doc.querySelector('.note-scroller .comment-list, .comment-list, #comment-root');
  if (list) return list;
  const items = [...doc.querySelectorAll(SEL.commentItem)];
  if (items.length === 0) return null;
  let best: Element | null = null;
  for (const item of items) {
    const depth = depthOf(item);
    if (!best || depth < depthOf(best)) best = item;
  }
  return best?.parentElement ?? null;
}

function depthOf(el: Element): number {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
}

/** 从头像节点或评论项解析稳定作者 ID。 */
export function resolveAuthor(item: Element): ScanSource {
  const avatarImg = item.querySelector(`${SEL.commentAvatar} img`);
  const profileLink = item.querySelector(`${SEL.commentAvatar} a[href*="/user/profile/"]`);
  const href = profileLink?.getAttribute('href') ?? '';
  const fromHref = /\/user\/profile\/([0-9a-zA-Z]+)/.exec(href)?.[1];
  const authorId = avatarImg?.getAttribute('data-user-id') ?? fromHref ?? undefined;
  const nameEl = item.querySelector('.author .name, .name');
  const authorName = nameEl?.textContent?.trim() || undefined;
  return { authorId, authorName };
}

export function resolveCommentId(item: Element): string | undefined {
  const id = item.id || '';
  const m = /^comment-([0-9a-zA-Z]+)$/.exec(id);
  return m?.[1];
}

/** 从评论项提取正文图片；限定在 .comment-picture 作用域内，绝不返回头像。 */
export function extractCommentImages(item: Element, isAllowed: AdapterOptions['isAllowedImageUrl']): ScannedImage[] {
  const out: ScannedImage[] = [];
  const source: ScanSource = { commentId: resolveCommentId(item), ...resolveAuthor(item) };
  for (const pic of item.querySelectorAll(SEL.commentPicture)) {
    const img = pic.querySelector(SEL.pictureImg) as HTMLImageElement | null;
    if (!img) continue;
    const candidates = [img.currentSrc, img.src, img.getAttribute('data-src') ?? '']
      .map((s) => normalizeUrl(s))
      .filter((s): s is string => !!s && isAllowed(s));
    if (candidates.length === 0) continue;
    // 同一元素可能给出多个地址；此处保留浏览器实际使用的地址作为首选，其余作为备用
    out.push({ url: candidates[0]!, sources: [source], alternates: candidates.slice(1) } as ScannedImage);
  }
  return out;
}

function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, (globalThis as { location?: Location }).location?.href ?? 'https://www.xiaohongshu.com/');
    // P0 实测：页面 attr 常为 http，浏览器实际以 https 加载；仅对 http 升级
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** 扫描整个文档（一次），返回已渲染的评论图片。 */
export function scanDocument(doc: Document, isAllowed: AdapterOptions['isAllowedImageUrl']): ScannedImage[] {
  const items = doc.querySelectorAll(SEL.commentItem);
  const out: ScannedImage[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const img of extractCommentImages(item, isAllowed)) {
      const key = img.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(img);
    }
  }
  return out;
}

/** 判断是否为笔记详情页（存在 note 根或 URL 可解析）。 */
export function hasNoteRoot(doc: Document = document): boolean {
  return !!doc.querySelector(SEL.noteRoot);
}

export const SELECTORS = SEL;
