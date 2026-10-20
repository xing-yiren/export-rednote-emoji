/** 跨上下文共享的数据模型与消息协议。 */

export type CandidateStatus = 'found' | 'queued' | 'fetching' | 'ready' | 'failed';
export type AssetFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg' | 'unknown';

export interface CandidateSource {
  commentId?: string;
  authorId?: string;
  authorName?: string;
  /** 页面内位置标记，评论 ID 缺失时用于追溯来源 */
  position?: string;
}

export interface Candidate {
  id: string;
  sessionId: string;
  noteId: string;
  sourceNoteUrl: string;
  sources: CandidateSource[];
  resourceUrls: string[];
  selectedUrl: string;
  /** 页面原图尺寸，仅用于展示排序 */
  naturalSize?: [number, number];
  discoveredAt: string;
  status: CandidateStatus;
  assetHash?: string;
  errorCode?: string;
  selected: boolean;
}

export interface AssetMeta {
  sha256: string;
  format: AssetFormat;
  animated: boolean | null;
  width?: number;
  height?: number;
  byteLength: number;
  contentType?: string;
  fetchedAt: string;
}

export interface Asset extends AssetMeta {
  blob: Blob;
}

export interface Session {
  id: string;
  tabId: number;
  noteId: string;
  noteUrl: string;
  createdAt: string;
  status: 'collecting' | 'stopped' | 'closed';
}

export interface ScanSource {
  commentId?: string;
  authorId?: string;
  authorName?: string;
  position?: string;
}

/** content script 上报的单个图片候选（已在页面侧完成来源绑定） */
export interface ScannedImage {
  url: string;
  sources: ScanSource[];
  /** 同一元素上的其它候选地址（srcset/data-src），仅供调试与降级 */
  alternates?: string[];
  /** 原图展示尺寸（仅用于排序/展示，不作为识别依据） */
  naturalSize?: [number, number];
}

export interface ScanPayload {
  sessionId: string;
  noteId: string;
  noteUrl: string;
  images: ScannedImage[];
  trigger: 'initial' | 'mutation' | 'snapshot';
  /** 页面当前是否仍持有评论区 DOM（详情弹层可能已被卸载） */
  commentDomPresent?: boolean;
}

export type ExtensionMessage =
  | { type: 'START_COLLECTION'; noteUrl: string }
  | { type: 'STOP_COLLECTION' }
  | { type: 'SCAN_RESULT'; payload: ScanPayload }
  | { type: 'OPEN_MANAGER' }
  | { type: 'GET_SESSION_STATE' };

export type ContentMessage =
  | { type: 'BEGIN_SCAN'; sessionId: string; noteId: string }
  | { type: 'SCAN_NOW' }
  | { type: 'END_SCAN' };

export const MSG = {
  startCollection: 'START_COLLECTION',
  stopCollection: 'STOP_COLLECTION',
  scanResult: 'SCAN_RESULT',
  scanNow: 'SCAN_NOW',
  beginScan: 'BEGIN_SCAN',
  endScan: 'END_SCAN',
  openManager: 'OPEN_MANAGER',
} as const;
