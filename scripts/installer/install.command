#!/bin/bash
#
# 小红书表情包导出 · 安装程序
# 双击运行：把扩展复制到用户目录，并打开 Chrome 扩展管理页。
#
set -euo pipefail

APP_NAME="RednoteEmoji"
DEST="$HOME/Library/Application Support/$APP_NAME/extension"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 兼容两种布局：.app 包内（Contents/MacOS -> Contents/Resources）与解压目录同级
if [[ -f "$HERE/../Resources/extension/manifest.json" ]]; then
  SRC_DIR="$(cd "$HERE/../Resources/extension" && pwd)"
else
  SRC_DIR="$HERE/extension"
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*"; }
pause() { read -r -p "按回车关闭此窗口…" _ || true; }

if [[ ! -f "$SRC_DIR/manifest.json" ]]; then
  fail "安装包不完整：找不到 extension/manifest.json（查找路径：$SRC_DIR）"
  pause
  exit 1
fi

clear
bold "小红书表情包导出 · 安装"
echo
info "安装位置：$DEST"
echo

# 1. 复制扩展文件（覆盖旧版本）
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC_DIR"/. "$DEST"/
info "✔ 扩展文件已复制"
echo

# 2. 复制到剪贴板，方便在扩展页粘贴路径
printf '%s' "$DEST" | pbcopy
info "✔ 扩展目录已复制到剪贴板"
echo

bold "接下来（只需三步）："
info "1. 在打开的 Chrome/Edge 扩展管理页，打开右上角「开发者模式」"
info "2. 点击「加载已解压的扩展程序」"
info "3. 在文件选择框中按 ⌘⇧G，粘贴路径后回车，选择该文件夹"
echo

read -r -p "现在打开扩展管理页？[Y/n] " ans
if [[ -z "${ans:-}" || "$ans" =~ ^[Yy] ]]; then
  open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || \
  open -a "Microsoft Edge" "edge://extensions/" 2>/dev/null || \
  open "chrome://extensions/"
  info "✔ 已尝试打开扩展管理页"
fi
echo
info "安装完成后，刷新小红书笔记页即可使用。"
info "卸载：删除 $DEST 目录，并在扩展管理页移除本扩展。"
echo
pause
