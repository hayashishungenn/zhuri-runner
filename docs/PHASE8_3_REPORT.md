# Phase 8.3 报告 —— 无真机最终测试与冻结验收

> 日期：2026-11-26。验收对象：HEAD `b67e67b7a211f987f2a555093010c4e91f008474`（Phase 8.2）+ 本轮本地修复。最终结果以当前工作区重跑记录为准，不采信 Phase 8.2 的 263 项历史自述。

## 0. 基线与环境

- 分支 `main`，跟踪 `origin/main`，验收开始时 `git status --short` 为空；无暂存/未暂存改动，因此测试对象是纯 HEAD，无用户本地改动叠加。
- 系统：macOS 27.2.1 / arm64；Node v22.20.0；npm 10.9.3；Vitest 5.1.2；TypeScript ~5.9；Cocos Creator 3.8.8（项目 `package.json` 锁定）。
- 浏览器：Google Chrome 158.0.8127.89（headless、独立用户目录）。
- 微信开发者工具：已安装，`cli islogin` 返回 `{"login":true}`，服务端口可用（CLI 端口 63999）；但项目没有有效 AppID，模拟器启动被阻塞（见第 5 节）。
- Android：adb 1.0.41，`adb devices` 为空；iOS：无设备。二者均不做浏览器替代。
- 依赖：使用现有 `node_modules` 与 `package-lock.json`，未重新安装依赖，无安装错误。

## 1. 全量门禁（当前工作区重跑）

| 命令 | 结果 |
|------|------|
| `npm test` | **19 文件 / 268 项全部通过**，4.50s（基线 18 文件 / 263 项为修改前；新增 5 项本轮回归） |
| `npm run type-check` | 通过（0 错误） |
| `npm run lint` | 通过（0 错误） |

默认 `npm test` 已包含以下重跑入口，无需单独执行：
- `tests/phase8-1-engine.spec.ts:343`：1000 种子 × 18s × 3 个起步带，**零无敌**真实碰撞重放，断言 `totalDeaths === 0`、Tier 0/1/2、移动障碍、跨波组合与转弯覆盖。
- `tests/phase3.spec.ts:330`：1000 种子 × 60s 逐波可达性重放，断言 `replayFails=0`、死亡哨兵、转弯/验证计数。
- `tests/phase8-stress.spec.ts:30`：1000 局 × 最多 600 帧，对象上界与非 NaN。
- `tests/phase8-stress.spec.ts:66`：600s / 36000 帧连续奔跑，Node 逻辑帧时间 p50 0.0002ms / p95 0.0020ms / p99 0.0035ms / max 0.226ms。
- `tests/phase1.spec.ts:236`：600s 随机输入；`tests/phase2.spec.ts:174`：1800s×60fps 地图/转弯/重开；`tests/mapgen.spec.ts:30`：100000 地块连接验证。

## 2. 本轮发现并修复的问题

| 等级 | 问题与证据 | 修复 | 复验 |
|------|-----------|------|------|
| 阻塞 | 触控坐标换算错误。CDP 校准：CSS (200,200) → Cocos UI (109.6875,475.2422)，证明 `getUILocation()` 是可见区左下角原点；旧 `toLogicalX/Y` 按居中坐标换算，横屏开局/导航按钮点不到，竖屏同样有偏移 | `render/layout.ts` 新增 `uiToLogical(ux,uy,visibleW,visibleH)`；InputController 用 `view.getVisibleSize()` 实时换算 | `tests/phase8-3-fixes.spec.ts` 3 项（含横屏校准数据与竖屏往返）；浏览器键盘主流程复验 |
| 重要 | 默认静音下取消静音后只有 SFX、无 BGM/环境音：`AudioMgr.load()` 在 muted 时不创建 source，`setMuted(false)` 只播放已有 source | `setMuted(false)` 在已加载时调用 `startBgm()` 补建并播放 | `tests/phase8-3-fixes.spec.ts` 1 项；浏览器静音开关往返 |
| 重要 | 教程步骤在 `GameSession` 内推进，但 HUD 提示只在 `startTutorial()` 设置一次；玩家永远只看到第一步 | `Game.update()` 每帧按 `tutorial.step` 同步 HUD 文案，完成/跳过则隐藏 | `tests/phase8-3-fixes.spec.ts` 1 项 Session 推进；修复后浏览器需复验提示更新 |
| 文档/声明 | Phase 8.2 声称“输入经命令队列/确定性回放接入生产”，但 `Game.ts` 调用 `submitCommand` 默认 `immediate=true`，`GameSession.onBeforeStep`/ReplayRecorder 未接入运行期 | 本轮不改行为；在报告与文档中限定为测试/开发工具能力，不宣称生产输入录制 | 源码证据：`GameSession.ts:162-167`、`Game.ts:342-352` |

