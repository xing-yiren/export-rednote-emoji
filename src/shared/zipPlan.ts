/** 导出计划构建（纯逻辑）：文件命名、去重、限额与 manifest 组装。 */
import { extensionForFormat, safeZipPath } from './filename';

export interface PlanAsset {
  sha256: string;
  format: string;
  animated: boolean | null;
  width?: number;
  height?: number;
  byteLength: number;
  bytes: Uint8Array;
}

export interface PlanInput {
  candidateId: string;
  asset: PlanAsset;
  sources: unknown[];
}

export interface PlanLimits {
  maxZipRawBytes: number;
  maxZipItems: number;
}

export interface PlanManifestEntry {
  file: string;
  sha256: string;
  format: string;
  animated: boolean | null;
  width?: number;
  height?: number;
  byteLength: number;
  sources: unknown[];
  duplicateOf?: string;
}

export interface ExportPlan {
  root: string;
  files: Record<string, Uint8Array>;
  manifest: PlanManifestEntry[];
  failures: { id: string; reason: string }[];
  totalBytes: number;
  count: number;
}

/**
 * 构建导出计划。
 * - 同哈希只写一份文件，所有来源记录进 manifest，并标记 duplicateOf
 * - 超过原始总量/张数限制的候选记入 failures，不中断已选中的其它项
 */
export function buildExportPlan(
  noteId: string,
  timestamp: Date,
  inputs: PlanInput[],
  limits: PlanLimits,
): ExportPlan {
  const ts = timestamp.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const root = `rednote-emoji_${noteId}_${ts}`;
  const files: Record<string, Uint8Array> = {};
  const manifest: PlanManifestEntry[] = [];
  const failures: { id: string; reason: string }[] = [];
  const exportedHash = new Map<string, string>();
  let totalBytes = 0;
  let seq = 0;

  for (const input of inputs) {
    const a = input.asset;
    const existing = exportedHash.get(a.sha256);
    if (existing) {
      manifest.push(entry(existing, input, existing));
      continue;
    }
    if (manifest.length >= limits.maxZipItems) {
      failures.push({ id: input.candidateId, reason: `超过单次 ${limits.maxZipItems} 张上限` });
      continue;
    }
    if (totalBytes + a.byteLength > limits.maxZipRawBytes) {
      failures.push({ id: input.candidateId, reason: '超过单次 ZIP 原始文件总量上限' });
      continue;
    }
    seq++;
    const file = `images/${String(seq).padStart(4, '0')}_${a.sha256.slice(0, 12)}.${extensionForFormat(a.format)}`;
    files[safeZipPath(`${root}/${file}`)] = a.bytes;
    exportedHash.set(a.sha256, file);
    totalBytes += a.byteLength;
    manifest.push(entry(file, input));
  }

  return { root, files, manifest, failures, totalBytes, count: manifest.length };
}

function entry(file: string, input: PlanInput, duplicateOf?: string): PlanManifestEntry {
  const a = input.asset;
  return {
    file,
    sha256: a.sha256,
    format: a.format,
    animated: a.animated,
    width: a.width,
    height: a.height,
    byteLength: a.byteLength,
    sources: input.sources,
    duplicateOf,
  };
}
