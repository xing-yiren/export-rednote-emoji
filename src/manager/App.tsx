import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from './useCollection';
import { useJobs } from './useJobs';
import { ManagerLease } from '../services/lease';
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
  const { ready, session, active, candidates, overflow, commentDomPresent, skippedHosts, pageState, applyUpdates } = useCollection();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [authorFilter, setAuthorFilter] = useState<string>('');
  const [onlySelectedAuthor, setOnlySelectedAuthor] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'failed'>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  const onUpdated = useCallback((updates: Candidate[]) => {
    applyUpdates(updates);
  }, [applyUpdates]);
  const lease = useMemo(() => (session?.id ? new ManagerLease(session.id) : null), [session?.id]);
  const { job, run, cancel, recover } = useJobs(onUpdated, lease);

  // 默认全选：新会话时全选，后续新到达的图片也默认选中（用户手动取消的不受影响）
  const touchedRef = useRef(false);
  useEffect(() => {
    if (session?.id) void recover(session.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    setSelectedIds(new Set(candidates.map((c) => c.id)));
    touchedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);
  useEffect(() => {
    if (touchedRef.current) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of candidates) next.add(c.id);
      return next;
    });
  }, [candidates]);

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
    let list = candidates;
    if (authorFilter) {
      list = list.filter((c) =>
        onlySelectedAuthor
          ? c.sources.every((s) => (s.authorId ?? s.authorName) === authorFilter)
          : c.sources.some((s) => (s.authorId ?? s.authorName) === authorFilter),
      );
    }
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter);
    return list;
  }, [candidates, authorFilter, onlySelectedAuthor, statusFilter]);

  // 文件层去重：同哈希的候选共享同一 asset，界面标注“内容重复”
  const hashCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates) if (c.assetHash) m.set(c.assetHash, (m.get(c.assetHash) ?? 0) + 1);
    return m;
  }, [candidates]);

  const selected = visible.filter((c) => selectedIds.has(c.id));
  const readyCount = candidates.filter((c) => c.status === 'ready').length;
  const failedCount = candidates.filter((c) => c.status === 'failed').length;

  const toggle = (id: string) => {
    touchedRef.current = true;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    touchedRef.current = true;
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

  const stopCollection = async () => {
    await chrome.runtime.sendMessage({ type: 'STOP_COLLECTION' });
    setStopped(true);
    setNotice('已停止采集。已收集的图片仍可获取与导出。');
  };

  const resumeCollection = async () => {
    // 重新点击扩展图标等同于在页面上重新启动采集；这里提示用户操作
    setNotice('请回到小红书笔记页，重新点击工具栏中的扩展图标以开始新的采集会话。');
  };

  const fetchSelected = async () => {
    setError(null);
    const targets = selected.filter((c) => c.status !== 'ready');
    if (targets.length === 0) {
      setNotice('所选图片已全部就绪，可直接保存。');
      return;
    }
    if (!(await run(targets))) setError('另一个管理页正在执行获取/导出队列，请稍后再试。');
  };

  const retryFailed = async () => {
    setError(null);
    const targets = candidates.filter((c) => c.status === 'failed');
    if (targets.length === 0) return;
    if (!(await run(targets))) setError('另一个管理页正在执行获取/导出队列，请稍后再试。');
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
    if (lease && !(await lease.acquire())) {
      setError('另一个管理页正在执行获取/导出队列，请稍后再试。');
      return;
    }
    try {
      setError(null);
      setBusy('zip');
      const res = await exportZip(candidates[0]?.sourceNoteUrl ?? session?.noteUrl ?? '', session!.id, selected);
      setNotice(`已导出 ZIP：${res.count} 张，${(res.totalBytes / 1024 / 1024).toFixed(1)} MiB${res.skipped.length ? `，跳过 ${res.skipped.length} 张` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await lease?.release();
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
        {stale || stopped ? (
          <button className="small" onClick={() => void resumeCollection()}>重新开始采集</button>
        ) : (
          <button className="small" onClick={() => void stopCollection()}>停止采集</button>
        )}
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
        <label className="small">状态：<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">全部</option>
          <option value="ready">已就绪</option>
          <option value="failed">失败</option>
        </select></label>
        <label className="small"><input type="checkbox" checked={visible.every((c) => selectedIds.has(c.id)) && visible.length > 0} onChange={selectAll} /> 全选</label>
        <span className="small muted">已选 {selected.length} / 显示 {visible.length}</span>
      </header>

      <main>
        {stale && (
          <div className="notice warn small">
            采集会话已停止或原标签页已关闭。已收集的图片仍可导出；如需继续采集，请回到小红书页面重新点击扩展图标。
          </div>
        )}
        {pageState === 'script_gone' && (
          <div className="notice warn small">
            小红书页面已刷新或重新加载，采集连接中断。已收集的图片不受影响；<b>请回到小红书标签页重新点击扩展图标</b>以开始新的采集会话。
          </div>
        )}
        {pageState === 'tab_closed' && (
          <div className="notice warn small">小红书标签页已关闭，无法继续采集。已收集的图片仍可获取与导出。</div>
        )}
        {pageState === 'left_note' && (
          <div className="notice warn small">小红书标签页已离开该笔记，无法继续采集。已收集的图片仍可获取与导出。</div>
        )}
        {!commentDomPresent && (
          <div className="notice warn small">
            小红书页面的评论区已卸载（切换到本页后详情弹层会关闭）。已收集的图片不受影响，可继续获取与导出；需要继续采集时，回到小红书标签页重新展开评论。
          </div>
        )}
        {skippedHosts.length > 0 && (
          <div className="notice warn small">
            以下图片域名未被授权，已跳过：{skippedHosts.join('、')}。如果评论区明明有图片却采集不到，说明站点更换了资源域名，需要更新扩展的允许列表。
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
        <p className="muted small">
          关于动图：小红书服务端会将评论图片统一转码为 WebP，网页端拿到的通常是静态帧。手机 App 中显示的动图在网页端可能只显示为静态图，本工具只能保存实际获取到的字节。
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
                duplicateCount={c.assetHash ? (hashCount.get(c.assetHash) ?? 1) - 1 : 0}
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
  duplicateCount,
}: {
  candidate: Candidate;
  selected: boolean;
  onToggle: () => void;
  onSave: () => void;
  busy: boolean;
  duplicateCount: number;
}) {
  const [preview, setPreview] = useState<{ url: string; format: string; animated: boolean | null; size: string } | null>(null);
  const [previewError, setPreviewError] = useState(false);
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
    } else {
      // 尚未获取字节时，用已登记的候选资源地址做预览（已校验 https + 允许域名）
      setPreview({ url: candidate.selectedUrl, format: '', animated: null, size: '' });
      setPreviewError(false);
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
          {preview && !previewError ? (
          <img src={preview.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setPreviewError(true)} />
        ) : (
          <span className="muted small">{candidate.status === 'ready' ? '预览失败' : '点击获取以查看'}</span>
        )}
      </div>
      <span className="badge">{preview?.format ? `${preview.format}${preview.animated === true ? ' 动图' : preview.animated === null ? ' 动态未知' : ' 静态'}` : STATUS_LABEL[candidate.status]}</span>
      {candidate.status === 'ready' && (
        <button className="todl" disabled={busy} onClick={(e) => { e.stopPropagation(); onSave(); }}>保存</button>
      )}
      <div className="meta">
        <span title={author}>{author}{extraSources > 0 ? ` · 另有 ${extraSources} 处来源` : ''}</span>
        {duplicateCount > 0 && <span className="muted small">内容与其它 {duplicateCount} 张相同</span>}
        <span className="muted">
          {preview?.size || (candidate.naturalSize ? `${candidate.naturalSize[0]}×${candidate.naturalSize[1]}` : '')}{' '}
          <span className={`status ${candidate.status}`}>{STATUS_LABEL[candidate.status]}</span>
        </span>
        {candidate.status === 'failed' && <span className="error" title={candidate.errorCode}>{candidate.errorCode?.slice(0, 40)}</span>}
      </div>
    </div>
  );
}
