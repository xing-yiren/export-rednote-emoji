import { describe, expect, it } from 'vitest';
import { isNoteUrl, parseNoteId, resourceDedupeKey, validateResourceUrl } from '@/shared/url';
import { extensionForFormat, safeZipPath, sanitizeFilename } from '@/shared/filename';
import { mergeScan, mergeSources } from '@/shared/candidates';

const HOSTS = ['sns-webpic-qc.xhscdn.com', '*.xhscdn.com'];

describe('URL 校验', () => {
  it('识别笔记 URL 并提取 noteId', () => {
    const url = 'https://www.xiaohongshu.com/explore/6ad715b3000000000c00e6f9?xsec_token=abc';
    expect(isNoteUrl(url)).toBe(true);
    expect(parseNoteId(url)).toBe('6ad715b3000000000c00e6f9');
    expect(isNoteUrl('https://www.xiaohongshu.com/user/profile/abc')).toBe(false);
  });

  it('只接受 https 与允许域名', () => {
    expect(validateResourceUrl('https://sns-webpic-qc.xhscdn.com/a/b!nc_n_webp_mw_1', HOSTS)).not.toBeNull();
    expect(validateResourceUrl('http://sns-webpic-qc.xhscdn.com/a', HOSTS)).toBeNull();
    expect(validateResourceUrl('https://evil.com/a', HOSTS)).toBeNull();
    expect(validateResourceUrl('javascript:alert(1)', HOSTS)).toBeNull();
  });

  it('去重键保留查询参数，去掉 hash', () => {
    expect(resourceDedupeKey('https://x.com/a?token=1#frag')).toBe('https://x.com/a?token=1');
    expect(resourceDedupeKey('https://x.com/a?token=1')).not.toBe(resourceDedupeKey('https://x.com/a?token=2'));
  });
});

describe('文件名清理', () => {
  it('去除路径分隔符与控制字符', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('____etc_passwd');
    expect(sanitizeFilename('../../../a.png')).not.toContain('..');
    expect(sanitizeFilename('a\u0000b/c\\d.png')).toBe('ab_c_d.png');
    expect(sanitizeFilename('a\u0000b')).not.toMatch(/[\u0000-\u001f]/);
  });
  it('保留名与空名', () => {
    expect(sanitizeFilename('CON.png')).toBe('_CON.png');
    expect(sanitizeFilename('   ')).toBe('file');
  });
  it('长名截断且保留扩展名', () => {
    const out = sanitizeFilename('表'.repeat(200) + '.webp', 40);
    expect(out.endsWith('.webp')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
  });
  it('格式扩展名与 ZIP 路径', () => {
    expect(extensionForFormat('jpeg')).toBe('jpg');
    expect(extensionForFormat('mystery')).toBe('bin');
    expect(safeZipPath('../../a/../b/c.png')).toBe('a/b/c.png');
    expect(safeZipPath('/etc/passwd')).toBe('etc/passwd');
  });
});

describe('候选去重', () => {
  it('同 URL 合并来源且去重', () => {
    const existing = new Map([['https://h/a', [{ commentId: 'c1', authorId: 'u1' }]]]);
    const { created, merged } = mergeScan(existing, [
      { url: 'https://h/a', sources: [{ commentId: 'c1', authorId: 'u1' }, { commentId: 'c2', authorId: 'u2' }] },
      { url: 'https://h/b', sources: [{ commentId: 'c3' }] },
    ]);
    expect(created.map((c) => c.url)).toEqual(['https://h/b']);
    expect(merged.get('https://h/a')?.map((s) => s.commentId)).toEqual(['c1', 'c2']);
  });
  it('同一次扫描内同 URL 合并', () => {
    const { created } = mergeScan(new Map(), [
      { url: 'https://h/a', sources: [{ commentId: 'c1' }] },
      { url: 'https://h/a', sources: [{ commentId: 'c2' }, { commentId: 'c1' }] },
    ]);
    expect(created).toHaveLength(1);
    expect(created[0]!.sources.map((s) => s.commentId)).toEqual(['c1', 'c2']);
  });
  it('mergeSources 不修改入参', () => {
    const a = [{ commentId: 'c1' }];
    mergeSources(a, [{ commentId: 'c2' }]);
    expect(a).toHaveLength(1);
  });
});
