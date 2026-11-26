# 技术架构

> 原则（源自开发规范）：模块化、数据驱动；核心逻辑与渲染、输入、平台接口解耦；参数可校验，杜绝散落魔法数字。

## 全模块地图（任务书模块 ↔ 本仓库实现）

任务书规划的模块域 → 本仓库的落点与状态（✅ 已实现 / 🅿️ 规划中，见 ROADMAP）：

| 任务书模块 | 落点 | 状态 | 说明 |
|-----------|------|------|------|
| Core | `core/`（GameCore 固定步长状态机、rng 独立子流、Reachability 可达规划、RunLedger、AdRewardCoordinator、types、Logger） | ✅ | 规则唯一真源；零 cc 依赖可单测 |
| Runner | `core/GameCore.ts` 固定步长（60Hz）速度/跳跃/俯冲/变道/踉跄减速/暂停/连续几何 | ✅ | 暴露 `renderAlpha`/`interp*` 供渲染插值 |
| World | `core/track.ts`（SegmentPath 分段路径与 `isSafeSpawnRange` 区间校验）+ `core/MapGenerator.ts`（独立种子/单局覆写）+ `core/WorldShift.ts`（原点重定位） | ✅（90° 转弯/坡度/主题/特殊地块） | 统一 `toAbsD`/`toRelZ` 坐标转换 |
| Input | `input/InputController.ts`（多点触控按 ID 隔离 / TOUCH_CANCEL / 阈值配置化） | ✅ | 意图归一化，不含玩法；核心支持 `onBeforeStep` 固定帧采样 |
| Camera | `render/Renderer3D.updateCamera`（跟随插值/跳跃高度跟随/速度 fov/震屏上限/穿模防护） | ✅ | 🅿️ 首人称/过场再抽 `camera/` |
| Collision | `core/GameCore.updateRun` 连续扫描碰撞（`[currZ,prevZ]` 区间 + 角色宽度 + 跳跃/滑铲高度 + 滚石连续 `visLane`） | ✅ | 零 cc 物理依赖，防高速穿透 |
| Gameplay | GameCore 事件系统 + 高温饮水 + 7 神通 + 无尽/征途双模式 + 教程单局覆写 | ✅ | 不修改共享配置，状态变化经接口与事件输出 |
| Economy | `core/Economy.ts`（幂等事务日志）+ `core/RunLedger.ts`（累计差额金币/复活增量结算）+ `core/AdRewardCoordinator.ts` | ✅ | 防重放、防取整丢倍率、防迟到回调串局 |
| Save | `platform/Save.ts`（v2 校验和 + 备份槽 + 字段范围清洗 + 高版本写锁 + 损坏隔离 + 异常捕获） | ✅ | 禁止静默丢弃高版本或正常进度 |
| Platform | `platform/AdService.ts`（mock/wx）、`platform/ErrorHooks.ts` | ✅ | 🅿️ P3 wx.share/P4 广告点位扩展 |
| UI | `render/Hud2D.ts`（HUD/面板/弹字，按钮命中唯一持有） | ✅ | 🅿️ P2 设置/商店浮层（状态机栈模式） |
| Audio | — | 🅿️ P2 | `audio/` AudioManager + 播放接口（静音开关已预留于 Hud2D） |
| Assets | 配置即资产（`resources/game-config.json`）+ 程序化几何 | ✅（现状） | 🅿️ P2 美术/音频资产管线（分包，受 COMPLIANCE 包体约束） |

依赖方向（箭头 = 允许依赖，禁止反向）：

```
Game.ts(引导) ─▶ config / core / input / render / platform
render ─▶ core(只读状态) ； input ─▶ core.types(意图) ； platform ─▶ config
core ─▶ config(schema) ； core 不得依赖 render/input/platform/cc   ← 由测试约束（core 可在 Node 运行即证明）
```

## 分层（当前目录）

```
assets/scripts/
├── Game.ts                 # 引导：全局错误钩子→加载配置→装配→主循环（不写玩法）
├── config/
│   ├── GameConfigSchema.ts # 配置类型 + 纯 TS 校验（非法即抛错，不静默回退）
│   └── GameConfig.ts       # resources.load 加载器（cc 依赖层）
├── core/                   # ★ 零 cc 依赖，可在 Node 中单测
│   ├── types.ts            # 实体/状态/意图/事件类型
│   ├── rng.ts              # 可播种随机源接口（SystemRng / SeededRng）
│   ├── track.ts            # SegmentPath 分段路径（出入口连续性断言/采样/安全区）
│   ├── MapGenerator.ts     # 无限地图生成（种子化/权重/转弯间隔/主题/预生成回收）
│   ├── WorldShift.ts       # 世界原点重定位（长距离 float32 精度防护，纯数学可测）
│   ├── Logger.ts           # 分级日志（core 不写日志，供外层使用）
│   └── GameCore.ts         # 状态机 + 玩法机制（含踉跄减速/暂停/动作优先级）
├── input/
│   └── InputController.ts  # 多点触控按 ID 隔离 / TOUCH_CANCEL / 键盘；阈值来自配置
├── input/
│   └── InputController.ts  # 触摸/键盘 → 归一化意图（gesture/tap），不含玩法
├── render/
│   ├── IRenderer.ts        # 渲染器接口：render / onCoreEvents / destroy
│   ├── CharacterAnimator.ts # 动画状态接口（idle/run/jump/slide/stumble/dead，可整体换模型）
│   ├── ProceduralKuafu.ts  # 几何体程序化夸父（CharacterAnimator 实现，原创零授权风险）
│   ├── Hud2D.ts            # 2D UI 层（HUD/暂停面板/红闪/暗角），双渲染器共用
│   ├── Renderer2D.ts       # Graphics 伪3D（P0 视觉，回退用）
│   ├── Renderer3D.ts       # 真3D：path 化相机/分段 ribbon 跑道/天空锚点/重定位应用（默认）
│   ├── ScreenFx.ts         # 震屏/红闪/慢动作（事件驱动，衰减曲线）
│   └── layout.ts           # 逻辑坐标↔UI 坐标唯一换算源
└── platform/
    ├── AdService.ts        # 激励视频接口：MockAdService / WxAdService
    └── ErrorHooks.ts       # 全局未捕获异常钩子（wx / 浏览器）
```

