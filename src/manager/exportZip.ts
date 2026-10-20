/**
 * ZIP 导出：使用 fflate，图片以 STORE（不重复压缩）方式打包。
 * 入口 zip 在管理页生成，ZIP 条目路径经安全清理，manifest 不含带签名的资源 URL。
 */
import { strToU8, zipSync } from 'fflate';
import { db } from '../services/db';
import { extensionForFormat, safeZipPath, sanitizeFilename } from '../shared/filename';
import { LIMITS, FetchError } from '../services/fetcher';
import type { Candidate } from '../shared/types';

export interface ZipManifestEntry {
  file: string;
  sha256: string;
  format: string;
  animated: boolean | null;
  width?: number;
  height?: number;
  byteLength: number;
  sources: Candidate['sources'];
  duplicateOf?: string;
}

export interface ZipResult {
  count: number;
  totalBytes: number;
  skipped: { id: string; reason: string }[];
  filename: string;
}

export async function exportZip(noteUrl: string, sessionId: string, selected: Candidate[]): Promise<ZipResult> {
  const ready = selected.filter((c) => c.status === 'ready' && c.assetHash);
  if (ready.length === 0) throw new Error('没有已就绪的图片可选');
  if (ready.length > LIMITS.maxZipItems) throw new Error(`单次最多导出 ${LIMITS.maxZipItems} 张`);

  const noteId = ready[0]!.noteId;
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const root = sanitizeFilename(`rednote-emoji_${noteId}_${ts}`, 60);
  const files: Record<string, Uint8Array> = {};
  const manifest: ZipManifestEntry[] = [];
  const failures: { id: string; reason: string }[] = [];
  const hashToFile = new Map<string, string>();
  let totalBytes = 0;
  let seq = 0;

  for (const c of ready) {
    const asset = await db.getAsset(c.assetHash!);
    if (!asset) {
      failures.push({ id: c.id, reason: '本地缓存缺失' });
      continue;
    }
    if (totalBytes + asset.byteLength > LIMITS.maxZipRawBytes) {
      failures.push({ id: c.id, reason: '超过单次 ZIP 原始文件总量上限' });
      continue;
    }
    seq++;
    let fileName: string;
    if (hashToFile.has(asset.sha256)) {
      fileName = hashToFile.get(asset.sha256)!;
    } else {
      const ext = extensionForFormat(asset.format);
      fileName = `images/${String(seq).padStart(4, '0')}_${asset.sha256.slice(0, 12)}.${ext}`;
      let n = 1;
      while (files[`${root}/${fileName}`]) fileName = `images/${String(seq).padStart(4, '0')}_${asset.sha256.slice(0, 12)}_${n++}.${ext}`;
      hashToFile.set(asset.sha256, fileName);
      const bytes = new Uint8Array(await asset.blob.arrayBuffer());
      files[safeZipPath(`${root}/${fileName}`)] = bytes;
      totalBytes += bytes.byteLength;
    }
    manifest.push({
      file: fileName,
      sha256: asset.sha256,
      format: asset.format,
      animated: asset.animated,
      width: asset.width,
      height: asset.height,
      byteLength: asset.byteLength,
      sources: c.sources,
      duplicateOf: files[`${root}/${fileName}`] ? undefined : fileName,
    });
  }

  if (manifest.length === 0) throw new Error('没有可导出的图片');

  const doc = {
    exportedAt: new Date().toISOString(),
    sessionId,
    noteUrl,
    tool: { name: 'export-rednote-emoji', version: chrome.runtime.getManifest().version },
    limitations: [
      '仅包含本页已渲染的评论图片，不代表整帖或收藏库全部图片',
      '保存的是实际获取的响应字节，格式可能已被平台转换为 WebP',
      'animated 为 null 表示无法判断',
    ],
    files: manifest,
  };
  files[safeZipPath(`${root}/manifest.json`)] = strToU8(JSON.stringify(doc, null, 2));
  files[safeZipPath(`${root}/failures.json`)] = strToU8(JSON.stringify(failures, null, 2));

  const zipped = zipSync(files, { level: 0 });
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: sanitizeFilename(`${root}.zip`, 80),
      conflictAction: 'uniquify',
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  if (totalBytes > LIMITS.maxZipRawBytes) throw new FetchError('too_large', '超过总量上限');
  return { count: manifest.length, totalBytes, skipped: failures, filename: `${root}.zip` };
}
