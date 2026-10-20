/**
 * 采集状态管理：接收 SCAN_RESULT、合并候选、持久化到 IndexedDB。
 * 写入串行化，保证并发扫描结果不会覆盖。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../services/db';
import { mergeScan } from '../shared/candidates';
import { resourceDedupeKey } from '../shared/url';
import { randomId } from '../shared/id';
import { LIMITS } from '../services/fetcher';
import { MSG, type Candidate, type CandidateSource, type ScanPayload, type Session } from '../shared/types';

export interface ActiveSession {
  sessionId: string;
  tabId: number;
  noteId: string;
  noteUrl: string;
}

export interface CollectionState {
  ready: boolean;
  session: Session | null;
  active: ActiveSession | null;
  candidates: Candidate[];
  overflow: boolean;
  lastScanAt: string | null;
  /** 页面评论区 DOM 是否仍在（用户切到本页后详情弹层可能已卸载） */
  commentDomPresent: boolean;
}

export function useCollection(): CollectionState & {
  reload: () => Promise<void>;
  /** 由任务队列回写状态，保持界面与 IndexedDB 一致 */
  applyUpdates: (updates: Candidate[]) => void;
} {
  const [state, setState] = useState<CollectionState>({
    ready: false, session: null, active: null, candidates: [], overflow: false, lastScanAt: null, commentDomPresent: true,
  });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sessionRef = useRef<Session | null>(null);
  /** 规范化 URL -> { candidateId, sources } */
  const indexRef = useRef<Map<string, { id: string; sources: CandidateSource[] }>>(new Map());

  const load = useCallback(async () => {
    // hash 形式为 #<sessionId> 或 #<sessionId>?slow=1000
    const hash = location.hash.replace(/^#/, '').split('?')[0] ?? '';
    const res = (await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_SESSION' }).catch(() => undefined)) as
      | { ok: boolean; active: ActiveSession | null }
      | undefined;
    const active = res?.active ?? null;
    const sessionId = hash || active?.sessionId;
    if (!sessionId) {
      setState((s) => ({ ...s, ready: true, active }));
      return;
    }
    let session = await db.getSession(sessionId);
    if (!session && active?.sessionId === sessionId) {
      session = {
        id: active.sessionId,
        tabId: active.tabId,
        noteId: active.noteId,
        noteUrl: active.noteUrl,
        createdAt: new Date().toISOString(),
        status: 'collecting',
      };
      await db.putSession(session);
    }
    if (!session) {
      setState((s) => ({ ...s, ready: true, active }));
      return;
    }
    sessionRef.current = session;
    const candidates = await db.listCandidates(sessionId);
    indexRef.current = new Map(
      candidates.map((c) => [resourceDedupeKey(c.selectedUrl), { id: c.id, sources: c.sources }]),
    );
    setState((s) => ({ ...s, ready: true, active, session, candidates }));
  }, []);

  const applyScan = useCallback((payload: ScanPayload) => {
    queue.current = queue.current
      .then(async () => {
        const session = sessionRef.current;
        if (!session || session.id !== payload.sessionId) return;
        if (payload.noteId !== session.noteId) return;
        const { created, merged } = mergeScan(indexRef.current, payload.images);
        const now = new Date().toISOString();
        const room = Math.max(0, LIMITS.maxCandidatesPerSession - indexRef.current.size);
        const accepted = created.slice(0, room);
        const overflow = created.length > accepted.length;
        const newCandidates: Candidate[] = accepted.map((img) => {
          const id = randomId('c');
          indexRef.current.set(resourceDedupeKey(img.url), { id, sources: img.sources });
          return {
            id,
            sessionId: session.id,
            noteId: session.noteId,
            sourceNoteUrl: session.noteUrl,
            sources: img.sources,
            resourceUrls: [img.url, ...(img.alternates ?? [])],
            selectedUrl: img.url,
            naturalSize: img.naturalSize,
            discoveredAt: now,
            status: 'found',
            selected: true,
          };
        });
        const updated: Candidate[] = [];
        for (const [key, sources] of merged) {
          const entry = indexRef.current.get(key);
          if (!entry) continue;
          entry.sources = sources;
          const old = await db.getCandidate(entry.id);
          if (old) updated.push({ ...old, sources });
        }
        if (newCandidates.length) await db.putCandidates(newCandidates);
        if (updated.length) await db.putCandidates(updated);
        setState((s) => {
          const byId = new Map(s.candidates.map((c) => [c.id, c]));
          for (const c of updated) byId.set(c.id, c);
          for (const c of newCandidates) byId.set(c.id, c);
          return {
            ...s,
            candidates: [...byId.values()],
            overflow: s.overflow || overflow,
            lastScanAt: now,
            commentDomPresent: payload.commentDomPresent ?? s.commentDomPresent,
          };
        });
      })
      .catch((e) => console.error('applyScan failed', e));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const listener = (msg: { type?: string; payload?: ScanPayload }) => {
      if (msg.type === 'SCAN_FORWARD' && msg.payload) applyScan(msg.payload);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyScan]);

  // 管理页打开后主动触发一次扫描，补上管理页未打开期间的增量（每次会话仅一次）
  const resynced = useRef<string | null>(null);
  useEffect(() => {
    const id = state.session?.id;
    if (!state.ready || !id || resynced.current === id) return;
    resynced.current = id;
    void chrome.runtime.sendMessage({ type: MSG.scanNow }).catch(() => {});
  }, [state.ready, state.session?.id]);

  const applyUpdates = useCallback((updates: Candidate[]) => {
    if (updates.length === 0) return;
    setState((s) => {
      const byId = new Map(s.candidates.map((c) => [c.id, c]));
      for (const u of updates) if (byId.has(u.id)) byId.set(u.id, u);
      return { ...s, candidates: [...byId.values()] };
    });
  }, []);

  return { ...state, reload: load, applyUpdates };
}
