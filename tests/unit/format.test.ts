import { describe, expect, it } from 'vitest';
import { sniffImage } from '@/shared/format';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes(type), ...data, 0, 0, 0, 0];
}

describe('sniffImage', () => {
  it('识别静态 PNG 与尺寸', () => {
    const png = bytes([0x89], 'PNG\r\n\x1a\n', pngChunk('IHDR', [0, 0, 1, 0, 0, 0, 2, 0]), pngChunk('IDAT', [1, 2, 3]), pngChunk('IEND', []));
    const r = sniffImage(png);
    expect(r.format).toBe('png');
    expect(r.animated).toBe(false);
    expect([r.width, r.height]).toEqual([256, 512]);
  });

  it('识别 APNG（acTL 在 IDAT 之前）', () => {
    const apng = bytes([0x89], 'PNG\r\n\x1a\n', pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1]), pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), pngChunk('IDAT', []), pngChunk('IEND', []));
    expect(sniffImage(apng).animated).toBe(true);
  });

  it('载荷里出现 "acTL" 字样不算动画', () => {
    const fake = bytes([0x89], 'PNG\r\n\x1a\n', pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1]), pngChunk('IDAT', [...bytes('acTL')]), pngChunk('IEND', []));
    expect(sniffImage(fake).animated).toBe(false);
  });

  it('识别 JPEG', () => {
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 10, 0, 20, 1, 1, 0, 0]);
    const r = sniffImage(jpeg);
    expect(r.format).toBe('jpeg');
    expect([r.width, r.height]).toEqual([20, 10]);
  });

  it('识别单帧与多帧 GIF', () => {
    const header = [...bytes('GIF89a'), 0x10, 0, 0x10, 0, 0, 0, 0];
    const gce = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
    expect(sniffImage(bytes(header, gce)).animated).toBe(false);
    expect(sniffImage(bytes(header, gce, gce)).animated).toBe(true);
  });

  it('识别静态 WebP（VP8X + VP8）', () => {
    const webp = bytes('RIFF', [4, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0, 0, 0, 0, 0, 0x03, 0, 0, 0x01, 0, 0], 'VP8 ', [4, 0, 0, 0, 1, 2, 3, 4]);
    const r = sniffImage(webp);
    expect(r.format).toBe('webp');
    expect(r.animated).toBe(false);
    expect([r.width, r.height]).toEqual([4, 2]);
  });

  it('识别动画 WebP（ANIM chunk）', () => {
    const webp = bytes('RIFF', [4, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'ANIM', [6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(webp).animated).toBe(true);
  });

  it('载荷中出现 ANIM 字样不误判为动画', () => {
    const webp = bytes('RIFF', [4, 0, 0, 0], 'WEBP', 'VP8 ', [12, 0, 0, 0, ...bytes('ANIMimagin')]);
    expect(sniffImage(webp).animated).toBe(false);
  });

  it('空文件、HTML、SVG', () => {
    expect(sniffImage(new Uint8Array()).format).toBe('unknown');
    expect(sniffImage(bytes('<!DOCTYPE html><html>')).format).toBe('unknown');
    expect(sniffImage(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')).format).toBe('svg');
  });
});
