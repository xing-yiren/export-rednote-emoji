// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagerLease } from '@/services/lease';

const store = new Map<string, unknown>();
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store.get(key) }),
      set: async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      remove: async (key: string) => {
        store.delete(key);
      },
    },
  },
};

describe('管理页租约', () => {
  beforeEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('同一时间只允许一个持有者', async () => {
    const a = new ManagerLease('s1');
    const b = new ManagerLease('s1');
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(await b.heldByOther()).toBe(true);
    await a.release();
    expect(await b.acquire()).toBe(true);
    await b.release();
  });

  it('租约过期后可被其他页面接管', async () => {
    const a = new ManagerLease('s1');
    const b = new ManagerLease('s1');
    await a.acquire();
    const lease = store.get('managerLease') as { expiresAt: number };
    store.set('managerLease', { ...lease, expiresAt: Date.now() - 1 });
    expect(await b.acquire()).toBe(true);
    await b.release();
  });

  it('释放时不会清掉他人的租约', async () => {
    const a = new ManagerLease('s1');
    const b = new ManagerLease('s1');
    await a.acquire();
    await b.release();
    expect(await b.heldByOther()).toBe(true);
    await a.release();
  });
});
