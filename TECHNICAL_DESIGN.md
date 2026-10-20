# 小红书评论区表情图片导出工具：第一版技术方案

- 日期：2026-10-20
- 状态：方案阶段，尚未实现和实机验收
- 项目目录：`/Users/didi/Develop/export-rednote-emoji`
- 目标环境：macOS 上的 Chrome / Edge，Manifest V3 浏览器扩展

## 1. 目标与已验证事实

第一版集中于小红书网页评论区的表情图片提取与下载。手机端负责手动发送已收藏表情，网页扩展负责收集、预览、筛选、去重与导出。

用户已验证：

1. 小红书网页版评论区的表情图片可以直接下载。
2. 手机 App 可以将评论区表情添加到收藏表情。
3. 手机收藏的表情无法在网页版收藏列表中查看。

因此本项目不定位为“个人收藏表情库完整导出器”，而定位为“评论区表情图片采集器”。网页图片可下载不等于已证明原分辨率、透明度和动画完整保留，这些是第一阶段验证项。

## 2. 范围与使用流程

### 2.1 第一版功能

- 扫描当前笔记已加载的一级和回复评论图片。
- 在收集开启期间增量捕获新加载的评论图片。
- 排除笔记主图、头像、界面图标等非评论正文图片。
- 缩略图预览、多选、全选、取消选择、按评论作者筛选。
- 单张下载、批量下载为 ZIP、失败项单独重试。
- 获取字节后按 SHA-256 去重，重复图片保留全部来源关联。
- 保存实际获取的文件格式；支持识别静态与动态状态，无法识别时显示“未知”。
- 显示评论来源链接、已收集数量、导出成功/失败数量及采集范围说明。

### 2.2 不包含

直接读取手机或 Mac App 收藏库；自动发评论或私信；自动登录、读取密码、导出 Cookie；全站爬取；自动翻页或自动滚动；默认采集笔记主图；图片水印处理；截图代替原文件；图片转 GIF、拼图切分和云同步。

### 2.3 用户流程

1. 用户自行在手机上将需要导出的收藏表情发送到方便管理的帖子评论中；评论的可见性遵循平台原有规则。
2. Mac 浏览器打开帖子，手动展开目标评论和回复。
3. 点击扩展按钮，启动当前笔记采集并打开独立的扩展管理标签页。
4. 回到小红书标签页手动滚动/展开；工具仅收集已渲染的目标评论图片。
5. 在管理页筛选自己的评论、勾选目标图片，检查预览和动态状态。
6. 单张保存或导出 ZIP，查看导出报告。

“已加载”指曾被本次采集器观察到的 DOM 媒体节点，不代表服务端所有评论，也不保证包含采集开始前已被虚拟列表移除的评论。页面切换笔记时暂停旧会话，提示用户为新笔记开启采集，不混合不同帖子的来源。

## 3. 技术选型与总体结构

| 部分 | 方案 | 原因 |
| --- | --- | --- |
| 扩展平台 | Manifest V3，先验收 macOS Chrome，再验收 Edge | 两者共享 Chromium 扩展模型；兼容性仍需实测 |
| 开发语言 | TypeScript | 约束消息、会话和文件状态 |
| 界面 | React + Vite，输出本地扩展资源 | 预览列表和批量状态易于管理 |
| DOM 采集 | 按需注入 isolated-world content script | 读取网页 DOM，避免修改页面业务逻辑 |
| 后台 | Extension service worker | 点击入口、注入、会话路由与下载事件 |
| 任务执行 | 持续打开的扩展管理标签页 | 下载、哈希和 ZIP 不依赖 popup / worker 常驻 |
| 存储 | IndexedDB + chrome.storage.local | 前者保存文件和会话，后者保存少量偏好 |
| ZIP | 优先评估 fflate 等本地打包依赖，实施时锁定版本 | 不使用远程运行时代码，图片条目不重复压缩 |
| 验证 | Vitest + DOM fixtures；真实扩展加载验收 | 自动测试纯逻辑，实际浏览器验证权限与下载 |

数据流：

```text
当前小红书笔记页
  → Content Script：评论区域识别、增量采集、来源绑定
  → Service Worker：校验消息、绑定 tab / note / session
  → IndexedDB：候选元数据
  → 扩展管理页：筛选、下载队列、格式识别、SHA-256、预览
  → IndexedDB：文件 Blob 和任务检查点
  → 单文件 / ZIP Blob URL → downloads API → macOS 文件系统
```

