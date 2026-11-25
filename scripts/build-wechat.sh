#!/usr/bin/env bash
# 一键构建微信小游戏包：Creator CLI → build/wechatgame/
# 跨平台：macOS / Windows(Git Bash/WSL)。可用环境变量覆盖：
#   CREATOR_PATH  Creator 可执行文件路径（默认按平台探测常见安装位置）
#   ZHURI_PROJECT 项目目录（默认本脚本上级目录）
set -euo pipefail

PROJ="${ZHURI_PROJECT:-"$(cd "$(dirname "$0")/.." && pwd)"}"

detect_creator() {
    if [ -n "${CREATOR_PATH:-}" ] && [ -x "$CREATOR_PATH" ]; then
        echo "$CREATOR_PATH"; return
    fi
    case "$(uname -s)" in
        Darwin)
            for p in "/Applications/CocosCreator.app/Contents/MacOS/CocosCreator"; do
                [ -x "$p" ] && { echo "$p"; return; }
            done
            ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT)
            # Cocos Dashboard 默认安装位置（版本号目录需按实际调整）
            for base in "C:/ProgramData/cocos/editors/Creator" "$LOCALAPPDATA/cocos/editors/Creator"; do
                if [ -d "$base" ]; then
                    latest="$(ls -1 "$base" 2>/dev/null | sort -V | tail -1)"
                    if [ -n "$latest" ] && [ -x "$base/$latest/CocosCreator.exe" ]; then
                        echo "$base/$latest/CocosCreator.exe"; return
                    fi
                fi
            done
            ;;
    esac
    echo "" # 未找到
}

CREATOR="$(detect_creator)"
if [ -z "$CREATOR" ]; then
    echo "错误：未找到 Cocos Creator。请设置环境变量 CREATOR_PATH 指向可执行文件后重试。" >&2
    echo "  macOS 默认探测: /Applications/CocosCreator.app/Contents/MacOS/CocosCreator" >&2
    echo "  Windows 默认探测: C:/ProgramData/cocos/editors/Creator/<版本>/CocosCreator.exe" >&2
    exit 1
fi

echo "Creator : $CREATOR"
echo "项目    : $PROJ"
echo "平台    : wechatgame (debug=true)"

"$CREATOR" --project "$PROJ" --build "platform=wechatgame;debug=true"

echo "构建产物: $PROJ/build/wechatgame"
