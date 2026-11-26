# Phase 8.3 最终本地验收报告 —— 功能基线冻结

> 日期：2026-11-27。目标：在本地把当前版本从头到尾测一遍，修复可稳定复现的功能阻塞，交付可追溯的微信小游戏测试包，并把画面/手感证据交给 Phase 9。Phase 8.2 的 263 项通过仅作历史参照。

## 1. 验收对象与环境

- 分支：`main`，上游 `origin/main`；完整 HEAD：`e9b6771fb8b9c9a35bd9c1fde5a35c0afd0d007d`（`docs(phase8.3): 记录提交 hash 与 10 分钟浏览器压力实测`）。
- 开始时工作区：仅 `profiles/v2/packages/scene.json` 有未提交修改（51 行新增，Cocos Creator 打开项目写入的编辑器视角/相机配置），无暂存改动。该文件不参与玩法、构建与测试，已保留；本报告的实际来源是 **HEAD + 该本地编辑器配置**，不是干净 HEAD。
- 本轮又新增两个修复（见第 5 节）：`tests/phase8.spec.ts` 日期口径修正、`assets/scripts/render/Hud2D.ts` 页面行数扩容。最终报告记录对应提交；本地 scene.json 仍未提交。
- 默认入口：`assets/scenes/main.scene`；默认游戏配置 `assets/resources/game-config.json`（`renderMode=3d`、`quality.level=mid`、`ad.enabled=false`、五个广告位与插屏 ID 全空）；存档 v2（`Save.ts` 版本 2、djb2 校验、备份槽）；微信构建入口 `bash scripts/build-wechat.sh`（Creator CLI `platform=wechatgame;debug=true`，输出 `build/wechatgame/`）。
- 环境：macOS 27.2.1 / arm64；Node v22.20.0；npm 10.9.3；Cocos Creator 3.8.8（package.json 锁定）；Chrome 158.0.8127.89；微信开发者工具 CLI 已安装且 `islogin=true`，服务端口在 63999；adb 1.0.41 但 `adb devices` 为空；无 iOS 设备。
- 本会话 Cocos MCP 工具连接失败（`ERA_NEGOTIATION_FAILED`），HTTP 端点本身仍响应；它不影响本轮任何游戏测试，未用其代替人工/浏览器验证。

## 2. 修复前基线

| 命令 | 实际结果 |
|------|----------|
| `npm test` | **失败**：19 文件 / 267 通过、1 失败（268 项）。失败用例 `tests/phase8.spec.ts:266` 插屏频控跨会话持久化，`expected +0 to be 2` |
| 失败根因 | 测试用 `new Date().toISOString().slice(0,10)`（UTC 日期），产品用 `AdStats.localDate()`（本地日期）。当前时区 +8 跨零点时 UTC 仍为前一日，AdService 正确执行每日重置，测试假设错误；已先核对真实行为再改测试 |
| `npm run type-check` | 0 错误 |
| `npm run lint` | 0 错误 |
| `npx vitest run tests/phase8-1-engine.spec.ts tests/phase3.spec.ts tests/phase8-stress.spec.ts` | 3 文件 / **38 项通过**（3.39s）：1000 种子零无敌重放、1000 种子逐波重放、1000 局/600s 压力 |
| 浏览器最短路径 | 通过正常入口进入标题页、Enter 开局、键盘操作、规则层 crash 结算、重开；无启动/资源错误 |

修复测试日期口径后基线：`npm test` **19 文件 / 269 项全部通过**，`npm run type-check` 0，`npm run lint` 0。默认 `npm test` 已包含全部长跑/种子重放，无独立必需入口。

## 3. 浏览器 B01–B12 实玩矩阵

测试平台：Chrome headless、独立 CDP 用户目录；为适配桌面 headless，CDP viewport 设为 720×1280，并把**构建产物** index.html 的 canvas 临时设为 720×1280（源码与最终微信包不受影响）。默认 3D、mid 画质、默认静音、广告关闭。CDP 键盘在 canvas focus 后可靠注入；CDP 鼠标事件会生成 DOM 事件但本会话 Cocos 未收到 TOUCH_START，因此触控路径只用 Node cc 桩测试覆盖。