## 生命周期、状态机、日志与错误处理

- **生命周期**：`Game.start()`（异步装配：错误钩子→配置→核心→广告→渲染器→输入）→ `update(dt)`（核心→广告→事件路由→HUD→渲染）→ `onDestroy()`（输入解绑、渲染器销毁）。装配失败显式抛错停止启动（不降级）。
- **状态机**：`title → run ⇄ dying → dead`（GameCore 唯一持有；run 内含 paused 标志与踉跄修正器；动作优先级表见 GAME_DESIGN）。
- **日志**：`core/Logger` 四级（debug/info/warn/error），`setLogLevel` 全局控制；微信端 error 自动进入后台 jsError 统计。core 层不写日志（确定性约束），由外层消费事件后记录。
- **错误处理**：三层——① 启动期：配置校验抛错（fail-fast）；② 运行期：`platform/ErrorHooks` 捕获未处理异常/拒绝并记录（微信端同步上报后台）；③ 确定性约束：随机全部走 Rng 接口，可注入种子复现。

## 数据流（每帧）

```
Input ──意图──▶ GameCore.update(dt, intents) ──状态+事件──▶ IRenderer.render(core)
                    │
                    └─▶ 事件（弹字/里程碑/死亡/发奖）──▶ HUD 与平台层消费
```

- **GameCore** 是唯一规则真源：状态机 `title → run → dying → dead`，持有全部实体（障碍/拾取/装饰/粒子），只改数据不碰节点。
- **渲染器**只读核心状态做呈现，允许各自维护纯视觉副作用（粒子、抖动、缓动）。
- **平台层**以接口注入；`typeof wx === 'undefined'` 时自动用 Mock，业务不感知。

## 配置驱动

`assets/resources/game-config.json`（随构建打包，`resources.load` 加载）：

```jsonc
{
  "renderMode": "3d",              // 3d | 2d 回退
  "world": { "laneWidth": 110, "spawnZ": 46, "despawnZ": -2, "runwayHalf": 190 },
  "speed": { "base": 13, "gain": 0.045, "max": 16 },
  "player": { "jumpDuration": 0.62, "slideDuration": 0.55, "laneLerp": 11, "reviveInvincible": 2.2 },
  "spawn": { "rowInterval": 8, "singleRowChance": 0.45, "propInterval": 2.4,
             "fragmentChance": 0.6, "fragmentCount": 5, "fragmentGap": 1.5, "treeChance": 0.7 },
  "obstacle": { "hitZ": 0.55, "jumpSafeFrom": 0.12, "jumpSafeTo": 0.88 },
  "death": { "slowmo": 0.25, "dieDelay": 0.95 },
  "milestone": { "step": 1000, "skyRange": 30000 },
  "ad": { "mode": "mock", "countdownSteps": 3, "stepDuration": 0.85, "adUnitId": "" }
}
```

`validateConfig` 校验类型/取值域/逻辑一致性（如 spawnZ > hitZ），失败**抛错拒绝启动**（规范：不静默回退）。

## 真3D 渲染方案（Renderer3D）

- **运行时构建**，不依赖编辑器手工摆场景：向当前 Scene 挂 3D 根节点，`cc.primitives`（box/sphere/cone/capsule）生成 Mesh，`builtin-unlit` 材质纯色渲染——与 2D 版扁平色板一致的神话剪影风，且免光照、低端机友好。
- 相机：PERSPECTIVE（跟随车道微偏移 + 死亡震屏），SOLID_COLOR 清屏 + 远景色带平面拼出分段渐变天空（对应 2D 版分段渐变），锥体远山、太阳球体。
- 实体映射：核心逻辑坐标（车道 ±1、z 0~46）线性映射到世界单位；跳跃/俯冲驱动的程序化角色动画（胶囊+球体组合的夸父剪影，含桃木杖与发髻）。
- UI 层保持 2D Canvas（Hud2D 共用），红闪/暗角/慢动作黑边留在 UI 层。

## 测试策略

- `tests/`（vitest）直接 import `assets/scripts/core/*` 与 `GameConfig`（零 cc 依赖保证可测）。
- 构建验证：`scripts/build-wechat.sh`（Creator CLI），编译错误即失败。
- 编辑器视觉预览、微信真机为**人工验证项**，单独记录于 TEST_REPORT，不伪造。

## 已知权衡（详见 KNOWN_ISSUES）

- 每个 MeshRenderer 独立 draw call，先保证正确性，P3 做合批/DR 优化。
- 透明材质暂不用于 3D 层（发光/粒子用缩放与配色替代），规避 WeChat 端混合排序问题。
