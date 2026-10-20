/**
 * 按字节签名识别图片格式，并解析动画标记。
 * 只依据响应字节，不信任 Content-Type 与扩展名。
 */
import type { AssetFormat } from './types';

export interface SniffResult {
  format: AssetFormat;
  animated: boolean | null;
  width?: number;
  height?: number;
  detail?: Record<string, unknown>;
}

const TEXT_DECODER = new TextDecoder('latin1');

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return TEXT_DECODER.decode(bytes.subarray(offset, offset + length));
}

function u32le(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

export function sniffImage(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) return { format: 'unknown', animated: null, detail: { reason: 'empty' } };

  // PNG / APNG
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') {
    const { width, height } = pngSize(bytes);
    return { format: 'png', animated: pngHasActl(bytes) ? true : false, width, height };
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { format: 'jpeg', animated: false, ...jpegSize(bytes) };
  }
  // GIF
  if (ascii(bytes, 0, 3) === 'GIF') {
    const w = bytes[6]! | (bytes[7]! << 8);
    const h = bytes[8]! | (bytes[9]! << 8);
    const frames = countGifFrames(bytes);
    return { format: 'gif', animated: frames > 1, width: w, height: h, detail: { frames } };
  }
  // WebP：严格遍历 RIFF chunk，避免在载荷中误匹配 'ANIM'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return parseWebp(bytes);
  }
  // AVIF / HEIF
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (/^avi[fs]$/.test(brand)) return { format: 'avif', animated: null };
  }
  const head = ascii(bytes, 0, 160);
  if (head.trimStart().startsWith('<svg') || (head.trimStart().startsWith('<?xml') && ascii(bytes, 0, 600).includes('<svg'))) {
    return { format: 'svg', animated: null };
  }
  if (head.trimStart().startsWith('<')) {
    return { format: 'unknown', animated: null, detail: { reason: 'html' } };
  }
  return { format: 'unknown', animated: null };
}

function pngSize(b: Uint8Array): { width: number; height: number } {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return { width: 0, height: 0 };
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** 仅在 chunk 边界查找 acTL，不搜索压缩数据。 */
function pngHasActl(b: Uint8Array): boolean {
  let pos = 8;
  while (pos + 8 <= b.length) {
    const len = u32be(b, pos);
    const type = ascii(b, pos + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    pos += 12 + len;
    if (len > b.length) return false;
  }
  return false;
}

function countGifFrames(b: Uint8Array): number {
  let frames = 0;
  for (let i = 0; i < b.length - 1 && frames < 2; i++) {
    if (b[i] === 0x21 && b[i + 1] === 0xf9) frames++;
  }
  return frames;
}

function jpegSize(b: Uint8Array): { width?: number; height?: number } {
  let pos = 2;
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = b[pos + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[pos + 5]! << 8) | b[pos + 6]!, width: (b[pos + 7]! << 8) | b[pos + 8]! };
    }
    const len = (b[pos + 2]! << 8) | b[pos + 3]!;
    if (len < 2) break;
    pos += 2 + len;
  }
  return {};
}

function parseWebp(b: Uint8Array): SniffResult {
  let pos = 12;
  let hasAnim = false;
  let width: number | undefined;
  let height: number | undefined;
  const chunks: string[] = [];
  while (pos + 8 <= b.length && chunks.length < 64) {
    const cc = ascii(b, pos, 4);
    const size = u32le(b, pos + 4);
    chunks.push(cc);
    if (cc === 'ANIM') hasAnim = true;
    if (cc === 'VP8X' && pos + 18 <= b.length) {
      width = 1 + (b[pos + 12]! | (b[pos + 13]! << 8) | (b[pos + 14]! << 16));
      height = 1 + (b[pos + 15]! | (b[pos + 16]! << 8) | (b[pos + 17]! << 16));
    }
    if (cc === 'VP8 ' && pos + 18 <= b.length) {
      width ??= (b[pos + 14]! | (b[pos + 15]! << 8)) & 0x3fff;
      height ??= (b[pos + 16]! | (b[pos + 17]! << 8)) & 0x3fff;
    }
    if (size > b.length) break;
    pos += 8 + size + (size & 1);
  }
  return { format: 'webp', animated: hasAnim, width, height, detail: { chunks } };
}

/** 是否为静态图片字节（用于判断能否安全预览）。 */
export function isImageFormat(format: AssetFormat): boolean {
  return format !== 'unknown';
}
