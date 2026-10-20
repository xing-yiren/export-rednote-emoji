import { describe, expect, it } from 'vitest';
import { buildExportPlan, type PlanInput } from '@/shared/zipPlan';
import { zipSync, strToU8, unzipSync } from 'fflate';

const asset = (sha: string, size: number, format = 'webp') => ({
  sha256: sha,
  format,
  animated: false,
  width: 10,
  height: 20,
  byteLength: size,
  bytes: new Uint8Array(size).fill(1),
});

const input = (id: string, sha: string, size = 10, commentId = id): PlanInput => ({
  candidateId: id,
  asset: asset(sha, size),
  sources: [{ commentId }],
});

const LIMITS = { maxZipRawBytes: 100, maxZipItems: 200 };
const T = new Date('2026-10-20T10:00:00Z');

describe('导出计划', () => {
  it('生成约定目录结构', () => {
    const p = buildExportPlan('note1', T, [input('c1', 'a'.repeat(64))], LIMITS);
    expect(p.root).toBe('rednote-emoji_note1_20261020100000');
    expect(Object.keys(p.files)).toEqual([`rednote-emoji_note1_20261020100000/images/0001_${'a'.repeat(12)}.webp`]);
    expect(p.manifest[0]?.file).toBe(`images/0001_${'a'.repeat(12)}.webp`);
  });

  it('同哈希只写一份文件且保留全部来源', () => {
    const sha = 'b'.repeat(64);
    const p = buildExportPlan('n', T, [input('c1', sha, 10, 'cmt1'), input('c2', sha, 10, 'cmt2')], LIMITS);
    expect(Object.keys(p.files)).toHaveLength(1);
    expect(p.manifest).toHaveLength(2);
    expect(p.manifest[1]?.duplicateOf).toBe(p.manifest[0]?.file);
    expect(p.manifest[0]?.sources).toEqual([{ commentId: 'cmt1' }]);
    expect(p.manifest[1]?.sources).toEqual([{ commentId: 'cmt2' }]);
  });

  it('超出总量限制的项进入 failures，不影响其它项', () => {
    const p = buildExportPlan('n', T, [input('c1', 'a'.repeat(64), 60), input('c2', 'c'.repeat(64), 60), input('c3', 'd'.repeat(64), 10)], LIMITS);
    expect(p.count).toBe(2);
    expect(p.failures).toEqual([{ id: 'c2', reason: '超过单次 ZIP 原始文件总量上限' }]);
    expect(p.totalBytes).toBe(70);
  });

  it('超出张数限制进入 failures', () => {
    const p = buildExportPlan('n', T, [input('c1', 'a'.repeat(64)), input('c2', 'b'.repeat(64))], { ...LIMITS, maxZipItems: 1 });
    expect(p.count).toBe(1);
    expect(p.failures[0]?.reason).toContain('张上限');
  });

  it('打包后解压哈希一致', () => {
    const p = buildExportPlan('n', T, [input('c1', 'a'.repeat(64))], LIMITS);
    const zipped = zipSync({ ...p.files, [`${p.root}/manifest.json`]: strToU8(JSON.stringify(p.manifest)) }, { level: 0 });
    const out = unzipSync(zipped);
    const key = Object.keys(out).find((k) => k.endsWith('.webp'))!;
    expect(key).not.toContain('..');
    expect(out[key]!.length).toBe(10);
    expect(JSON.parse(new TextDecoder().decode(out[`${p.root}/manifest.json`]!))).toHaveLength(1);
  });
});