修复提交前的原始证据：浏览器校准日志、标题页/横屏截图（`/tmp/zhuri83-title.png`）、横屏点击无障碍树未命中记录。修复只涉及 4 个源码文件与 1 个测试文件，未改玩法数值。

## 3. 浏览器实玩（正常入口，独立 Chrome 配置）

> Web-desktop 构建由 Creator CLI 生成，通过本地 HTTP 服务加载。为在桌面 headless 下复现竖屏布局，测试用 CDP viewport=720×1280，并临时把**构建产物** `index.html` 的 canvas 改为 720×1280；源码与最终微信候选包未受影响，最终 web 构建在记录后已重新生成。

- **IN-01 冷启动**：标题页出现「逐 日」「夸父逐日·神话跑酷」「起跑」「逐日征途」与 7 个导航项（广告关闭后无「奖励」），HUD 显示速度 13、暑 0；无白屏、无阻塞资源错误；存档默认 `muted=true`。
- **IN-02/03 教程**：从标题教程入口进入，提示「左右滑动 切换跑道（跳过›右下）」；错误动作（跳）后步骤保持；修复前 HUD 文案不刷新，修复后浏览器复验：正确切道后提示变为「上滑 跳跃（跳过›右下）」（Session 步骤 id=jump）。跳过教程后存档写入；因 CDP 触控未注入，跳过用直接方法调用验证。
- **IN-04/05 四向输入与连续动作**：键盘左右/跳/滑铲、连续左右与重复输入后核心仍在 `run`，距离从 25.5 → 48.2，`targetLane` 未越界；未观察到输入卡死。
- **IN-06 暂停恢复**：暂停时 `paused=true`，距离 49.26 冻结，暂停面板「暂 停/继续奔跑/重新起跑」出现；恢复后距离推进到 57.99，首帧无跳位。
- **IN-07 结算与重开**：用规则层 `core.crash()` 精确触发死亡，死亡面板仅保留「重新起跑」（广告关闭）；连续 10 局重开后 `ads.runs=12`、`ads.ends=11`（含前序 2 局），每局距离/道具/热量正确重置，未见重复结算。
- **SAVE-01**：10 局后刷新，`bestLi` 与金币保持（存档读回 362 里、金币 10），静音状态持久化。
- **AD-01**：死亡面板无复活/金币×2入口，标题无「奖励」页；广告事务计数 requests/shows/rewards 全为 0，主玩法可完整运行。
- **音频**：默认静音；通过正常 HUD 按钮回调切到非静音并写回存档，再切回静音；BGM 补建由单元回归覆盖。
- **征途模式**：浏览器中 `startMode('journey')` 成功进入 `mode='journey'`、stage=0；完整阶段事件/通关存档由 `tests/phase4.spec.ts` 与 `tests/phase8-1-engine.spec.ts` 覆盖，本轮浏览器未做到自然跑到 6000 里，标记为“入口通过，完整通关为逻辑层证据”。
- **IN-08 视口适配**：720×1280 竖屏下标题/暂停/死亡面板与任务、商店、设置入口可见；窄屏/宽屏仅做了 CDP 视口截图，因构建 canvas 固定尺寸，按钮可达性不完全代表真实手机，标记部分验证。
- **2D 回退**：用临时测试配置把打包后的 `game-config` 改为 `renderMode:"2d"`，浏览器正常入口加载后 `renderMode=2d`，Enter 开局后核心进入 `run` 且距离推进到 19.9；测试后已恢复为默认 `3d`，最终候选包仍为 3D。

> 浏览器 CDP 的鼠标事件会生成 DOM pointer/mousedown，但本轮 headless 会话中 Cocos 的 TOUCH_START 未收到；键盘事件在 canvas focus 后正常注入。因此触控手势的“浏览器实玩”未能闭环，手势接线由 Node cc 桩测试覆盖，真机触控仍待验。

## 4. 底层规则、地图、经济与存档

