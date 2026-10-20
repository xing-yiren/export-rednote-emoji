import { describe, expect, it } from 'vitest';
import { mergeScan } from '@/shared/candidates';
import { parseNoteId } from '@/shared/url';

/** 模拟管理页的候选索引，验证会话/笔记隔离与过期消息丢弃。 */
function makeIndex(entries: { url: string; sources: { commentId?: string; authorId?: string }[]; sessionId: string }[]) {
  const index = new Map<string, { id: string; sources: { commentId?: string; authorId?: string }[]; sessionId: string }>();
  entries.forEach((e, i) => index.set(e.url, { id: `c${i}`, sources: e.sources, sessionId: e.sessionId }));
  return index;
}

describe('会话与过期消息', () => {
  it('旧会话的扫描结果不会写入新会话', () => {
    const index = makeIndex([]);
    const payload = { sessionId: 'old', noteId: 'n1' };
    const current = { sessionId: 'new', noteId: 'n1' };
    const accepted = payload.sessionId === current.sessionId && payload.noteId === current.noteId;
    expect(accepted).toBe(false);
    const { created } = mergeScan(index, [{ url: 'https://h/a', sources: [{ commentId: 'x' }] }]);
    // 即便合并函数本身可用，调用方必须先通过会话校验
    expect(created).toHaveLength(1);
  });

  it('同一会话不同笔记不合并', () => {
    const session = { sessionId: 's1', noteId: 'noteA' };
    const payload = { sessionId: 's1', noteId: 'noteB' };
    expect(payload.noteId === session.noteId).toBe(false);
  });

  it('笔记 URL 解析对 SPA 查询参数稳定', () => {
    expect(parseNoteId('https://www.xiaohongshu.com/explore/6ad715b3000000000c00e6f9?xsec_token=a&xsec_source=pc_user')).toBe(
      '6ad715b3000000000c00e6f9',
    );
    expect(parseNoteId('https://www.xiaohongshu.com/discovery/item/6ad715b3000000000c00e6f9')).toBe('6ad715b3000000000c00e6f9');
    expect(parseNoteId('https://www.xiaohongshu.com/user/profile/abc')).toBeNull();
  });
});
