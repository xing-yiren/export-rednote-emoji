# P0 真实验证记录

日期：2026-10-20（进行中）
环境：macOS / Google Chrome 155.0.8059.85 / Edge 未安装

## 验证步骤（人工）

1. 打开 `chrome://extensions`，开启“开发者模式” → “加载已解压的扩展程序” → 选择 `dist-probe/`。
2. 在浏览器中登录小红书，打开一个包含目标评论和表情图片的笔记（最好包含：静态图、动图、一级评论、回复评论）。
3. 手动展开需要的评论，确保表情图片已渲染在页面上。
4. 点击扩展图标 → 允许权限（会请求 https 资源域读取）→ 页面右下角出现探针面板。
5. 点击“下载 JSON”，将文件保存到 `~/Downloads/`。
6. 告诉 Claude 已完成；随后执行 `cp ~/Downloads/rednote-probe-*.json docs/` 供分析。

## 待验证项

- [ ] 评论容器与评论项的实际 DOM 选择器
- [ ] 作者链接中的稳定用户 ID
- [ ] 表情图片与头像、笔记主图的区分依据
- [ ] 候选资源 URL 的 host / CDN 域名
- [ ] 扩展 fetch 字节：状态码、Content-Type、格式签名、尺寸、动画
- [ ] 跨源 / 签名 URL / 重定向 / blob / 懒加载边界
- [ ] Edge 最低实测版本

## 结果

## 探针结果分析（2026-10-20，样本：docs/rednote-probe-1792481066812.json）

页面：`https://www.xiaohongshu.com/explore/6ad715b3000000000c00e6f9?...`，标题“收藏一些自己很喜欢的表情包”。

### DOM 结构（已核实）

| 元素 | 选择器 | 备注 |
| --- | --- | --- |
| 笔记详情根 | `#noteContainer.note-container` | 与页面其他区域（用户主页 feeds）共存 |
| 评论滚动区 | `.interaction-container .note-scroller` | 评论列表与笔记正文共享该滚动区 |
| 评论项 | `.comment-item`，`id="comment-<commentId>"` | **评论 ID 稳定可用**；CP 形如 `6ad715eb0000000012032744` |
| 一级/回复 | `.parent-comment` 包裹一级评论 | 回复结构待补充样本 |
| 作者头像 | `.comment-item .avatar img.avatar-item` | `data-user-id="..."` **稳定用户 ID** |
| 作者链接 | `.comment-item .avatar a[href="/user/profile/<userId>?..."]` | 同时带 xsec_token |
| 评论图片 | `.comment-item .comment-picture .img-box img.inner` | 仅此位置为评论正文图片 |

区分依据：**用结构（`.comment-picture` 作用域）区分，而非尺寸**。头像约为 120x120（消费 40x40），评论图 naturalSize 曲线为 358~640，但布局尺寸会缩放到 120~160，不能凭布局尺寸判断。

### 资源与网络（已核实）

- 评论图 host：`sns-webpic-qc.xhscdn.com`；头像 host：`sns-avatar-qc.xhscdn.com`；UI 图标：`fe-static.xhscdn.com`。
- URL 形如 `https://sns-webpic-qc.xhscdn.com/<yyyymmddhhmm>/<md5>/comment/<imageId>!nc_n_webp_mw_1`，带时效路径段（日期）与签名式前缀，**不带 xsec_token 亦可在新标签页直接请求**。
- 扩展上下文 `fetch(... credentials:'omit')` 全部 200，**无需 Cookie、无 CORS 问题**（需 host permission）。
- 去掉 `!nc_n_webp_mw_1` 或换成其它后缀均 **403**：不能推测原始格式 URL，只能保存实际拿到的响应字节。
- 服务端**统一返回 WebP**（`image/webp`），即评论图即便原为 PNG/GIF，前端拿到的也是 WebP；动态性只能依据该 WebP 是否含 `ANIM` chunk 判断。
- 未发现 canvas 渲染；无 blob URL。懒加载属性仅 `src`（原文为 http，浏览器升级为 https）。

### 格式探测实现修正

- 初版 WebP 动画探测用子串搜索 `ANIM`，在压缩数据中误报（“imagin” 等）。已改为**严格 RIFF chunk 遍历**。
- SVG 曾被误判为 HTML；已按 `<?xml`/`<svg` 前缀识别。
- 样本中评论图均为**静态 WebP**（chunks: VP8X/ALPH/ICCP/VP8 /EXIF，无 ANIM）。

### 环境

- macOS，Google Chrome 155.0.8059.85。Edge 未安装，P3 再测。

### 动画结论（2026-10-20 用户反馈后补充）

用户反馈：手机 App 中显示的动图表情，网页端显示为静态图。

结合探针结论：评论图 `src` 属性本身即为 `...!nc_n_webp_mw_1` 形态，全部响应为单帧 WebP（chunk: `VP8X`/`VP8 `/`EXIF`，无 `ANIM`）；去掉后缀或替换为其它后缀均 403。网页端右键图片也无可用的“复制图片地址”项（图层覆盖）。

**结论**：平台对评论图片统一转码，网页端资源不含动画帧。本工具不尝试猜测原始地址、不使用 canvas 录帧。管理页与导出 manifest 中对动画状态据实标注，并写明此限制。

### 待补充样本

- [x] 动态表情（GIF/动画 WebP）在评论中的字节与 ANIM chunk 情况 —— 网页端不可得，见上文
- [ ] 回复评论 DOM 结构（`.comment-item` 下回复列表）
- [ ] 大图/长图注释下评论图片加载上限
- [ ] 权限收敛：实测只需 `https://sns-webpic-qc.xhscdn.com/*` + `https://www.xiaohongshu.com/*`

