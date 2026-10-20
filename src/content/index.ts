/**
 * 按需注入的 content script：扫描当前笔记评论区图片，增量观察新加载节点。
 * 只在 isolated world 读取 DOM，不修改页面业务逻辑。
 *
 * 重要：管理页被打开时本标签页转入后台，小红书的详情弹层与评论 DOM 会被卸载。
 * 因此这里始终维护“已收集图片”的最后快照，并在容器被移除后仍能重新上报，
 * 保证用户在管理页关闭详情后也能继续操作已收集结果。
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
  /** 会话内已见过的图片快照（URL 去重），容器卸载后仍然可用 */
  snapshot: Map<string, ScannedImage>;
}

const state: ScanState = {
  sessionId: '',
  noteId: '',
  observer: null,
  root: null,
  flushTimer: null,
  snapshot: new Map(),
};

function isAllowed(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && isAllowedHost(parsed.hostname, ALLOWED_HOSTS);
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

/** 会话内被跳过的图片域名（诊断用） */
const skippedHosts = new Set<string>();

function collectInto(map: Map<string, ScannedImage>, container: ParentNode): void {
  const diag = { skippedHosts, pictureNodes: 0 };
  for (const item of container.querySelectorAll(SELECTORS.commentItem)) {
    for (const img of extractCommentImages(item, isAllowed, location.href, diag)) {
      if (!map.has(img.url)) map.set(img.url, img);
    }
  }
}

function send(images: ScannedImage[], trigger: ScanPayload['trigger']): void {
  if (!state.sessionId || images.length === 0) return;
  const payload: ScanPayload = {
    sessionId: state.sessionId,
    noteId: state.noteId,
    noteUrl: noteUrl(),
    images,
    trigger,
    commentDomPresent: !!document.querySelector(SELECTORS.commentItem),
    skippedHosts: [...skippedHosts],
  };
  try {
    chrome.runtime.sendMessage({ type: MSG.scanResult, payload }).catch(() => {});
  } catch {
    // 扩展重载/卸载后 runtime 失效：停止观察，等待用户重新启动
    stop();
  }
}

/** 把当前 DOM 中可见的评论图片并入快照，并上报新增部分。 */
function scanAndReport(trigger: 'initial' | 'mutation'): void {
  const before = new Set(state.snapshot.keys());
  const root = state.root && state.root.isConnected ? state.root : findCommentRoot(document);
  state.root = root ?? state.root;
  if (root) collectInto(state.snapshot, root);
  const added = [...state.snapshot.values()].filter((img) => !before.has(img.url));
  send(added, trigger);
}

/** 重新上报整个快照（用于 NOTE_CHANGED 之外的恢复场景）。 */
function reportSnapshot(): void {
  send([...state.snapshot.values()], 'snapshot');
}

function scheduleScan(): void {
  if (state.flushTimer !== null || !state.sessionId) return;
  state.flushTimer = window.setTimeout(() => {
    state.flushTimer = null;
    scanAndReport('mutation');
  }, 300);
}

function bindObserver(): void {
  const root = findCommentRoot(document);
  if (!root) return;
  if (state.observer && state.root === root) return;
  state.observer?.disconnect();
  state.root = root;
  const observer = new MutationObserver(() => {
    if (!state.sessionId) return;
    if (!state.root || !state.root.isConnected) {
      // 评论容器被替换或卸载（例如详情弹层关闭）：保留快照，重新绑定
      state.root = findCommentRoot(document);
      if (state.root) bindObserver();
    }
    scheduleScan();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });
  state.observer = observer;
}

function start(sessionId: string, expectedNoteId: string): void {
  if (state.sessionId === sessionId) {
    bindObserver();
    scanAndReport('mutation');
    return;
  }
  stop();
  state.sessionId = sessionId;
  state.noteId = expectedNoteId || noteId();
  state.snapshot.clear();
  skippedHosts.clear();
  bindObserver();
  scanAndReport('initial');
}

function stop(): void {
  state.observer?.disconnect();
  state.observer = null;
  state.root = null;
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  state.sessionId = '';
  state.snapshot.clear();
}

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg?.type === MSG.beginScan) {
    start(msg.sessionId, msg.noteId);
    sendResponse({ ok: true, count: state.snapshot.size });
    return true;
  }
  if (msg?.type === MSG.scanNow) {
    bindObserver();
    scanAndReport('mutation');
    // 容器已卸载（用户切到管理页）时，至少把快照重新上报，管理页据此覆盖竞态丢失
    reportSnapshot();
    sendResponse({ ok: true, count: state.snapshot.size });
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
let lastReportedUrl = location.href;
window.addEventListener('popstate', onUrlMaybeChanged);
const originalPush = history.pushState;
history.pushState = function (...args) {
  originalPush.apply(this, args as Parameters<History['pushState']>);
  onUrlMaybeChanged();
};

function onUrlMaybeChanged(): void {
  if (location.href === lastReportedUrl) return;
  const prev = lastReportedUrl;
  lastReportedUrl = location.href;
  if (state.sessionId && noteId() !== state.noteId) {
    stop();
    try {
      chrome.runtime.sendMessage({ type: 'NOTE_CHANGED', from: prev, to: location.href }).catch(() => {});
    } catch {
      /* runtime 失效 */
    }
  }
}
