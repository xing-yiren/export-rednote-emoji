/**
 * 小红书评论区适配器。
 * 选择器来自 P0 实测（docs/VALIDATION.md），集中维护在此，便于站点改版时修复。
 */
import type { ScanSource, ScannedImage } from '../shared/types';

const SEL = {
  commentItem: '.comment-item',
  commentAvatar: '.avatar',
  commentPicture: '.comment-picture',
  pictureImg: 'img.inner',
  authorName: '.author .name, .name',
  noteRoot: '#noteContainer, .note-container',
  commentRoot: '.interaction-container .note-scroller, .note-scroller',
} as const;

export type AllowedUrl = (url: string) => boolean;

function depthOf(el: Element): number {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
}

/**
 * 评论列表宿主容器。
 * 必须在笔记详情容器内查找，避免抓到用户主页 feed 等页面其他区域。
 */
export function findCommentRoot(doc: Document = document): Element | null {
  const scopes = doc.querySelectorAll(SEL.noteRoot);
  let best: Element | null = null;
  let bestDepth = Infinity;
  for (const scope of scopes) {
    for (const candidate of scope.querySelectorAll(SEL.commentRoot)) {
      const d = depthOf(candidate);
      if (d < bestDepth) {
        best = candidate;
        bestDepth = d;
      }
    }
  }
  if (best) return best;
  // 找不到详情容器时：退化为最浅层的评论项父节点（仍限定在文档内）
  const items = [...doc.querySelectorAll(SEL.commentItem)];
  for (const item of items) {
    const d = depthOf(item);
    if (d < bestDepth) {
      best = item;
      bestDepth = d;
    }
  }
  return best?.parentElement ?? null;
}

/** 从头像节点或评论项的 profile 链接解析稳定作者 ID。 */
export function resolveAuthor(item: Element): ScanSource {
  const avatarImg = item.querySelector(`${SEL.commentAvatar} img`);
  const profileLink = item.querySelector(`${SEL.commentAvatar} a[href*="/user/profile/"]`);
  const href = profileLink?.getAttribute('href') ?? '';
  const fromHref = /\/user\/profile\/([0-9a-zA-Z]+)/.exec(href)?.[1];
  const authorId = avatarImg?.getAttribute('data-user-id') ?? fromHref ?? undefined;
  const nameEl = item.querySelector(SEL.authorName);
  const authorName = nameEl?.textContent?.trim() || undefined;
  return { authorId, authorName };
}

export function resolveCommentId(item: Element): string | undefined {
  const m = /^comment-([0-9a-zA-Z]+)$/.exec(item.id || '');
  return m?.[1];
}

function normalizeUrl(raw: string, base: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    // P0 实测：页面 attr 常为 http，浏览器实际以 https 加载；仅对 http 升级
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

export interface ExtractDiagnostics {
  /** 被排除的图片域名（用于提示站点 CDN 变更或需额外授权） */
  skippedHosts: Set<string>;
  /** 评论图片节点总数 */
  pictureNodes: number;
}

/** 从评论项提取正文图片；限定在 .comment-picture 作用域内，绝不返回头像。 */
export function extractCommentImages(
  item: Element,
  isAllowed: AllowedUrl,
  base = location.href,
  diagnostics?: ExtractDiagnostics,
): ScannedImage[] {
  const out: ScannedImage[] = [];
  const source: ScanSource = { commentId: resolveCommentId(item), ...resolveAuthor(item) };
  for (const pic of item.querySelectorAll(SEL.commentPicture)) {
    const img = pic.querySelector(SEL.pictureImg) as HTMLImageElement | null;
    if (!img) continue;
    if (diagnostics) diagnostics.pictureNodes++;
    const normalized = [img.currentSrc, img.getAttribute('src') ?? '', img.getAttribute('data-src') ?? '']
      .map((s) => normalizeUrl(s, base))
      .filter((s): s is string => !!s);
    const candidates = normalized.filter((s) => isAllowed(s));
    if (candidates.length === 0) {
      if (diagnostics) {
        for (const raw of [img.currentSrc, img.getAttribute('src') ?? '']) {
          try {
            const h = new URL(raw, base).hostname;
            if (h) diagnostics.skippedHosts.add(h);
          } catch {
            /* 忽略无法解析的地址 */
          }
        }
      }
      continue;
    }
    const [nw, nh] = [img.naturalWidth, img.naturalHeight];
    out.push({
      url: candidates[0]!,
      sources: [source],
      alternates: [...new Set(candidates.slice(1))],
      naturalSize: nw && nh ? [nw, nh] : undefined,
    });
  }
  return out;
}

/** 扫描评论容器（一次），返回已渲染的评论图片。 */
export function scanComments(root: ParentNode, isAllowed: AllowedUrl, base = location.href): ScannedImage[] {
  const out: ScannedImage[] = [];
  const seen = new Set<string>();
  for (const item of root.querySelectorAll(SEL.commentItem)) {
    for (const img of extractCommentImages(item, isAllowed, base)) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      out.push(img);
    }
  }
  return out;
}

/** 整页扫描（测试与首次扫描用）：只取评论容器内的图片。 */
export function scanDocument(doc: Document, isAllowed: AllowedUrl, base?: string): ScannedImage[] {
  const root = findCommentRoot(doc);
  return root ? scanComments(root, isAllowed, base ?? doc.baseURI) : [];
}

export function hasNoteRoot(doc: Document = document): boolean {
  return !!doc.querySelector(SEL.noteRoot);
}

export const SELECTORS = SEL;
