import { useEffect, useMemo, useState } from 'react';
import { useCollection } from './useCollection';
import { useJobs } from './useJobs';
import { db } from '../services/db';
import { downloadCandidate } from '../services/download';
import { exportZip } from './exportZip';
import { LIMITS } from '../services/fetcher';
import type { Candidate } from '../shared/types';

const STATUS_LABEL: Record<Candidate['status'], string> = {
  found: '待获取',
  queued: '排队中',
  fetching: '获取中',
  ready: '已就绪',
  failed: '失败',
};

export function App() {
  const { ready, session, active, candidates, overflow, reload } = useCollection();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [authorFilter, setAuthorFilter] = useState<string>('');
  const [onlySelectedAuthor, setOnlySelectedAuthor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const onUpdated = (updates: Candidate[]) => {
    // 由 useCollection 的数据源驱动；这里仅用于本地错误展示
    for (const u of updates) if (u.status === 'failed') setError(`${u.errorCode ?? '获取失败'}`);
  };
  const { job, run, cancel } = useJobs(onUpdated);

  // 首次加载后把已选状态同步为默认全选
  useEffect(() => {
    setSelectedIds(new Set(candidates.map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) {
      for (const s of c.sources) {
        const key = s.authorId ?? s.authorName ?? 'unknown';
        map.set(key, s.authorName ?? s.authorId ?? '未知作者');
      }
    }
    return [...map.entries()];
  }, [candidates]);

  const visible = useMemo(() => {
    if (!authorFilter) return candidates;
    return candidates.filter((c) =>
      onlySelectedAuthor
        ? c.sources.every((s) => (s.authorId ?? s.authorName) === authorFilter)
        : c.sources.some((s) => (s.authorId ?? s.authorName) === authorFilter),
    );
  }, [candidates, authorFilter, onlySelectedAuthor]);

  const selected = visible.filter((c) => selectedIds.has(c.id));
  const readyCount = candidates.filter((c) => c.status === 'ready').length;
  const failedCount = candidates.filter((c) => c.status === 'failed').length;

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => {
    if (visible.every((c) => selectedIds.has(c.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const c of visible) next.delete(c.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...visible.map((c) => c.id)]));
    }
  };

  const fetchSelected = async () => {
    setError(null);
    const targets = selected.filter((c) => c.status !== 'ready');
    if (targets.length === 0) {
      setNotice('所选图片已全部就绪，可直接保存。');
      return;
    }
    await run(targets);
    await reload();
  };

  const retryFailed = async () => {
    const targets = candidates.filter((c) => c.status === 'failed');
    await run(targets);
    await reload();
  };

  const saveOne = async (c: Candidate) => {
    try {
      setBusy(c.id);
      await downloadCandidate(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveZip = async () => {
    try {
      setError(null);
      setBusy('zip');
      const res = await exportZip(candidates[0]?.sourceNoteUrl ?? session?.noteUrl ?? '', session!.id, selected);
      setNotice(`已导出 ZIP：${res.count} 张，${(res.totalBytes / 1024 / 1024).toFixed(1)} MiB${res.skipped.length ? `，跳过 ${res.skipped.length} 张` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!ready) return <div className="empty">加载中…</div>;

  if (!session) {
    return (
      <main>
        <div className="notice warn">
          <strong>还没有进行中的采集。</strong>
          <p className="muted small">
            请打开小红书笔记详情页，展开需要的评论后点击浏览器工具栏中的扩展图标开始采集；采集会自动打开本页。
          </p>
        </div>
        <button onClick={() => void chrome.runtime.sendMessage({ type: 'OPEN_MANAGER' })}>打开采集</button>
      </main>
    );
  }

  const stale = !active || active.sessionId !== session.id;
  const zipSelected = selected.filter((c) => c.status === 'ready');
  const zipTooBig = zipSelected.length > LIMITS.maxZipItems;

  return (
    <>
      <header className="bar">
        <h1>小红书表情采集</h1>
        <span className="muted small" title={session.noteUrl}>笔记 {session.noteId}</span>
        <a href={session.noteUrl} target="_blank" rel="noreferrer" className="small">来源页</a>
        <span className="small">已收集 <b>{candidates.length}</b> / {LIMITS.maxCandidatesPerSession}</span>
        <span className="small">就绪 <b>{readyCount}</b> · 失败 <b className={failedCount ? 'error' : ''}>{failedCount}</b></span>
        <label className="small">
          作者：<select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
            <option value="">全部</option>
            {authors.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        {authorFilter && (
          <label className="small"><input type="checkbox" checked={onlySelectedAuthor} onChange={(e) => setOnlySelectedAuthor(e.target.checked)} /> 仅该作者独立评论</label>
        )}
        <label className="small"><input type="checkbox" checked={visible.every((c) => selectedIds.has(c.id)) && visible.length > 0} onChange={selectAll} /> 全选</label>
        <span className="small muted">已选 {selected.length} / 显示 {visible.length}</span>
      </header>

      <main>
        {stale && (
          <div className="notice warn small">
            采集会话已停止或原标签页已关闭。已收集的图片仍可导出；如需继续采集，请回到小红书页面重新点击扩展图标。
          </div>
        )}
        {overflow && (
          <div className="notice warn small">已达到每会话 {LIMITS.maxCandidatesPerSession} 个候选上限，后续图片未收集。请分批次采集或导出后开始新会话。</div>
        )}
        {error && <div className="notice small error">{error} <button className="small" onClick={() => setError(null)}>关闭</button></div>}
        {notice && <div className="notice small">{notice} <button className="small" onClick={() => setNotice(null)}>关闭</button></div>}
        <p className="muted small">
          采集范围：仅包含本页已被渲染（滚动或展开时加载）的评论图片，不代表整帖所有评论或你的收藏库。头像与笔记主图已排除。
        </p>

        {visible.length === 0 ? (
          <div className="empty">
            暂无图片。<br />
            请回到小红书标签页滚动或展开评论；本页会在新图片出现后自动更新。
          </div>
        ) : (
          <div className="grid">
            {visible.map((c) => (
              <Card
                key={c.id}
                candidate={c}
                selected={selectedIds.has(c.id)}
                onToggle={() => toggle(c.id)}
                onSave={() => void saveOne(c)}
                busy={busy === c.id}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="floating">
        <button className="primary" disabled={job.running || selected.length === 0} onClick={() => void fetchSelected()}>
          获取所选（{selected.filter((c) => c.status !== 'ready').length}）
        </button>
        {job.running ? (
          <>
            <div className="progress"><div style={{ width: `${job.total ? ((job.done + job.failed) / job.total) * 100 : 0}%` }} /></div>
            <span className="small">{job.done + job.failed}/{job.total} 成功 {job.done} 失败 {job.failed}</span>
            <button onClick={cancel}>取消</button>
          </>
        ) : (
          <>
            <button disabled={zipSelected.length === 0 || zipTooBig || busy === 'zip'} onClick={() => void saveZip()}>
              {busy === 'zip' ? '打包中…' : `导出 ZIP（${zipSelected.length}）`}
            </button>
            {zipTooBig && <span className="small error">超过单次 {LIMITS.maxZipItems} 张，请减少选择</span>}
            {failedCount > 0 && <button onClick={() => void retryFailed()}>重试失败（{failedCount}）</button>}
          </>
        )}
      </footer>
    </>
  );
}

function Card({
  candidate,
  selected,
  onToggle,
  onSave,
  busy,
}: {
  candidate: Candidate;
  selected: boolean;
  onToggle: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [preview, setPreview] = useState<{ url: string; format: string; animated: boolean | null; size: string } | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (candidate.assetHash) {
      void db.getAsset(candidate.assetHash).then((a) => {
        if (!a || cancelled) return;
        revoked = URL.createObjectURL(a.blob);
        setPreview({
          url: revoked,
          format: a.format,
          animated: a.animated,
          size: `${a.width ?? '?'}×${a.height ?? '?'}`,
        });
      });
    }
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [candidate.assetHash]);

  const author = candidate.sources[0]?.authorName ?? candidate.sources[0]?.authorId ?? '未知作者';
  const extraSources = candidate.sources.length - 1;
  return (
    <div className={`card${selected ? ' selected' : ''}`} onClick={onToggle} role="checkbox" aria-checked={selected} tabIndex={0}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}>
      <div className="thumb">
        {preview ? <img src={preview.url} alt="" /> : <span className="muted small">未获取</span>}
      </div>
      <span className="badge">{preview ? `${preview.format}${preview.animated === true ? ' 动图' : preview.animated === null ? ' 动态未知' : ' 静态'}` : STATUS_LABEL[candidate.status]}</span>
      {candidate.status === 'ready' && (
        <button className="todl" disabled={busy} onClick={(e) => { e.stopPropagation(); onSave(); }}>保存</button>
      )}
      <div className="meta">
        <span title={author}>{author}{extraSources > 0 ? ` +${extraSources}` : ''}</span>
        <span className="muted">{preview ? preview.size : ''} <span className={`status ${candidate.status}`}>{STATUS_LABEL[candidate.status]}</span></span>
        {candidate.status === 'failed' && <span className="error" title={candidate.errorCode}>{candidate.errorCode?.slice(0, 40)}</span>}
      </div>
    </div>
  );
}
