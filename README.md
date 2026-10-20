# export-rednote-emoji

从小红书网页评论区采集表情图片并导出到本地的 Chrome/Edge 扩展（Manifest V3）。

- 技术方案：[TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)
- P0 验证记录：[docs/VALIDATION.md](./docs/VALIDATION.md)

## 已知限制

- **动图**：小红书服务端将评论图片统一转码为 WebP（P0 实测无 `ANIM` chunk），手机 App 中的动图在网页端通常是静态帧，本工具只能保存网页端实际获取到的字节。
- 仅采集**已渲染**的评论图片（需手动滚动/展开），不代表整帖或收藏库全部。
- 平台返回 HTML/403 时（链接过期、需重新加载页面）会如实标记失败，不做猜测性重试。

## 文档

- 使用与安装：[docs/USAGE.md](./docs/USAGE.md)
- P0 验证记录：[docs/VALIDATION.md](./docs/VALIDATION.md)

## 开发

```sh
npm install
npm test          # 单元测试
npm run build     # 构建扩展到 dist/
npm run typecheck # 类型检查
npm run build:probe  # 构建 P0 探针到 dist-probe/
```

浏览器加载：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → `dist/`。
