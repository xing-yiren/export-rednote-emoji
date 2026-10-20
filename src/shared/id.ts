/** 生成随机 ID（扩展上下文可安全使用 crypto）。 */
export function randomId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}
