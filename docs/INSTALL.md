# 安装方式

本项目是浏览器扩展，提供两类安装方式。**浏览器会拦截所有非官方商店来源的扩展**：
Chrome / Edge 既不接受 `.crx` 直接安装，也不允许第三方软件把扩展“注册”进去，
唯一免上架的路径是开启“开发者模式”后加载一次已解压的目录。
下面的 macOS 安装包把复制文件、打开扩展页、点开选择框这些步骤都自动化了，你只需点一次「选择」。

---

## 方式一：macOS 安装包（推荐）

**文件**：`release/RednoteEmoji-<版本>.dmg`（[Releases](https://github.com/xing-yiren/export-rednote-emoji/releases) 页下载）

1. 双击 `.dmg`，把「**安装小红书表情包导出**」拖入「应用程序」。
2. 双击运行。首次可能被系统拦截，请**右键 → 打开**（未签名应用）。
3. 点「继续」，安装程序会：
   - 把扩展复制到 `~/Library/Application Support/RednoteEmoji/extension`
   - 打开浏览器扩展页，并尝试自动打开「加载已解压的扩展程序」的文件夹对话框
   - 在对话框里点「**选择**」即可
4. 刷新小红书笔记页即可使用。

> 如果第 3 步没全自动完成（系统未授予“辅助功能”权限时会这样），在扩展页手动两步：
> 打开右上角「**开发者模式**」→ 点「**加载已解压的扩展程序**」→ 选择上面那个目录。

扩展放在固定目录，所以扩展 ID 在多次重装后保持不变，已保存的下载记录与权限不会丢。

### 更新

下载新版 DMG 重新运行安装器即可覆盖（设置保存在扩展存储里，不受影响）。

### 卸载

```sh
rm -rf ~/Library/Application\ Support/RednoteEmoji
```
并在浏览器扩展管理页点「移除」。

---

## 方式二：从源码构建（Windows / Linux / 开发者）

```sh
git clone <本仓库地址>
cd export-rednote-emoji
npm install
npm run build          # 产物 dist/
npm run dist:mac       # 可选：生成 macOS 安装包 release/*.dmg
```

然后在 `chrome://extensions`（Edge 为 `edge://extensions`）中「加载已解压的扩展程序」→ 选择 `dist/`。
修改代码后执行 `npm run build`，再在扩展卡片上点「重新加载」。

---

## 能不能装成 `.crx`？

**不能，至少现在不行。** 我们实测了 Chrome 156（macOS，arm64）的各种非商店安装路径：

| 方式 | 结果 |
|---|---|
| 把 `.crx` 拖进 `chrome://extensions` | 拒绝：`CRX_REQUIRED_PROOF_MISSING` |
| 从 `file://` / GitHub 下载 `.crx` 后打开 | 登记为扩展但立即禁用 |
| 用户目录 `External Extensions/<id>.json` 指向本地/远程 `.crx` | 安装后禁用（`DISABLE_EXTERNAL_EXTENSION`），即使 CRX3 签名有效 |
| 配置 `ExtensionInstallAllowlist` / `ExtensionInstallSources` 策略 | 需要系统级策略文件（MDM / root 写 `/Library/Preferences`），且新版 Chrome 已移除对外部 CRX 的支持 |
| `--load-extension` 命令行参数 | 品牌版 Chrome 会忽略该参数 |
| Chrome 应用商店 / Edge 加载项商店 | **可以**，一键安装 + 自动更新 |

所以我们放弃了 `.crx` + 自更新（`updates.xml`）这套方案：它只对企业受管环境有效，
普通用户装了也是禁用状态。可选的正规路径只有两条：

1. **上架商店**：Chrome Web Store 一次性 $5 开发者注册费；Microsoft Edge 加载项商店免费。
   代码无需改动，打包一个 ZIP（`npm run build` 后的 `dist/`）上传即可。
2. **当前方式**：安装器自动化「加载已解压」的点击流程，用户只需点一次「选择」。

---

## 系统要求

- macOS 11 或更高（安装器）
- Chrome / Edge 版本 ≥ 120
- 扩展本身跨平台：Windows / Linux 从源码构建后「加载已解压」即可
