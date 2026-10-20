## 小红书表情包导出 v0.1.0

首个可用版本。把小红书评论区的表情图片采集下来，预览、筛选、去重后导出到本地。

### 安装

**macOS（推荐）**

1. 下载 `RednoteEmoji-0.1.0.dmg`
2. 双击挂载，把「安装小红书表情包导出」拖进「应用程序」
3. 双击运行；首次提示"无法验证开发者"时请 **右键 → 打开**
4. 安装器会把扩展复制到 `~/Library/Application Support/RednoteEmoji/extension`、路径写入剪贴板，并打开扩展管理页
5. 在 `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ **⌘⇧G** 粘贴路径 → 选择

**其它平台 / 从源码构建**

```bash
git clone https://github.com/xing-yiren/export-rednote-emoji.git
cd export-rednote-emoji
npm install && npm run build
```

在扩展管理页「加载已解压的扩展程序」选择 `dist/`。

> 浏览器不允许非商店扩展双击直装，这是 Chrome/Edge 的安全策略；安装包已把其余步骤自动化。

### 功能

- 扫描笔记详情页面已渲染的评论图片，排除头像、笔记主图与界面图标
- 增量采集：滚动或展开评论时自动捕获新图片
- 网格预览、按作者筛选、按状态筛选、多选/全选
- 单张保存或批量导出 ZIP（含 `manifest.json` 与 `failures.json`）
- 按字节签名识别 PNG / JPEG / GIF / WebP / AVIF，如实标注动画状态
- SHA-256 内容去重：重复图片只输出一份，全部来源保留在 manifest
- 并发 3、瞬时失败自动重试 2 次、429 尊重 `Retry-After`、401/403 不盲重试
- 取消、刷新恢复、多管理页租约防重复下载

### 已知限制

- 只采集**已渲染**的评论图片，不等于整帖所有评论或手机收藏库
- **动图在网页端是静态帧**：平台把评论图统一转码为 WebP（实测无 `ANIM` chunk），本工具只保存实际获取到的字节
- 图片链接有时效，过期需回源页面重新加载后重新采集
- 单会话 500 个候选；单文件 20 MiB；单次 ZIP 200 张或 100 MiB
- 刷新页面或在 SPA 中切换笔记后，需重新点击扩展图标

### 验证状态

- 单元测试 49 项通过
- Chrome 155.0.8059.85（macOS）实测：采集、获取、单张保存、ZIP 导出、取消、多页租约、页面刷新与笔记切换提示
- Edge：**待实测**

### 隐私

最小权限：`activeTab`、`scripting`、`storage`、`downloads`，以及对 `sns-webpic-qc.xhscdn.com` 的读取权限。不读取 Cookie、不上传数据、不申请 `<all_urls>`。

完整说明见 [README](https://github.com/xing-yiren/export-rednote-emoji#readme)。

### 校验值（SHA-256）

```text
3b6f4270bfaf6bb28dacfaed8b70333adbbf879c2ef8eb8f69e2cd1c036d03dd  RednoteEmoji-0.1.0.dmg
27587bd21910d7ccb74128e85f5a29be474662cc74483ae87b7fb52f10b172ea  RednoteEmoji-0.1.0.zip
```
