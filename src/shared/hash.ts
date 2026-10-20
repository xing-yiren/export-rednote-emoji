/** SHA-256 十六进制摘要，用于文件层去重。 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  let buf: ArrayBuffer;
  if (data instanceof Blob) buf = await data.arrayBuffer();
  else if (data instanceof Uint8Array) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  else buf = data;
  // 浏览器扩展提供 WebCrypto；非安全上下文则明确失败，不做静默降级
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 WebCrypto，无法计算 SHA-256');
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
