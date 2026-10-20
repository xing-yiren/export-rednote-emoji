/**
 * IndexedDB 存储层（仅管理页使用）。
 * stores:
 *  - sessions  (keyPath: id)
 *  - candidates(keyPath: id, index: sessionId)
 *  - assets    (keyPath: sha256)
 *  - exports   (keyPath: id)
 */
import type { Asset, AssetMeta, Candidate, Session } from '../shared/types';

const DB_NAME = 'rednote-emoji';
const DB_VERSION = 1;

export interface ExportJob {
  id: string;
  sessionId: string;
  createdAt: string;
  downloadId?: number;
  state: 'creating' | 'downloaded' | 'failed' | 'unknown';
  filename: string;
  candidateIds: string[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('candidates')) {
        const s = db.createObjectStore('candidates', { keyPath: 'id' });
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('selectedUrl', 'selectedUrl');
      }
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'sha256' });
      if (!db.objectStoreNames.contains('exports')) {
        const s = db.createObjectStore('exports', { keyPath: 'id' });
        s.createIndex('sessionId', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result: T | undefined;
        const req = fn(s);
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result as T);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const db = {
  putSession: (s: Session) => tx('sessions', 'readwrite', (st) => st.put(s)),
  getSession: (id: string) => tx<Session | undefined>('sessions', 'readonly', (st) => st.get(id)),
  listSessions: () => tx<Session[]>('sessions', 'readonly', (st) => st.getAll()),
  putCandidates: (list: Candidate[]) =>
    tx('candidates', 'readwrite', (st) => {
      for (const c of list) st.put(c);
    }),
  getCandidate: (id: string) => tx<Candidate | undefined>('candidates', 'readonly', (st) => st.get(id)),
  listCandidates: (sessionId: string) =>
    tx<Candidate[]>('candidates', 'readonly', (st) => st.index('sessionId').getAll(sessionId)),
  putAsset: async (asset: Asset): Promise<void> => {
    const { blob, ...meta } = asset;
    await tx('assets', 'readwrite', (st) => st.put({ ...meta, blob }));
  },
  getAsset: (sha256: string) => tx<Asset | undefined>('assets', 'readonly', (st) => st.get(sha256)),
  getAssetMeta: async (sha256: string): Promise<AssetMeta | undefined> => {
    const a = await tx<Asset | undefined>('assets', 'readonly', (st) => st.get(sha256));
    if (!a) return undefined;
    const { blob: _blob, ...meta } = a;
    return meta;
  },
  putExport: (job: ExportJob) => tx('exports', 'readwrite', (st) => st.put(job)),
  listExports: (sessionId: string) =>
    tx<ExportJob[]>('exports', 'readonly', (st) => st.index('sessionId').getAll(sessionId)),
};
