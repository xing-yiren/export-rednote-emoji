/**
 * ZIP 导出：构建导出计划（纯逻辑）+ Web Worker 打包 + downloads API。
 * 图片以 STORE 方式打包（不重复压缩），manifest 不含带签名的资源 URL。
 */
import { strToU8 } from 'fflate';
import { db } from '../services/db';
import { LIMITS } from '../services/fetcher';
import { buildExportPlan, type PlanInput } from '../shared/zipPlan';
import type { ZipWorkerRequest, ZipWorkerResponse } from '../workers/zip-worker';
import type { Candidate } from '../shared/types';

export interface ZipResult {
  count: number;
  totalBytes: number;
  skipped: { id: string; reason: string }[];
  fileName: string;
}

function packInWorker(files: Record<string, Uint8Array>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/zip-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ZipWorkerResponse>) => {
      worker.terminate();
      if (e.data.ok && e.data.blob) resolve(e.data.blob);
      else reject(new Error(e.data.error ?? 'ZIP 打包失败'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`ZIP 工作线程错误：${e.message}`));
    };
    worker.postMessage({ files } satisfies ZipWorkerRequest);
  });
}

/** 生成 ZIP 并调用下载；返回结果供界面展示。 */
export async function exportZip(noteUrl: string, sessionId: string, selected: Candidate[]): Promise<ZipResult> {
  const ready = selected.filter((c) => c.status === 'ready' && c.assetHash);
  if (ready.length === 0) throw new Error('没有已就绪的图片可选');
  if (ready.length > LIMITS.maxZipItems) throw new Error(`单次最多导出 ${LIMITS.maxZipItems} 张`);

  // 读取字节（顺序 I/O，避免一次性占用过多内存）
  const inputs: PlanInput[] = [];
  const missing: { id: string; reason: string }[] = [];
  for (const c of ready) {
    const asset = await db.getAsset(c.assetHash!);
    if (!asset) {
      missing.push({ id: c.id, reason: '本地缓存缺失' });
      continue;
    }
    inputs.push({
      candidateId: c.id,
      sources: c.sources,
      asset: {
        sha256: asset.sha256,
        format: asset.format,
        animated: asset.animated,
        width: asset.width,
        height: asset.height,
        byteLength: asset.byteLength,
        bytes: new Uint8Array(await asset.blob.arrayBuffer()),
      },
    });
  }

  const plan = buildExportPlan(ready[0]!.noteId, new Date(), inputs, LIMITS);
  if (plan.count === 0) throw new Error('没有可导出的图片');
  plan.failures.push(...missing);

  const doc = {
    exportedAt: new Date().toISOString(),
    sessionId,
    noteUrl,
    tool: { name: 'export-rednote-emoji', version: chrome.runtime.getManifest().version },
    limitations: [
      '仅包含本页已渲染的评论图片，不代表整帖或收藏库全部图片',
      '保存的是实际获取的响应字节，格式可能已被平台转换为 WebP',
      'animated 为 null 表示无法判断',
      '小红书服务端会将评论图片统一转码为 WebP；P0 实测未见动画 WebP（无 ANIM chunk），手机端显示的动图在网页端资源通常为静态帧',
      '不包含带签名的资源地址、Cookie 或完整评论文本',
    ],
    files: plan.manifest,
  };
  const files = {
    ...plan.files,
    [`${plan.root}/manifest.json`]: strToU8(JSON.stringify(doc, null, 2)),
    [`${plan.root}/failures.json`]: strToU8(JSON.stringify(plan.failures, null, 2)),
  };

  const blob = await packInWorker(files);
  const fileName = `${plan.root}.zip`;
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: fileName, conflictAction: 'uniquify', saveAs: false });
  } finally {
    // 下载 API 已接管 URL；延迟释放以防读取尚未完成
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return { count: plan.count, totalBytes: plan.totalBytes, skipped: plan.failures, fileName };
}
