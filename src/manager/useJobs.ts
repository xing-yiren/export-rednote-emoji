/**
 * 获取队列：并发控制、状态流转、取消、失败重试。
 * 仅管理页运行，不依赖 service worker 常驻。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../services/db';
import { FetchError, LIMITS, fetchAsset, retryDelay } from '../services/fetcher';
import type { Candidate } from '../shared/types';

export interface JobState {
  running: boolean;
  done: number;
  failed: number;
  total: number;
  message: string | null;
}

type Listener = (updates: Candidate[]) => void;

export function useJobs(onUpdated: Listener) {
  const [job, setJob] = useState<JobState>({ running: false, done: 0, failed: 0, total: 0, message: null });
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const updatedRef = useRef(onUpdated);
  updatedRef.current = onUpdated;

  /** 刷新后把残留的 fetching 恢复为可重试状态。 */
  useEffect(() => {
    void (async () => {
      const sessions = await db.listSessions();
      for (const s of sessions) {
        const list = await db.listCandidates(s.id);
        const stale = list.filter((c) => c.status === 'fetching' || c.status === 'queued');
        if (stale.length) {
          await db.putCandidates(stale.map((c) => ({ ...c, status: 'found' as const })));
        }
      }
      const current = await db.listCandidates(location.hash.slice(1));
      const stale = current.filter((c) => c.status === 'fetching' || c.status === 'queued');
      if (stale.length) updatedRef.current(stale.map((c) => ({ ...c, status: 'found' as const })));
    })();
  }, []);

  const run = useCallback(
    async (targets: Candidate[]) => {
      if (runningRef.current || targets.length === 0) return;
      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      const total = targets.length;
      let done = 0;
      let failed = 0;
      setJob({ running: true, done, failed, total, message: null });

      const update = async (c: Candidate) => {
        await db.putCandidates([c]);
        updatedRef.current([c]);
      };

      const queue = [...targets];
      const workers = Array.from({ length: Math.min(LIMITS.concurrency, queue.length) }, async () => {
        for (;;) {
          if (controller.signal.aborted) return;
          const c = queue.shift();
          if (!c) return;
          await update({ ...c, status: 'fetching' });
          let attempt = 0;
          for (;;) {
            try {
              const { asset } = await fetchAsset(c.selectedUrl, controller.signal);
              await db.putAsset(asset);
              const { canonical } = await dedupeAgainstExisting(c, asset.sha256);
              await update({ ...c, status: 'ready', assetHash: canonical, errorCode: undefined });
              done++;
              break;
            } catch (e) {
              const err = e instanceof FetchError ? e : new FetchError('network', String(e), undefined, true);
              if (err.code === 'cancelled') {
                await update({ ...c, status: 'found' });
                return;
              }
              if (err.retriable && attempt < LIMITS.maxAutoRetries) {
                await new Promise((r) => setTimeout(r, retryDelay(attempt)));
                attempt++;
                continue;
              }
              failed++;
              await update({ ...c, status: 'failed', errorCode: err.message });
              break;
            }
          }
          setJob({ running: true, done, failed, total, message: '正在获取图片…' });
        }
      });
      await Promise.all(workers);
      runningRef.current = false;
      abortRef.current = null;
      setJob({ running: false, done, failed, total, message: controller.signal.aborted ? '已取消' : '获取完成' });
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { job, run, cancel };
}

/** 若已存在同哈希的候选，复用其结果，保持多个来源指向同一 asset。 */
async function dedupeAgainstExisting(c: Candidate, sha256: string): Promise<{ canonical: string }> {
  const existing = await db.listCandidates(c.sessionId);
  const same = existing.find((x) => x.id !== c.id && x.assetHash === sha256);
  return { canonical: same?.assetHash ?? sha256 };
}
