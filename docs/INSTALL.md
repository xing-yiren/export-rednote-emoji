# 安装方式

本项目是浏览器扩展，提供三种安装方式。**浏览器安全策略决定扩展无法像普通软件那样双击直接注册**：
Chrome / Edge 对非商店来源的扩展一律要求开启“开发者模式”并手动选择一次目录。
下面的安装包把这一步的准备工作（复制文件、定位路径）全部自动化，你只需在浏览器里点两下。

---

## 方式一：macOS 安装包（推荐）

**文件**：`release/RednoteEmoji-<版本>.dmg`

1. 双击 `.dmg`，把「**安装小红书表情包导出**」拖入「应用程序」。
2. 双击运行。首次可能被系统拦截，请**右键 → 打开**（未签名应用）。
3. 安装程序会自动完成：
   - 把扩展复制到 `~/Library/Application Support/RednoteEmoji/extension`
   - 把该路径复制到剪贴板
   - 打开浏览器的扩展管理页
4. 在扩展管理页：
   - 打开右上角「**开发者模式**」
   - 点击「**加载已解压的扩展程序**」
   - 在文件选择框按 **⌘⇧G**，⌘V 粘贴路径，回车，选择该文件夹
5. 刷新小红书笔记页即可使用。

> 未签名版本：macOS 提示“无法验证开发者”时，右键应用 →「打开」→ 确认。
> 需要更高安全性可自行 `codesign` 签名并公证。

### 卸载

```sh
rm -rf ~/Library/Application\ Support/RednoteEmoji
```
并在浏览器扩展管理页点「移除」。

---

## 方式二：ZIP 包

**文件**：`release/RednoteEmoji-<版本>.zip`（含安装器）或 `release/export-rednote-emoji_<版本>.zip`（纯扩展）

纯扩展 ZIP 解压后，直接在扩展管理页「加载已解压的扩展程序」选择解压目录即可。

---

## 方式三：开发者方式

```sh
npm install
npm run build          # 产物 dist/
npm run package        # 额外生成 release/*.zip
npm run dist:mac       # 额外生成 macOS 安装包 release/*.dmg
```

然后在 `chrome://extensions` 中加载 `dist/`。

---

## 为什么不能像 App 一样双击安装？

| 方式 | 是否需开发者模式 | 说明 |
|---|---|---|
| 解压目录 / 本安装包 | 需要 | 每次加载一次，此后正常使用 |
| 拖入 `.crx` | 仍然需要 | Chrome 会拦截非商店来源，且每次启动校验 |
| Chrome 应用商店 / Edge 加载项商店 | **不需要** | 需开发者账号注册与审核，用户一键安装并自动更新 |

如需真正的“一键安装 + 自动更新”，需要发布到 Chrome Web Store（一次性 $5 开发者注册费）与 Microsoft Edge 加载项商店（免费）。代码无需改动，上市材料与审核流程另行准备。

---

## 系统要求

- macOS 11 或更高（安装器）
- Chrome / Edge 版本 ≥ 120
- 扩展本身跨平台（Windows / Linux 使用方式三，或解压 ZIP 加载）