- 碰撞/跳跃/滑铲/变道/转弯、临界时机、护盾/无敌/神杖交互：`tests/core.spec.ts`、`tests/phase1.spec.ts`、`tests/phase2.spec.ts`、`tests/phase3.spec.ts` 覆盖；千种子零无敌重放 0 死亡。
- 地图生成：100000 地块连接、主题过渡、兜底生成、转弯安全区由 `tests/mapgen.spec.ts`、`tests/phase3.spec.ts`、`tests/phase4.spec.ts` 覆盖。
- 逐日/高温/饮水/保底/四主题与征途通关：由 `tests/phase4.spec.ts` 与浏览器入口共同覆盖。
- 经济/成长/任务/成就/强化：由 `tests/phase6.spec.ts`、`tests/phase8-balance.spec.ts` 覆盖；浏览器验证了金币/最佳纪录的存档往返。
- 存档异常：主档损坏→备份恢复、双档损坏→默认、v1 迁移、写入失败回落由 `tests/phase6.spec.ts` 与本轮 `tests/phase8.spec.ts` 覆盖；本轮另确认备份不再被损坏主档覆盖。
- 广告：候选包 `ad.enabled=false`，浏览器入口隐藏、事务不执行；成功/取消/失败/超时/重复回调/all 5 场景由 `tests/ad.spec.ts` 与 `tests/phase8.spec.ts` 覆盖。

## 5. 微信候选包与模拟器

- 构建命令：`bash scripts/build-wechat.sh`，退出码 36（该环境成功码），日志 `/tmp/zhuri83-final-wechat-build.log`，本轮构建耗时约 3s，初始场景错误 0。
- 产物：`build/wechatgame/assets/main/index.js` 453,712 B；整个构建目录约 10MB，其中 `cocos-js` 7.2MB、`assets/resources` 1.5MB、`assets/main` 456KB；微信主包 4MB 门槛无法确认，标记风险。
- 完整性：Game 类压缩 uuid 与 `main.scene` 一致且已注册；`uiToLogical`、`startBgm`、`showTutorialHint`、`RunLedger`、`adrewards` 均进入 bundle。
- 配置：广告总开关 false、五广告位与插屏 ID 全空、默认画质 mid、默认静音 true；产物无 MCP 密钥/Authorization Token（扫描只见构建器默认 AppID）。
- 模拟器：CLI 已登录且服务端口可用，但 `cli open --project build/wechatgame` 返回 `不存在此 AppID`（构建器默认 `wx6ac3f5090a6b99c5`）；临时改成 `touristappid`/空串仍被拒绝。未伪造 AppID，**模拟器冷启动→存档流程未验证**，属于环境阻塞，不是代码启动失败证据。

## 6. 长时浏览器压力

10 分钟浏览器实测脚本在独立 Chrome 中每 30s 采样一次 `performance.memory`、活跃节点数、核心实体数与里程；死亡后自动重开以维持连续运行。22 次采样结果（日志 `/tmp/zhuri83-browser-stress.log`）：

- JS 堆：32.65MB → 64.97MB 区间波动，无单调增长；死亡重开后回落（最低 32.65MB）。
- 场景节点：203–362，障碍 ≤10、碎片 ≤25、道具 ≤3；未观察到随运行时间持续线性增长。
- 状态：run/dead 交替（死亡后自动重开），无异常退出。
- 浏览器帧时间/GPU 指标无法从 CDP 导出，标记未采集；Node 侧 600s 逻辑帧时间与 1000 局结果见第 1 节。

## 7. 剩余风险与结案

- **微信模拟器待验**：无有效 AppID；需用户用真实 AppID 重新构建后在开发者工具验证冷启动、教程、手势、切后台、结算、重开与存档读取。
- **真机待验**：Android/iOS 帧率、发热、物理触控、系统打断、真实广告播放均未验证；`adb devices` 为空且无 iOS 设备。
- **浏览器触控**：headless CDP 下 Cocos TOUCH_START 未注入，手势仅由 Node 桩测试覆盖；真机触控手感仍需人工确认。
- **包体**：构建目录约 10MB，微信主包 4MB 门槛未确认；需开发者工具实际上传/分包配置验证。
- **命令队列/回放**：目前仅测试与工具能力，未接入生产输入录制。

## 8. 最终状态

**候选包已生成，微信模拟器待验**。自动化（268/268）、类型、lint、浏览器主流程、产物静态检查均完成；微信模拟器因有效 AppID 缺失阻塞；Android/iOS 真机、触控手感、发热与正式广告按实际情况标注待验。

提交 hash：`89874f73228b1c0f84d2c9a735c4ab6f9bbfb555`（feat(phase8.3): 最终验收修复与候选包）。本轮构建产物对应此提交之后的工作区；若构建后再次改动影响产物的代码/配置，必须重新构建并复验。
