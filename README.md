# 逐日 · 夸父逐日神话跑酷（Cocos Creator 3.8.8 + 微信小游戏）

第三人称真 3D 无尽跑酷。P1 起采用模块化架构：`Game.ts` 仅做装配，玩法规则在零依赖核心层，参数全部由 `assets/resources/game-config.json` 驱动（带校验）。

## 架构速览

```
assets/scripts/
├── Game.ts            # 引导装配（加载配置→构建各层→每帧驱动）
├── config/            # 配置 schema/校验/加载
├── core/              # ★ GameCore：玩法规则唯一真源（零 cc 依赖，Node 可单测）
├── input/             # 触摸/键盘 → 意图
├── render/            # Renderer3D（默认，真3D）/ Renderer2D（回退）/ Hud2D（共用 UI）
└── platform/          # AdService（mock / wx 激励视频）
```

测试：`npm test`（vitest，53 项）；类型检查：`npm run type-check`。

## 首次打开
1. 打开 `/Applications/CocosCreator/CocosCreator.app`
2. 项目 → 导入 → 选择本目录 `~/Projects/zhuri-runner` → 打开
3. 双击 `assets/scenes/main.scene`，点顶部预览按钮（浏览器 ▶）即可试玩
4. 渲染模式在 `game-config.json` 的 `renderMode` 切换：`"3d"`（默认）/ `"2d"`（回退）

## 构建微信小游戏
```bash
bash scripts/build-wechat.sh     # Creator CLI → build/wechatgame
```
1. 微信开发者工具 → 导入项目 → 目录选 `build/wechatgame`
2. 开发者工具 设置 → 安全设置 → 打开服务端口（供 CLI/自动化）
3. 预览 OK 后：开发者工具右上角「上传」→ mp.weixin.qq.com 提交审核

## 广告接入（P4）
`game-config.json` → `ad.mode`: `"mock"`（开发用倒计时）/ `"wx"`（真机激励视频，需填 `adUnitId`）。
广告位 ID 在 mp 后台「流量主 → 广告位管理」创建（激励视频）。

## 文档
`docs/`：ROADMAP / GAME_DESIGN / ARCHITECTURE / PROGRESS / TEST_REPORT / ASSET_LICENSES / KNOWN_ISSUES / RELEASE_CHECKLIST
