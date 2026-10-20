/// <reference lib="webworker" />
/** ZIP 打包工作线程：接收已构建好的条目，STORE 打包后返回 Blob。 */
import { zipSync } from 'fflate';

export interface ZipWorkerRequest {
  files: Record<string, Uint8Array>;
}

export interface ZipWorkerResponse {
  ok: boolean;
  blob?: Blob;
  error?: string;
}

self.onmessage = (e: MessageEvent<ZipWorkerRequest>) => {
  try {
    const zipped = zipSync(e.data.files, { level: 0 });
    const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
    (self as unknown as Worker).postMessage({ ok: true, blob } satisfies ZipWorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) } satisfies ZipWorkerResponse);
  }
};
