/**
 * 生成 macOS 安装包：release/RednoteEmoji-<version>.dmg
 * 内含「安装小红书表情包导出.app」+ 扩展文件；双击应用即引导安装。
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const root = resolve(here, '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const dist = resolve(root, 'dist');
const staging = resolve(root, '.build/dmg');
const app = resolve(staging, '安装小红书表情包导出.app');

if (!statSync(dist, { throwIfNoEntry: false })) {
  console.error('dist/ 不存在，请先 npm run build');
  process.exit(1);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(resolve(app, 'Contents/MacOS'), { recursive: true });
mkdirSync(resolve(app, 'Contents/Resources/extension'), { recursive: true });

// 应用内资源：安装脚本（可执行）+ 扩展文件
const runner = resolve(app, 'Contents/MacOS/install');
cpSync(resolve(here, 'installer/install.command'), runner);
chmodSync(runner, 0o755);
cpSync(dist, resolve(app, 'Contents/Resources/extension'), { recursive: true });
if (!statSync(resolve(app, 'Contents/Resources/extension/manifest.json'), { throwIfNoEntry: false })) {
  throw new Error('扩展资源复制失败：缺少 manifest.json');
}

writeFileSync(
  resolve(app, 'Contents/Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>小红书表情包导出</string>
  <key>CFBundleDisplayName</key><string>安装小红书表情包导出</string>
  <key>CFBundleIdentifier</key><string>io.github.rednote-emoji.installer</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>install</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`,
);

// 安装说明（DMG 窗口里一并提供）
writeFileSync(
  resolve(staging, '安装说明.txt'),
  `小红书表情包导出 v${version}
==============================

安装：
  1. 把「安装小红书表情包导出」拖到「应用程序」
  2. 双击打开它（首次打开若被系统拦截：右键 → 打开）
  3. 按窗口提示，在浏览器扩展管理页选择「加载已解压的扩展程序」

系统会自动复制扩展文件并把路径放进剪贴板。

卸载：
  删除 ~/Library/Application Support/RednoteEmoji
  并在浏览器扩展管理页移除本扩展。

限制：
  浏览器扩展无法像普通软件一样双击直接注册进 Chrome/Edge；
  必须启用「开发者模式」并在扩展页手动选择一次目录。
`,
);

const dmgPath = resolve(root, `release/RednoteEmoji-${version}.dmg`);
rmSync(dmgPath, { force: true });
// 用较新的 diskutil 接口创建，避免 hdiutil 已弃用的用法
try {
  execFileSync('diskutil', ['image', 'create', 'from', staging, '--volumeName', 'RednoteEmoji', '--format', 'UDZO', dmgPath], { stdio: 'inherit' });
} catch {
  execFileSync('hdiutil', ['create', '-volname', 'RednoteEmoji', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath], { stdio: 'inherit' });
}

// 同时保留 ZIP 形式（方便传输；未签名的 app 下载后需右键打开）
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, resolve(root, `release/RednoteEmoji-${version}.zip`)], { stdio: 'inherit' });
console.log(`release/RednoteEmoji-${version}.dmg（安装包）\nrelease/RednoteEmoji-${version}.zip（安装器传输备份）`);
