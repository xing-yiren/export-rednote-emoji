/** 文件名清理：去除路径分隔符、控制字符与 Windows/macOS 保留名称。 */

const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function sanitizeFilename(name: string, maxLength = 80): string {
  let s = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (!s) s = 'file';
  const extMatch = /(\.[a-z0-9]{2,5})$/i.exec(s);
  const ext = extMatch?.[1] ?? '';
  const base = ext ? s.slice(0, -ext.length) : s;
  const stem = base.slice(0, Math.max(1, maxLength - ext.length));
  if (RESERVED.has(stem.toLowerCase())) return `_${stem}${ext}`;
  return stem + ext;
}

const FORMAT_EXT: Record<string, string> = {
  png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', avif: 'avif', svg: 'svg', unknown: 'bin',
};

export function extensionForFormat(format: string): string {
  return FORMAT_EXT[format] ?? 'bin';
}

/** ZIP 条目路径：禁止绝对路径与 `..`。 */
export function safeZipPath(path: string): string {
  const parts = path.split('/').filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/');
}
