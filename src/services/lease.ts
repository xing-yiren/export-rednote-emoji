/**
 * 执行所有权租约：同一会话只允许一个管理页执行获取/ZIP 队列。
 * 租约保存在 chrome.storage.local，靠心跳续期；关闭页面后自然过期。
 */
import { randomId } from '../shared/id';

const KEY = 'managerLease';
const TTL_MS = 15_000;
const HEARTBEAT_MS = 5_000;

interface Lease {
  owner: string;
  sessionId: string;
  expiresAt: number;
}

export class ManagerLease {
  readonly owner = randomId('lease');
  private heartbeat: number | null = null;
  private _held = false;

  constructor(private readonly sessionId: string) {}

  get held(): boolean {
    return this._held;
  }

  private async read(): Promise<Lease | null> {
    const { [KEY]: lease } = await chrome.storage.local.get(KEY);
    return (lease as Lease | undefined) ?? null;
  }

  private async write(lease: Lease | null): Promise<void> {
    if (lease) await chrome.storage.local.set({ [KEY]: lease });
    else await chrome.storage.local.remove(KEY);
  }

  /** 尝试获取租约；已被其他未过期页面持有时返回 false。 */
  async acquire(): Promise<boolean> {
    const current = await this.read();
    const now = Date.now();
    if (current && current.expiresAt > now && current.owner !== this.owner) {
      this._held = false;
      return false;
    }
    await this.write({ owner: this.owner, sessionId: this.sessionId, expiresAt: now + TTL_MS });
    this._held = true;
    if (this.heartbeat === null) {
      this.heartbeat = window.setInterval(() => {
        void this.renew();
      }, HEARTBEAT_MS);
    }
    return true;
  }

  private async renew(): Promise<void> {
    if (!this._held) return;
    const current = await this.read();
    if (current && current.owner !== this.owner) {
      this._held = false;
      this.stopHeartbeat();
      return;
    }
    await this.write({ owner: this.owner, sessionId: this.sessionId, expiresAt: Date.now() + TTL_MS });
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this._held) return;
    const current = await this.read();
    if (current?.owner === this.owner) await this.write(null);
    this._held = false;
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /** 检查是否被其他管理页占用（用于界面提示）。 */
  async heldByOther(): Promise<boolean> {
    const current = await this.read();
    return !!current && current.expiresAt > Date.now() && current.owner !== this.owner;
  }
}
