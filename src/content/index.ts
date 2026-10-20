/**
 * 按需注入的 content script：扫描当前笔记评论区图片，增量观察新加载节点。
 * 只在 isolated world 读取 DOM，不修改页面业务逻辑。
 */
import { extractCommentImages, findCommentRoot, SELECTORS } from './adapter';
import { MSG, type ContentMessage, type ScanPayload, type ScannedImage } from '../shared/types';
import { isAllowedHost } from '../shared/url';

const ALLOWED_HOSTS = ['sns-webpic-qc.xhscdn.com'];

interface ScanState {
  sessionId: string;
  noteId: string;
  observer: MutationObserver | null;
  root: Element | null;
  flushTimer: number | null;
  pending: Map<string, ScannedImage>;
  stopped: boolean;
}

const state: ScanState = {
  sessionId: '',
  noteId: '',
  observer: null,
  root: null,
  flushTimer: null,
  pending: new Map(),
  stopped: true,
};

let lastReportedNoteUrl = location.href;

function isAllowed(u: string): boolean {
  try {
    return isAllowedHost(new URL(u).hostname, ALLOWED_HOSTS) && new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

function noteUrl(): string {
  const u = new URL(location.href);
  u.hash = '';
  return u.href;
}

function noteId(): string {
  return /(?:explore|discovery\/item)\/([0-9a-f]{24})/.exec(location.href)?.[1] ?? '';
}

function flush(trigger: 'initial' | 'mutation'): void {
  if (state.stopped) return;
  const images: ScannedImage[] = [];
  if (state.root) {
    const items = state.root.querySelectorAll(SELECTORS.commentItem);
    for (const item of items) images.push(...extractCommentImages(item, isAllowed));
  }
  for (const img of state.pending.values()) images.push(img);
  state.pending.clear();
  if (images.length === 0) return;
  const payload: ScanPayload = {
    sessionId: state.sessionId,
    noteId: state.noteId,
    noteUrl: noteUrl(),
    images,
    trigger,
  };
  try {
    chrome.runtime.sendMessage({ type: MSG.scanResult, payload }).catch(() => {});
  } catch {
    // 扩展被重载/卸载后 runtime 失效，停止观察
    stop();
  }
}

function scheduleFlush(): void {
  if (state.flushTimer !== null || state.stopped) return;
  state.flushTimer = window.setTimeout(() => {
    state.flushTimer = null;
    flush('mutation');
  }, 300);
}

function collectNearby(node: Node): void {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return;
  const scope = el.closest(SELECTORS.commentItem);
  const contexts = scope ? [scope] : [...el.querySelectorAll(SELECTORS.commentItem)];
  for (const item of contexts) {
    for (const img of extractCommentImages(item, isAllowed)) {
      state.pending.set(img.url, img);
    }
  }
  // 新增节点本身可能就是一个图片
  if (el instanceof HTMLImageElement && el.classList.contains('inner')) {
    const item = el.closest(SELECTORS.commentItem);
    if (item) for (const img of extractCommentImages(item, isAllowed)) state.pending.set(img.url, img);
  }
}

function bindObserver(): void {
  const root = findCommentRoot(document);
  if (!root) return;
  if (state.observer && state.root === root) return;
  state.observer?.disconnect();
  state.root = root;
  const observer = new MutationObserver((records) => {
    if (state.stopped) return;
    // 评论容器被替换：重新绑定
    if (!state.root || !state.root.isConnected) {
      state.root = null;
      bindObserver();
      if (state.root) flush('mutation');
    }
    for (const r of records) {
      if (r.type === 'attributes') collectNearby(r.target);
      else for (const n of r.addedNodes) if (n.isConnected) collectNearby(n);
    }
    scheduleFlush();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });
  state.observer = observer;
}

function start(sessionId: string, expectedNoteId: string): void {
  if (state.sessionId === sessionId && !state.stopped) return;
  stop();
  state.sessionId = sessionId;
  state.noteId = expectedNoteId || noteId();
  state.stopped = false;
  state.pending.clear();
  bindObserver();
  flush('initial');
}

function stop(): void {
  state.stopped = true;
  state.observer?.disconnect();
  state.observer = null;
  state.root = null;
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  state.pending.clear();
  state.sessionId = '';
}

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg?.type === MSG.beginScan) {
    start(msg.sessionId, msg.noteId);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === MSG.scanNow) {
    bindObserver();
    flush('mutation');
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === MSG.endScan) {
    stop();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

// SPA 路由切换：笔记变化时停止旧会话观察，等待用户重新开启
window.addEventListener('popstate', onUrlMaybeChanged);
const originalPush = history.pushState;
history.pushState = function (...args) {
  originalPush.apply(this, args as Parameters<History['pushState']>);
  onUrlMaybeChanged();
};

function onUrlMaybeChanged(): void {
  if (location.href === lastReportedNoteUrl) return;
  const prev = lastReportedNoteUrl;
  lastReportedNoteUrl = location.href;
  if (noteId() !== state.noteId && !state.stopped) {
    stop();
    try {
      chrome.runtime.sendMessage({ type: 'NOTE_CHANGED', from: prev, to: location.href }).catch(() => {});
    } catch {
      /* runtime 失效 */
    }
  }
}