Service worker 随时可能休眠，不能把任务真相仅保存在其内存。管理页关闭后任务暂停；重新打开可恢复已落库状态，重新排队未完成下载。后台不宣称持续运行。第一版只允许一个管理页执行队列，通过执行所有权/会话租约避免重复打开页面产生重复下载。

## 4. 采集设计

### 4.1 站点适配器

封装 `RednoteCommentAdapter`，集中维护笔记 ID、评论容器、评论项、作者链接、评论 ID 与正文媒体识别。具体选择器在 P0 从真实页面核对后填写，不能凭截图或历史项目写死未验证的 class。

候选至少来自评论正文媒体节点，收集 `currentSrc`、`src`、`srcset` 和经核实的懒加载属性，保留各候选地址和选用理由。仅以宽高阈值不足以识别表情，不用此方法直接删除小尺寸素材。

优先依据正文附件结构；排除作者头像节点、表情文字图标及操作栏。无法确定“表情”与普通评论配图时，标记为“评论图片候选”，交由预览选择，不虚称自动语义识别。

### 4.2 增量与页面生命周期

用户启动后做一次扫描，用局部 MutationObserver 观察评论容器的新增节点及图片属性变化，防抖并限定遍历范围。容器被替换时重新绑定；重复点击不重复安装 observer。手动停止、页面卸载、笔记变化时结束相应观察。

使用 tab ID + session ID + note ID 校验消息归属。异步扫描、下载结果都携带会话版本，旧页面结果不能写入新会话。虚拟列表中的图片先收集 URL/来源，及时持久化元数据，但不承诺对未出现过的节点完整采集。

### 4.3 作者筛选与来源

优先使用作者主页中的稳定用户 ID，昵称只用于显示；同名作者不可合并。没有稳定 ID 时显示未知作者，仍可手动选择，不根据昵称自动认定为用户本人。第一版无需调用“当前登录用户”接口。

评论 ID 可用时记录；不可用时保存笔记来源与本次会话中的位置标记。仅保留可验证的笔记链接，不生成未经验证的评论锚点。

## 5. 文件获取、格式与去重

### 5.1 下载策略

1. 从实际图片元素取得浏览器使用的资源 URL；保留完整查询参数，不随意删除签名、处理参数或替换 CDN 路径。
2. 对目标资源来源请求最小 host permission，在扩展管理页 fetch 文件字节。content script 的跨源请求仍有页面来源限制，不能默认绕过 CORS。
3. 默认不主动读取或附带账号凭据。遇到 401/403、过期 URL 或来源校验失败，提示回源页面重新加载并重新扫描；若确实需要特定认证/请求上下文，单独验证后再决定扩展方案。
4. 无法 fetch 字节但浏览器直接下载可行时，可提供显式的“直接下载候选资源”降级入口；标记为未校验，不能进入已校验 ZIP 或内容去重结果。
5. blob/data URL、需要页面内部请求逻辑或特殊请求头的资源，P0 单独验证；第一版不能可靠读取时明确标为不支持，不以截图或 canvas 重绘悄悄替代。

网络监听、页面主世界注入及 DevTools 调试权限均不是第一版默认依赖。普通 webRequest 监听不提供任意响应体；DOM 路线受阻时另行评估，不把通用监听等同于原文件提取。

### 5.2 原文件与动画

“保留原文件”定义为不重编码当前实际获取的响应字节；不承诺该响应就是平台上传的原始分辨率。标记图片尺寸和验证状态，不凭 URL 出现 original 等词宣称高清原图。

结合响应状态、Content-Type、文件签名和可解码性检查，拒绝 HTML 登录页、错误 JSON、空文件。按字节识别 PNG、JPEG、GIF、WebP；APNG/WebP 的动画标记单独解析，未知类型不只改扩展名伪装成 PNG。GIF 同样检查是否多帧；动态文件保存后与浏览器播放效果人工对照。预览失败不必等于源文件无效，区分下载失败、格式未知与预览不支持。

### 5.3 两层去重