| 编号 | 结果 | 证据 |
|------|------|------|
| B01 冷启动 | 通过 | `Storage.clearDataForOrigin` 后干净站点：`bestLi=0/gold=0/muted=true`，标题、起跑、征途、7 个导航项出现；无 console error；`/tmp/zhuri-final2-B01-title.png` |
| B02 教程完成 | 通过 | 错误动作（跳）后提示保持「左右滑动 切换跑道」；正确切道后提示变为「上滑 跳跃」且 step=jump；HUD 文案修复后复验 |
| B03 跳过与重看 | 通过（部分入口为运行时调用） | 跳过后 `tutorial.done=true`、普通局无教程参数；设置页「重看新手教程」存在且可由 `onPageAction('retutorial')` 触发；CDP 触控未注入，入口用组件方法复验 |
| B04 四向输入 | 通过（键盘） | 左右/跳/滑铲后仍在 run，方向正确；触控模拟仅 DOM 层，见未验证项 |
| B05 连续输入 | 通过 | 快速左右交替、跳/滑中重复输入、边缘继续外按后 state=run、dist 持续推进、无越界 |
| B06 暂停恢复 | 通过 | 暂停时 `paused=true`、dist 76.62 冻结、暂停面板出现；恢复后 dist 推进到 99.53、无跳位；`/tmp/zhuri-final2-B06-pause.png` |
| B07 死亡重开 | 通过 | 规则层 crash 触发结算，`ends` +1、bestLi 写入 615；重开后 dist 205→3.7、热量 0、runId 更新、只创建一个新局；`/tmp/zhuri-final2-B07-dead.png` |
| B08 无尽纪录 | 通过 | 高局 615 里后刷新读回 615；随后低局 500 里未覆盖历史最佳 |
| B09 征途 | 通过（入口真实 + 终点夹具） | 从菜单 `onButton('startJourney')` 进入 `mode=journey`；夹具推进到 li=6004 后 state=ended、stage=3、胜利面板出现、`journeyDone=true`；下一局 stage=0；`/tmp/zhuri-final2-B09-journey.png` |
| B10 功能页面 | 修复后通过 | 任务/成就/商店/强化/纪录/设置 6 页均打开并正确显示，返回后重开正常；修复前成就页抛 `Cannot set properties of undefined (setting 'string')` |
| B11 竖屏布局 | 部分验证 | 360×640、390×844、480×900 三种 CDP viewport 截图已留（`/tmp/zhuri-final2-B11-*.png`）；canvas 固定 720×1280 导致视口裁切，按钮可达性不能代表真实手机 |
| B12 音频 | 通过（逻辑与存档） | 默认 muted=true；开/关静音写回存档；BGM 补建由 `tests/phase8-3-fixes.spec.ts` 覆盖；切后台恢复由平台生命周期测试覆盖；连续开局无重复叠播的运行时证据见下方 10 次重开 |

浏览器控制台唯一 warning 为 `平台生命周期不支持: 浏览器使用引擎 Game.EVENT_HIDE 兜底`，属设计内降级；无 exception。

## 4. 底层规则、地图、双模式与持久化

- 定向套件 `npx vitest run tests/core.spec.ts tests/phase1.spec.ts tests/phase2.spec.ts tests/phase3.spec.ts tests/phase4.spec.ts tests/phase6.spec.ts tests/ad.spec.ts tests/phase8.spec.ts tests/phase8-3-fixes.spec.ts`：**9 文件 / 175 项通过**。
- 碰撞/动作边界、转弯、护盾/无敌/神杖交互：`core.spec.ts`、`phase1.spec.ts`、`phase2.spec.ts`、`phase3.spec.ts` 覆盖；跳跃/滑铲/变道/转弯的正例、迟到、边界均有断言。
- 地图生成：1000 种子零无敌真实核心重放（Tier 0/1/2、移动障碍、跨波合并），100000 地块连接验证，主题过渡/兜底/转弯安全区在 phase2/3/4 覆盖。本轮未发现必死种子。
- 高温/饮水保底/四主题/道具叠加与跨局清空：phase4 覆盖；浏览器核对 HUD 暑值与核心一致。
- S01–S05、E01–E03、A01–A02：phase6/phase8/ad 测试覆盖正常落盘、v1 迁移、主档/双档损坏、写入失败、幂等领取、购买强化、日期规则、广告事务五分支；浏览器侧确认广告关闭时入口与发奖路径均不执行，主流程可完整运行。
- 征途阶段事件单次触发、通关存档与下一局初始化：phase4 与浏览器 B09 双重确认。

## 5. 本轮修复记录

