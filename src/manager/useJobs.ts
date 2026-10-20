/**
 * 获取队列：并发控制、状态流转、取消、失败重试、429 队列暂停。
 * 仅管理页运行，不依赖 service worker 常驻；刷新后由调用方恢复残留状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../services/db';
import { FetchError, LIMITS, fetchAsset, retryDelay } from '../services/fetcher';
import type { Candidate } from '../shared/types';
import type { ManagerLease } from '../services/lease';

export interface JobState {
  running: boolean;
  done: number;
  failed: number;
  total: number;
  message: string | null;
  pausedUntil?: number;
}

type Listener = (updates: Candidate[]) => void;

/** 调试用：?slow=毫秒 让每张图片之间等待，便于手动测试取消与多管理页租约。 */
function debugSlowMs(): number {
  // 兼容三种写法：?slow=1000、#<sessionId>?slow=1000、#<sessionId>&slow=1000
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '').split('?')[1] ?? '');
  const fromSearch = new URLSearchParams(location.search);
  const v = Number(fromSearch.get('slow') ?? fromHash.get('slow'));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 5000) : 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export function useJobs(onUpdated: Listener, lease: ManagerLease | null = null) {
  const [job, setJob] = useState<JobState>({ running: false, done: 0, failed: 0, total: 0, message: null });
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const updatedRef = useRef(onUpdated);
  updatedRef.current = onUpdated;

  /** 恢复：把残留 queued/fetching 视为可重试；已存在 asset 的直接转为 ready。 */
  const recover = useCallback(async (sessionId: string) => {
    if (!sessionId) return [] as Candidate[];
    const list = await db.listCandidates(sessionId);
    const fixed: Candidate[] = [];
    for (const c of list) {
      if (c.status === 'queued' || c.status === 'fetching') {
        fixed.push({ ...c, status: c.assetHash ? 'ready' : 'found' });
      } else if (c.status === 'ready' && c.assetHash) {
        const asset = await db.getAssetMeta(c.assetHash);
        if (!asset) fixed.push({ ...c, status: 'found', assetHash: undefined });
      }
    }
    if (fixed.length) await db.putCandidates(fixed);
    if (fixed.length) updatedRef.current(fixed);
    return fixed;
  }, []);

  useEffect(() => {
    void recover(location.hash.slice(1).split('?')[0] ?? '');
  }, [recover]);

  const run = useCallback(async (targets: Candidate[]): Promise<boolean> => {
    if (runningRef.current || targets.length === 0) return false;
    // 同一会话只允许一个管理页执行队列；获取失败则拒绝执行，避免重复下载
    if (lease && !(await lease.acquire())) return false;
    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const total = targets.length;
    let done = 0;
    let failed = 0;
    /** 429 后全局暂停时间点 */
    let pausedUntil = 0;
    const setProgress = (message: string | null) =>
      setJob({ running: true, done, failed, total, message, pausedUntil: pausedUntil > Date.now() ? pausedUntil : undefined });
    setProgress('正在获取图片…');

    const update = async (c: Candidate) => {
      await db.putCandidates([c]);
      updatedRef.current([c]);
    };

    // 文件层去重索引：同一会话内 sha256 -> 首个候选 id（避免每张图重扫全表）
    const hashIndex = new Map<string, string>();
    for (const c of await db.listCandidates(targets[0]!.sessionId)) {
      if (c.assetHash && !hashIndex.has(c.assetHash)) hashIndex.set(c.assetHash, c.id);
    }

    const queue = [...targets];
    const worker = async () => {
      for (;;) {
        if (controller.signal.aborted) return;
        const c = queue.shift();
        if (!c) return;
        await update({ ...c, status: 'fetching' });
        let attempt = 0;
        for (;;) {
          try {
            if (pausedUntil > Date.now()) {
              setProgress('请求过于频繁，队列暂停中…');
              await sleep(pausedUntil - Date.now(), controller.signal);
            }
            const { asset } = await fetchAsset(c.selectedUrl, controller.signal);
            await db.putAsset(asset);
            hashIndex.set(asset.sha256, hashIndex.get(asset.sha256) ?? c.id);
            await update({ ...c, status: 'ready', assetHash: asset.sha256, errorCode: undefined });
            done++;
            break;
          } catch (e) {
            if (controller.signal.aborted || (e instanceof Error && e.message === 'aborted')) {
              await update({ ...c, status: 'found' });
              return;
            }
            const err = e instanceof FetchError ? e : new FetchError('network', String(e), undefined, true);
            if (err.code === 'cancelled') {
              await update({ ...c, status: 'found' });
              return;
            }
            if (err.code === 'rate_limited' && err.retryAfterMs) {
              pausedUntil = Date.now() + err.retryAfterMs;
            }
            if (err.retriable && attempt < LIMITS.maxAutoRetries) {
              await sleep(retryDelay(attempt), controller.signal).catch(() => {});
              attempt++;
              continue;
            }
            failed++;
            await update({ ...c, status: 'failed', errorCode: err.message });
            break;
          }
        }
        setProgress('正在获取图片…');
        const slow = debugSlowMs();
        if (slow) await sleep(slow, controller.signal).catch(() => {});
      }
    };

    try {
      const workers = Array.from({ length: Math.min(LIMITS.concurrency, queue.length) }, worker);
      await Promise.all(workers);
    } finally {
      runningRef.current = false;
      abortRef.current = null;
      await lease?.release();
      setJob({
        running: false,
        done,
        failed,
        total,
        message: controller.signal.aborted ? '已取消' : failed > 0 ? `完成：成功 ${done}，失败 ${failed}` : '全部获取成功',
      });
    }
    return true;
  }, [lease]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { job, run, cancel, recover };
}