- 候选层：精确资源地址去重，保留多个评论来源；不任意去掉 URL 参数。
- 文件层：SHA-256 相同才合并文件，保留来源列表。不同压缩或不同尺寸即使视觉相同也不自动合并。

并发默认 3、瞬时失败最多自动重试 2 次；401/403 不盲目重试。429 尊重 Retry-After 并暂停队列。支持取消，完成后写入 Blob、哈希、格式及任务状态。

## 6. 权限与消息边界

初始 permissions：`activeTab`、`scripting`、`storage`、`downloads`。用户点击后仅对受支持的小红书笔记页注入。浏览器刷新后重新点击启动。

资源域名必须在 P0 实测后建立允许列表，用 optional_host_permissions 按需申请对应站点；不默认请求 `<all_urls>`，不猜测允许所有 CDN。新增权限仅用于资源读取，遇到重定向到未授权来源时停止并提示。

下载接口只接受已登记的 candidate ID，不允许网页消息指定任意 URL、文件路径或执行命令。来自 content script 的候选也需校验来源 host、URL scheme、tab/note/session、长度与批量上限；若需要辅助消息桥，必须校验消息类型与来源。

文案以 textContent / React 默认转义显示，不渲染评论 HTML。文件名清理路径分隔符、控制字符与保留名称，ZIP 条目禁用绝对路径和 `..`。

## 7. 数据与状态模型

```ts
type Candidate = {
  id: string;
  sessionId: string;
  noteId: string;
  sourceNoteUrl: string;
  sources: Array<{
    commentId?: string;
    authorId?: string;
    authorName?: string;
  }>;
  resourceUrls: string[];
  selectedUrl: string;
  discoveredAt: string;
  status: 'found' | 'queued' | 'fetching' | 'ready' | 'failed';
  assetHash?: string;
  errorCode?: string;
};

type Asset = {
  sha256: string;
  blob: Blob;
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'unknown';
  animated: boolean | null;
  width?: number;
  height?: number;
  byteLength: number;
};
```

IndexedDB 存 session、candidate、asset（hash 主键）、exportJob；资源与来源采用引用关联。选择状态与导出进度持久化，空闲清理只删除没有会话引用的 asset。chrome.storage.local 只保存并发、排序等设置，不存图片字节。

刷新管理页后将旧 fetching 状态恢复为可重试状态。导出不自动重复触发：记录 downloadId，恢复时先查询浏览器下载状态；不能确认的任务标记需用户重试。

## 8. 导出与界面

扩展入口只负责启动/停止和打开管理页，不在 popup 里执行长任务。管理页提供来源笔记、采集状态、作者筛选、预览网格、选择计数、下载进度及失败重试。

单张和 ZIP 均从已验证 Blob 创建 URL，由 downloads API 保存；监听完成/失败事件后释放 URL，不在调用下载 API 后立即回收。管理页提前关闭可能影响未完成导出，必须提示并保留可重试状态。

ZIP 默认结构：

```text
rednote-emoji_<noteId>_<timestamp>/
  images/
    0001_<hash前12位>.gif
    0002_<hash前12位>.png
  manifest.json
  failures.json
```

manifest 包含导出时间、笔记链接、文件哈希、格式、尺寸、动态状态、作者/评论来源、去重映射。不默认输出带签名的资源 URL；不导出 Cookie 或完整评论文本。若图片同名截断哈希冲突则追加序号。

默认第一版保护上限：每会话 500 个候选、单文件 20 MiB、单个 ZIP 原始文件总量 100 MiB 或 200 张。fetch 读取流时累计限额，不能只相信 Content-Length。超过限制让用户分批导出，不将界面假死视为正常等待。ZIP 生成置于管理页专用 Web Worker，超限支持取消；依赖和输出内存占用在 P0/P2 测量后调整。

## 9. 拟议目录

```text
src/
  background/       # action、注入、消息路由、downloads 事件
  content/          # 评论适配器、扫描器、observer、页面生命周期
  manager/          # React 界面、任务调度、预览
  workers/          # ZIP 工作线程
  shared/           # 类型、协议、URL/文件名校验
  services/         # 文件获取、格式解析、哈希、IndexedDB、导出
public/
  manifest.json
  icons/
tests/
  fixtures/         # 人工构造或脱敏的评论 DOM、媒体样本
  unit/
  integration/
docs/
  VALIDATION.md     # P0 验证记录、站点选择器与限制
TECHNICAL_DESIGN.md
```