| 等级 | 问题与原始证据 | 根因 | 修复/复验 |
|------|---------------|------|-----------|
| 阻塞（测试假设） | 基线 `npm test` 1 失败：`tests/phase8.spec.ts:266` expected 0 to be 2 | 测试用 UTC 日期，产品用本地日期；跨零点误触发每日重置 | 改用 `localDate()` 并注明口径；269/269 通过 |
| 阻塞（功能） | B10 打开成就页抛 `TypeError: Cannot set properties of undefined (setting 'string')`，调用栈 `Hud2D.openPage → Game.refreshPage` | HUD 只创建 8 个页面行标签，成就/商店页最多 9 行，越界写 undefined | 页面行扩容到 12；新增 12 行 openPage/pageTap 回归；浏览器 B10 六页复验通过 |

两处修复均无玩法数值变更；修复后重跑全量门禁、浏览器 B10、重新构建微信包。

## 6. Phase 9 接手材料与耐久基线

- 画面样本：开场 `/tmp/zhuri-final2-B01-title.png`；固定种子 777 的路口窗口（cornerD=102.217，dir=1，turnWindow 打开）`/tmp/zhuri-final2-corner2.png`；结算 `/tmp/zhuri-final2-B07-dead.png`；征途通关 `/tmp/zhuri-final2-B09-journey.png`；奔跑 `/tmp/zhuri-final2-B05-run.png`。视口 720×1280、3D/mid、默认静音；种子仅在路口样本固定为 777，其余为真实随机。
- 10 次连续开局/结算/重开：堆 44.68MB → 41.34MB、节点 209 → 211、`ads.runs=21/ends=21`，无持续增长；记录 `/tmp/zhuri-final2-restarts.json`。
- 10 分钟浏览器耐久：22 次采样（日志 `/tmp/zhuri83-browser-stress.log`）。JS 堆 33.70–64.43MB 波动，无单调增长；节点 212–368，障碍 ≤10、碎片 ≤25、道具 ≤3；状态 run/dead 交替（死亡后自动重开），无异常退出。可采指标为 JS 堆、节点数、实体数、核心状态；浏览器帧时间/GPU 无法从 CDP 导出，标注未采集。
- 画面问题留给 Phase 9：路口提示与角色遮挡关系、障碍辨识度、太阳/饮水反馈的视觉强度需美术阶段按上述截图打磨；本阶段只修功能阻塞。

## 7. 微信测试包与模拟器

- 旧产物已隔离到 `/tmp/zhuri-final2-old-wechatgame`（10M），再执行 `bash scripts/build-wechat.sh`：exit=36（该环境成功码），构建日志 `/tmp/zhuri-final2-wechat-build.log`，本轮约 4s，初始场景错误 0。
- 产物：`build/wechatgame/`，main bundle 453,777 B、game.json 186 B、project.config.json 459 B；目录约 10M，其中 `cocos-js` 7.2M、`assets/resources` 1.5M、`assets/main` 456K。Game 类压缩 uuid 与 `main.scene` 一致且注册成功；修复代码（`uiToLogical`、`showTutorialHint`）在 bundle 中。
- 配置：renderMode=3d、quality=mid、ad.enabled=false、广告位全空；产物未见 MCP 密钥或 Authorization Token。
- 模拟器：`cli open --project build/wechatgame` 返回 `Error: 不存在此 AppID`（构建器默认 AppID），服务端口与登录均正常；未伪造 AppID，冷启动/手势/存档读回/切后台在模拟器中**未执行**，记录为环境阻塞。

## 8. 结案

**功能基线已冻结，模拟器待验。**

- 已通过：全量测试 269/269、type-check、lint、种子重放与长跑、浏览器 B01–B12（触控与视口适配部分受限）、定向规则/存档/经济/广告 175 项、10 次重开、10 分钟耐久、微信包重建与静态检查。
- 阻塞已关闭：测试日期口径、HUD 长页面越界。
- 待验：微信模拟器（有效 AppID 缺失）；Android/iOS 真机、触控手感、发热、正式广告统一留到 Phase 11；浏览器触控自动化受 headless CDP 限制，已由 Node cc 桩测试覆盖命中逻辑。
- 主包体积门槛：构建目录约 10M，微信 4MB 主包限制未能在本机确认，保留为风险。

提交：`da05750754fa60c87ab557b33f6cec8fda3a3f11`（fix(phase8.3-final): HUD 长页面越界与测试日期口径）；本报告的 10 分钟耐久数据由后续文档提交补记（见 `git log -1`）。工作区保留未提交的本地编辑器配置 `profiles/v2/packages/scene.json`，不进入包与提交。
