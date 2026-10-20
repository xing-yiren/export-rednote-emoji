// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { COMMENT_PAGE_HTML } from '../fixtures/comment-page';
import { extractCommentImages, findCommentRoot, resolveAuthor, scanDocument } from '@/content/adapter';

const isAllowed = (u: string) => /^https:\/\/sns-webpic-qc\.xhscdn\.com\//.test(u);

beforeEach(() => {
  document.body.innerHTML = COMMENT_PAGE_HTML;
});

describe('评论适配器', () => {
  it('定位评论容器', () => {
    const root = findCommentRoot(document);
    expect(root?.classList.contains('note-scroller')).toBe(true);
  });

  it('只采集评论区图片，排除头像与笔记主图', () => {
    const imgs = scanDocument(document, isAllowed);
    expect(imgs.map((i) => i.url)).toEqual([
      'https://sns-webpic-qc.xhscdn.com/202601010000/hashA/comment/imgA!nc_n_webp_mw_1',
      'https://sns-webpic-qc.xhscdn.com/202601010000/hashB/comment/imgB!nc_n_webp_mw_1',
      'https://sns-webpic-qc.xhscdn.com/202601010000/hashC/comment/imgC!nc_n_webp_mw_1',
    ]);
    expect(imgs.some((i) => i.url.includes('avatar'))).toBe(false);
    expect(imgs.some((i) => i.url.includes('noteimg'))).toBe(false);
  });

  it('过滤非 https、非白名单和 data URL', () => {
    const imgs = scanDocument(document, isAllowed);
    expect(imgs.some((i) => i.url.includes('evil.example.com'))).toBe(false);
    expect(imgs.some((i) => i.url.startsWith('data:'))).toBe(false);
  });

  it('http URL 被规范化为 https', () => {
    const imgs = scanDocument(document, isAllowed);
    expect(imgs.find((i) => i.url.includes('imgB'))?.url.startsWith('https:')).toBe(true);
  });

  it('绑定评论 ID 与稳定作者 ID', () => {
    const imgs = scanDocument(document, isAllowed);
    expect(imgs[0]?.sources[0]).toMatchObject({ commentId: 'cmtA', authorId: 'alice-id', authorName: 'Alice' });
    expect(imgs[1]?.sources[0]).toMatchObject({ commentId: 'cmtA', authorId: 'alice-id' });
  });

  it('无 id 的评论项仍可采集，评论 ID 为空', () => {
    const imgs = scanDocument(document, isAllowed);
    const c = imgs.find((i) => i.url.includes('imgC'))!;
    expect(c.sources[0]?.commentId).toBeUndefined();
    expect(c.sources[0]?.authorId).toBe('noctext-id');
  });

  it('作者 ID 缺失时从 profile 链接兜底', () => {
    const item = document.getElementById('comment-cmtA')!;
    item.querySelector('img.avatar-item')!.removeAttribute('data-user-id');
    expect(resolveAuthor(item).authorId).toBe('alice');
  });

  it('笔记详情之外的 comment-item（如推荐流）不被采集', () => {
    const imgs = scanDocument(document, isAllowed);
    expect(imgs.some((i) => i.url.includes('outside!'))).toBe(false);
  });

  it('无评论时返回空数组', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(scanDocument(document, isAllowed)).toEqual([]);
    expect(findCommentRoot(document)).toBeNull();
  });

  it('评论图片节点懒加载 data-src 也被识别', () => {
    document.body.innerHTML = `<div class="comment-item" id="comment-x"><div class="comment-picture"><img class="inner" data-src="https://sns-webpic-qc.xhscdn.com/a/comment/lazy!nc_n_webp_mw_1"></div></div>`;
    const imgs = extractCommentImages(document.querySelector('.comment-item')!, isAllowed);
    expect(imgs[0]?.url).toContain('lazy');
  });
});
