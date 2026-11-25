#!/bin/bash
# 一键构建微信小游戏包：Creator CLI → build/wechatgame/
set -e
CREATOR="/Applications/CocosCreator.app/Contents/MacOS/CocosCreator"
PROJ="$HOME/Projects/zhuri-runner"
"$CREATOR" --project "$PROJ" --build "platform=wechatgame;debug=true"
echo "构建产物: $PROJ/build/wechatgame"
