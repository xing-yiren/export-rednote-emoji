// 构建 P0 探针扩展到 dist-probe/，用于手动加载验证。
import { cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('dist-probe', { recursive: true, force: true });
mkdirSync('dist-probe', { recursive: true });
cpSync('scripts/probe-src', 'dist-probe', { recursive: true });
console.log('probe built -> dist-probe/');
