#!/bin/bash
#
# 小红书表情包导出 · 安装程序
#
# 两步：复制扩展文件到固定目录 → 打开浏览器扩展管理页，并自动点开
# 「加载已解压的扩展程序」的选择框、定位到该目录。你只需点一次「选择」。
#
# 为什么不发布 .crx：Chrome / Edge 会拦截非商店来源的 CRX，必须通过
# 系统级策略（MDM / 注册表）才放行，且新版 Chrome 已彻底禁止外部 CRX 安装。
#
set -uo pipefail

APP_NAME="RednoteEmoji"
SUPPORT_DIR="$HOME/Library/Application Support/$APP_NAME"
DEST="$SUPPORT_DIR/extension"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$HERE/../Resources/extension/manifest.json" ]]; then
  SRC_DIR="$(cd "$HERE/../Resources/extension" && pwd)"
else
  SRC_DIR="$HERE/extension"
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*"; }
pause() { read -r -p "按回车关闭此窗口…" _ || true; }

confirm() {
  osascript -e "display dialog \"$1\" buttons {\"取消\", \"继续\"} default button \"继续\" with title \"小红书表情包导出\" with icon note" \
    -e 'button returned of result' 2>/dev/null | grep -q "继续"
}

notify() {
  osascript -e "display dialog \"$1\" buttons {\"好\"} default button \"好\" with title \"小红书表情包导出\" with icon note" >/dev/null 2>&1 || true
}

if [[ ! -f "$SRC_DIR/manifest.json" ]]; then
  fail "安装包不完整：找不到 extension/manifest.json（查找路径：$SRC_DIR）"
  pause
  exit 1
fi

clear
bold "小红书表情包导出 · 安装"
echo
info "扩展目录：$DEST"
echo
info "安装过程："
info "  1. 复制扩展文件到上面的目录（下次更新直接覆盖）"
info "  2. 自动打开浏览器扩展页，弹出「选择文件夹」对话框"
info "  3. 你点一次「选择」即可"
echo

if ! confirm "把扩展安装到：\n$DEST\n\n随后浏览器会弹出选择文件夹的对话框，点「选择」完成安装。\n\n继续？"; then
  info "已取消。"
  exit 0
fi

rm -rf "$DEST.new"
mkdir -p "$DEST.new"
if ! cp -R "$SRC_DIR"/. "$DEST.new"/; then
  fail "复制扩展文件失败"
  rm -rf "$DEST.new"
  pause
  exit 1
fi
rm -rf "$DEST"
mv "$DEST.new" "$DEST"
info "✔ 扩展文件已就位"

BROWSER_NAME=""
if pgrep -x "Google Chrome" >/dev/null 2>&1; then
  BROWSER_NAME="Google Chrome"
elif pgrep -x "Microsoft Edge" >/dev/null 2>&1; then
  BROWSER_NAME="Microsoft Edge"
elif [[ -d "/Applications/Google Chrome.app" ]]; then
  BROWSER_NAME="Google Chrome"
elif [[ -d "/Applications/Microsoft Edge.app" ]]; then
  BROWSER_NAME="Microsoft Edge"
fi

if [[ -z "$BROWSER_NAME" ]]; then
  fail "未检测到 Google Chrome 或 Microsoft Edge，请先安装浏览器后再运行本安装程序。"
  pause
  exit 1
fi
info "✔ 使用浏览器：$BROWSER_NAME"

if [[ "$BROWSER_NAME" == "Google Chrome" ]]; then
  EXTENSIONS_URL="chrome://extensions/"
else
  EXTENSIONS_URL="edge://extensions/"
fi

# 自动化分三段，任一段失败就停在那里，并在终端明确告诉用户下一步：
#   1) 打开扩展页                         —— 只会用到"自动化"权限
#   2) 开启开发者模式、点「加载已解压」      —— 需要"辅助功能"权限
#   3) 在文件夹面板里跳到扩展目录并确认
OSA_OUT="$(osascript <<APPLESCRIPT 2>&1
tell application "$BROWSER_NAME"
  activate
  open location "$EXTENSIONS_URL"
end tell
delay 2
return "opened"
APPLESCRIPT
)"
STEP_OPENED=0
[[ "$OSA_OUT" == "opened" ]] && STEP_OPENED=1

STEP_CLICKED=0
if [[ $STEP_OPENED -eq 1 ]]; then
  OSA_OUT="$(osascript <<APPLESCRIPT 2>&1
tell application "System Events"
  tell process "$BROWSER_NAME"
    set frontmost to true
    delay 0.5
    try
      click checkbox 1 of group 1 of toolbar 1 of window 1
      delay 0.8
    end try
    set clicked to false
    try
      click (first button of window 1 whose name contains "加载已解压" or name contains "Load unpacked")
      set clicked to true
    end try
    if not clicked then
      try
        click (first button of group 1 of window 1 whose name contains "加载已解压" or name contains "Load unpacked")
        set clicked to true
      end try
    end if
    if clicked then return "clicked"
    return "not-found"
  end tell
end tell
APPLESCRIPT
)"
  [[ "$OSA_OUT" == "clicked" ]] && STEP_CLICKED=1
fi

STEP_SELECTED=0
if [[ $STEP_CLICKED -eq 1 ]]; then
  # 文件夹面板由系统弹出，此时直接输入路径最快（⌘⇧G 打开"前往文件夹"）
  sleep 1
  OSA_OUT="$(osascript <<APPLESCRIPT 2>&1
tell application "System Events"
  keystroke "g" using {command down, shift down}
  delay 1
  keystroke "$DEST"
  delay 0.6
  key code 36
  delay 1
  key code 36
  return "selected"
end tell
APPLESCRIPT
)"
  [[ "$OSA_OUT" == "selected" ]] && STEP_SELECTED=1
fi

if [[ $STEP_SELECTED -eq 1 ]]; then
  open -a "$BROWSER_NAME" "$EXTENSIONS_URL" >/dev/null 2>&1 || true
  echo
  info "✔ 已自动完成加载，请确认浏览器扩展页里出现了「小红书表情包导出」"
  notify "已自动加载扩展。\n\n请在扩展页确认出现了「小红书表情包导出」；\n如果没有，可点「加载已解压的扩展程序」手动选择：\n$DEST"
  echo
  info "刷新小红书笔记页即可使用。"
  exit 0
fi

echo
if [[ $STEP_OPENED -eq 0 ]]; then
  fail "无法自动打开浏览器，请手动打开：$EXTENSIONS_URL"
  open -a "$BROWSER_NAME" "$EXTENSIONS_URL" >/dev/null 2>&1 || true
elif [[ $STEP_CLICKED -eq 0 ]]; then
  info "浏览器扩展页已打开，但自动点击被系统拦下（缺少辅助功能权限）。请手动两步："
  info "  1. 右上角打开「开发者模式」"
  info "  2. 点「加载已解压的扩展程序」，选择 $DEST"
else
  info "扩展目录已在文件夹面板中打开，请点「选择」确认。"
  info "若面板已关闭，请在扩展页点「加载已解压的扩展程序」并选择 $DEST"
fi
echo
info "安装完成后刷新小红书笔记页即可使用。"
info "更新：重新运行安装程序即可覆盖；卸载：移除扩展并删除 $SUPPORT_DIR"
echo
notify "安装准备完成。\n\n请在浏览器中选择扩展目录：\n$DEST"
