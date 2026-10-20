/**
 * 下载：从已验证 Blob 创建 URL，交给 downloads API，并在完成/失败后释放。
 */
import { db } from './db';
import { extensionForFormat } from '../shared/filename';
import type { Candidate } from '../shared/types';

export function singleFileName(c: Candidate, format: string): string {
  const hash = (c.assetHash ?? c.id).slice(0, 12);
  return `rednote-emoji_${c.noteId}_${hash}.${extensionForFormat(format)}`;
}

export interface DownloadResult {
  downloadId: number;
}

export async function downloadCandidate(c: Candidate): Promise<DownloadResult> {
  if (!c.assetHash) throw new Error('图片尚未获取');
  const asset = await db.getAsset(c.assetHash);
  if (!asset) throw new Error('本地缓存中找不到该图片，请重新获取');
  const url = URL.createObjectURL(asset.blob);
  const filename = singleFileName(c, asset.format);
  let downloadId: number;
  try {
    downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  // 不能立即回收 URL：等待下载状态变为 complete/interrupted
  const release = (): void => URL.revokeObjectURL(url);
  const listener = (delta: chrome.downloads.DownloadDelta): void => {
    if (delta.id !== downloadId) return;
    if (delta.state?.current === 'complete') {
      chrome.downloads.onChanged.removeListener(listener);
      release();
    } else if (delta.state?.current === 'interrupted') {
      chrome.downloads.onChanged.removeListener(listener);
      release();
    }
  };
  chrome.downloads.onChanged.addListener(listener);
  const { downloadJobs } = await chrome.storage.local.get('downloadJobs');
  const jobs = (downloadJobs as Record<string, { state: string; candidateId: string }>) ?? {};
  jobs[String(downloadId)] = { state: 'in_progress', candidateId: c.id };
  await chrome.storage.local.set({ downloadJobs: jobs });
  return { downloadId };
}
