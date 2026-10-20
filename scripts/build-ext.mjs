/** 扩展构建：content 为 IIFE 单文件；管理页与 service worker 为 ES module。 */
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const root = resolve(here, '../src');
const outDir = resolve(here, '../dist');

rmSync(outDir, { recursive: true, force: true });

// 1) content script：MV3 不支持 ES module content script，必须自包含
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome120',
    lib: { entry: resolve(root, 'content/index.ts'), formats: ['iife'], name: 'RednoteContent', fileName: () => 'content.js' },
    minify: false,
  },
});

// 2) 管理页 + service worker + 静态资源
await build({ root, configFile: resolve(here, '../vite.config.ts'), logLevel: 'warn' });

// 3) manifest：注入版本号
const manifest = JSON.parse(readFileSync(resolve(here, '../public/manifest.json'), 'utf8'));
manifest.version = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version;
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('extension built -> dist/');
