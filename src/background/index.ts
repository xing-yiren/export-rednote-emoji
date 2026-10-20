/**
 * Service worker：点击入口、按需注入、会话路由、下载事件。
 * 不保存任务真相；所有状态落在 IndexedDB / chrome.storage.local。
 */
import { isNoteUrl, parseNoteId } from '../shared/url';
import { randomId } from '../shared/id';
import { MSG } from '../shared/types';

const MANAGER_URL = chrome.runtime.getURL('manager/index.html');

interface ActiveSession {
  sessionId: string;
  tabId: number;
  noteId: string;
  noteUrl: string;
}

async function getActive(): Promise<ActiveSession | null> {
  const { activeSession } = await chrome.storage.local.get('activeSession');
  return (activeSession as ActiveSession | undefined) ?? null;
}

async function setActive(s: ActiveSession | null): Promise<void> {
  await chrome.storage.local.set({ activeSession: s });
}

function unsupported(tabId: number, text: string): void {
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#c33' });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 4000);
  void chrome.scripting.executeScript({
    target: { tabId },
    func: (t: string) => window.alert(t),
    args: [text],
  }).catch(() => {});
}

async function ensureHostPermission(): Promise<boolean> {
  const origins = ['https://sns-webpic-qc.xhscdn.com/*'];
  const has = await chrome.permissions.contains({ origins });
  if (has) return true;
  return chrome.permissions.request({ origins });
}

/** 打开或聚焦管理页。 */
async function openManager(focusSessionId?: string): Promise<void> {
  const url = focusSessionId ? `${MANAGER_URL}#${focusSessionId}` : MANAGER_URL;
  const tabs = await chrome.tabs.query({ url: `${MANAGER_URL}*` });
  const existing = tabs[0];
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    if (focusSessionId) await chrome.tabs.update(existing.id, { url });
    return;
  }
  await chrome.tabs.create({ url });
}

async function startCollection(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id!;
  const url = tab.url ?? '';
  if (!isNoteUrl(url)) {
    unsupported(tabId, '请在已打开的小红书笔记详情页（/explore/...）使用本扩展。');
    return;
  }
  const noteId = parseNoteId(url);
  if (!noteId) {
    unsupported(tabId, '无法从当前地址识别笔记 ID。');
    return;
  }
  const prev = await getActive();
  const sessionId = randomId('s');
  const noteUrl = new URL(url);
  const session: ActiveSession = { sessionId, tabId, noteId, noteUrl: noteUrl.href };
  await ensureHostPermission();
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content.js'],
    });
  } catch (e) {
    unsupported(tabId, `无法注入采集脚本：${String(e)}`);
    return;
  }
  if (prev && prev.sessionId !== sessionId) {
    await chrome.tabs.sendMessage(prev.tabId, { type: MSG.endScan }).catch(() => {});
  }
  await setActive(session);
  await chrome.tabs.sendMessage(tabId, { type: MSG.beginScan, sessionId, noteId }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: '●' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2a7' });
  await openManager(sessionId);
}

chrome.action.onClicked.addListener((tab) => {
  void startCollection(tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === MSG.scanResult) {
      const payload = msg.payload;
      const active = await getActive();
      // 校验消息归属：tab、会话、笔记都必须匹配
      if (!active || !sender.tab || sender.tab.id !== active.tabId || payload.sessionId !== active.sessionId || payload.noteId !== active.noteId) {
        sendResponse({ ok: false, reason: 'stale' });
        return;
      }
      await chrome.runtime.sendMessage({ type: 'SCAN_FORWARD', payload }).catch(() => {
        // 管理页未打开时丢弃（管理页打开后会重新发送 SCAN_NOW）
      });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === MSG.stopCollection) {
      const active = await getActive();
      if (active) {
        await chrome.tabs.sendMessage(active.tabId, { type: MSG.endScan }).catch(() => {});
        await setActive(null);
        await chrome.action.setBadgeText({ tabId: active.tabId, text: '' }).catch(() => {});
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'NOTE_CHANGED') {
      const active = await getActive();
      if (active) {
        await setActive({ ...active, noteUrl: msg.to });
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === MSG.openManager) {
      await openManager();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'GET_ACTIVE_SESSION') {
      sendResponse({ ok: true, active: await getActive() });
      return;
    }
    if (msg?.type === 'SCAN_NOW') {
      const active = await getActive();
      if (!active) {
        sendResponse({ ok: false, reason: 'no_session' });
        return;
      }
      const tab = await chrome.tabs.get(active.tabId).catch(() => null);
      if (!tab) {
        await setActive(null);
        sendResponse({ ok: false, reason: 'tab_closed' });
        return;
      }
      if (tab.url !== active.noteUrl && !isNoteUrl(tab.url ?? '')) {
        sendResponse({ ok: false, reason: 'left_note', active });
        return;
      }
      try {
        await chrome.tabs.sendMessage(active.tabId, { type: MSG.scanNow });
        sendResponse({ ok: true, active });
      } catch {
        // 页面刷新后内容脚本已不存在：明确告知需要重新点击扩展图标
        sendResponse({ ok: false, reason: 'script_gone', active });
      }
      return;
    }
    sendResponse({ ok: false });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// 下载状态记录到 storage，供管理页恢复时查询
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state?.current) return;
  const { downloadJobs } = await chrome.storage.local.get('downloadJobs');
  const jobs = (downloadJobs as Record<string, { state: string }>) ?? {};
  if (jobs[String(delta.id)]) {
    jobs[String(delta.id)] = { state: delta.state.current };
    await chrome.storage.local.set({ downloadJobs: jobs });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const active = await getActive();
  if (active?.tabId === tabId) await setActive(null);
});
