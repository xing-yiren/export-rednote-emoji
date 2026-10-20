/** 候选合并与去重（纯逻辑，可在 node 中测试）。 */
import type { CandidateSource, ScannedImage } from './types';
import { resourceDedupeKey } from './url';

export interface MergeResult {
  created: ScannedImage[];
  /** key = 去重后的资源地址 */
  merged: Map<string, CandidateSource[]>;
}

function sourceKey(s: CandidateSource): string {
  return [s.commentId ?? '', s.authorId ?? '', s.position ?? ''].join('|');
}

export function mergeSources(a: CandidateSource[], b: CandidateSource[]): CandidateSource[] {
  const seen = new Set(a.map(sourceKey));
  const out = [...a];
  for (const s of b) {
    const k = sourceKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * 对已在库中的 URL 集合做增量合并。
 * @param existing 已登记的 key -> sources
 * @param incoming 本次扫描结果
 */
/** 已在库中的条目：可直接给 sources 数组，也可给带 id 的记录（只读 sources）。 */
export type ExistingEntry = CandidateSource[] | { sources: CandidateSource[] };

export function mergeScan(existing: Map<string, ExistingEntry>, incoming: ScannedImage[]): MergeResult {
  const created: ScannedImage[] = [];
  const merged = new Map<string, CandidateSource[]>();
  // 同一次扫描内部也按 URL 合并
  const fresh = new Map<string, ScannedImage>();
  for (const img of incoming) {
    const key = resourceDedupeKey(img.url);
    const prev = fresh.get(key);
    if (prev) prev.sources = mergeSources(prev.sources, img.sources);
    else fresh.set(key, { url: img.url, sources: [...img.sources] });
  }
  for (const [key, img] of fresh) {
    const prev = existing.get(key);
    if (prev) {
      merged.set(key, mergeSources(Array.isArray(prev) ? prev : prev.sources, img.sources));
    } else {
      created.push(img);
    }
  }
  return { created, merged };
}