全部代码与依赖随扩展打包。第一版无需服务端、数据库服务、Python 进程或原生 macOS 助手。开发依赖锁文件随实现提交；暂不因方案选择框架而安装依赖。

## 10. 分阶段开发与验收

### P0：真实资源验证（先于界面开发）

- [ ] 用用户可访问的笔记验证静态图、动态 GIF/WebP、一级/回复评论。
- [ ] 记录评论区域与作者 ID 的实际 DOM，确认可与头像、笔记主图区分。
- [ ] 用最小扩展验证资源 host permission、fetch 字节、文件格式、实际尺寸与动画。
- [ ] 核对跨源、签名 URL、重定向、blob 和懒加载边界；记录无法支持的样本。
- [ ] 确认 Mac Chrome 和 Edge 的最低实测版本，写入 manifest/验证记录。

退出条件：至少完成静态图从评论到本地文件；动画若失败，明确第一版限制。若只能直接下载、不能读取字节，先调整 ZIP 与哈希方案，不能把未验证能力写为已支持。

### P1：最小可用采集器

- [ ] 扩展工程、点击注入、一次扫描、管理页预览与单张导出。
- [ ] 作者 ID 筛选、手动多选、URL 候选去重。
- [ ] 空结果、权限拒绝、页面失效、非笔记页面提示。

退出条件：打开已加载目标评论，能预览、只选目标用户图片、下载且不混入头像/笔记主图。

### P2：增量、内容去重与批量导出

- [ ] 局部 observer、SPA 笔记切换隔离、手动停止。
- [ ] IndexedDB 检查点、fetch 队列、SHA-256、取消与重试。
- [ ] ZIP、manifest、失败清单、导出数量与内存限制。
- [ ] 多管理页队列所有权、页面关闭后的任务恢复。

退出条件：重复表情只输出一个文件且来源保留，失败项不影响成功项，ZIP 可在 macOS 解压并打开。

### P3：兼容与交付

- [ ] Chrome/Edge 实测；深浅色、窗口缩放、长昵称、中文文件名。
- [ ] 评论容器重建、虚拟列表、刷新/关闭标签页、多笔记切换。
- [ ] 权限最小化、资源 URL 不进入默认导出报告、无账号凭据记录。
- [ ] 提供开发者模式加载说明、使用步骤、已知限制和可安装目录/ZIP。

## 11. 测试策略与完成定义

自动测试覆盖：评论 DOM 识别、作者同名不同 ID、SPA 会话隔离、候选/字节去重、真实格式与动画标记、错误 HTML、超限中止、文件名清理、ZIP 解包哈希一致、任务恢复及过期消息。

人工验收使用少量已知样本：静态 PNG/JPEG、GIF、WebP（包括实际存在时的动画样本）、相同图片不同 URL、过期链接、回复评论。记录提取前后文件字节/尺寸/帧状态；用真实 macOS 浏览器验证跨源与下载事件，不以模拟 DOM 测试代替站点适配成功。

完成定义：P0 核实范围内的评论图片可稳定预览与导出；用户能知道已收集范围、失败原因与动画状态；不自动发布内容；不假装已遍历完整收藏库或整帖所有评论。

## 12. 官方技术依据

以下是架构依据，不是已完成的小红书适配证明。站点相关结论仍以 P0 实测为准。

- [Chrome Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)：DOM 读取、isolated world、activeTab 按需注入。
- [Chrome Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)：扩展来源网络请求与 host permissions。
- [Chrome Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：生命周期与状态持久化。
- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)：下载创建、状态查询和事件。

## 13. 本次 Git 身份检查

检查日期：2026-10-20。以下是目标项目目录内实际生效的 Git 配置快照，不修改配置，也不代表历史提交作者。

| 配置项 | 当前值 | 来源 |
| --- | --- | --- |
| user.name | xing-yiren | 项目 `.git/config` |
| user.email | yx136@cantab.ac.uk | 项目 `.git/config` |

核对命令：

```sh
git -C /Users/didi/Develop/export-rednote-emoji config --show-origin --get user.name
git -C /Users/didi/Develop/export-rednote-emoji config --show-origin --get user.email
```
