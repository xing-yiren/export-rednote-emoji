# export-rednote-emoji

从小红书网页评论区采集表情图片并导出到本地的 Chrome/Edge 扩展（Manifest V3）。

- 技术方案：[TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)
- P0 验证记录：[docs/VALIDATION.md](./docs/VALIDATION.md)

## 开发

```sh
npm install
npm test          # 单元测试
npm run build     # 构建扩展到 dist/
npm run build:probe  # 构建 P0 探针到 dist-probe/
```

浏览器加载：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → `dist/`。
