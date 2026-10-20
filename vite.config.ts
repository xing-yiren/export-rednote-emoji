import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 管理页与 service worker 的构建配置；content script 由 scripts/build-ext.mjs 单独以 IIFE 构建。
export default defineConfig({
  root: 'src',
  // 扩展页面以 chrome-extension://<id>/ 为根，资源使用相对路径
  base: '',
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, 'public'),
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome120',
    // 管理页位于 /manager/，资源需以相对路径引用
    assetsDir: '../assets',
    rollupOptions: {
      input: {
        manager: resolve(import.meta.dirname, 'src/manager/index.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
