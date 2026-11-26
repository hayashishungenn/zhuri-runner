# 技术架构

> 原则（源自开发规范）：模块化、数据驱动；核心逻辑与渲染、输入、平台接口解耦；参数可校验，杜绝散落魔法数字。

## 全模块地图（任务书模块 ↔ 本仓库实现）

任务书规划的模块域 → 本仓库的落点与状态（✅ 已实现 / 🅿️ 规划中，见 ROADMAP）：

| 任务书模块 | 落点 | 状态 | 说明 |
|-----------|------|------|------|
| Core | `core/`（`GameSession` 单局与成长协调器、`GameCore` 规则真源、`SimulationClock`、`CollisionSystem`、`rng` 独立子流、`Reachability`、`Replay`、`RunLedger`、`AdRewardCoordinator`、`types`、`Logger`） | ✅ | 零 cc 依赖，可独立单测与确定性回放 |
| Runner | `core/GameCore.ts` + `core/SimulationClock.ts`（60Hz 固定步长/后台恢复/`renderAlpha` 插值） | ✅ | 暴露 `ReadonlyCoreView` 与 `CoreCommand` 队列 |
| World | `core/track.ts`（SegmentPath 分段路径与 `isSafeSpawnRange` 区间校验）+ `core/MapGenerator.ts`（独立种子/单局覆写）+ `core/WorldShift.ts`（原点重定位） | ✅（90° 转弯/坡度/主题/特殊地块） | 统一 `toAbsD`/`toRelZ` 坐标转换 |
| Input | `input/InputController.ts`（多点触控按 ID 隔离 / TOUCH_CANCEL / 阈值配置化） | ✅ | 意图归一化，经 `CoreCommand` 提交核心 |
| Camera | `render/Renderer3D.updateCamera`（跟随插值/跳跃高度跟随/速度 fov/震屏上限/穿模防护） | ✅ | 🅿️ 首人称/过场再抽 `camera/` |
| Collision | `core/CollisionSystem.ts` 纯数学连续扫描碰撞（`[currZ,prevZ]` 区间 + 角色宽度 + 跳跃/滑铲高度 + 滚石连续 `visLane` + 拾取扫描） | ✅ | 零 cc 物理依赖，与 Reachability 共享几何常量 |
| Gameplay | `GameSession` + `GameCore` 事件系统 + 高温饮水 + 7 神通 + 无尽/征途双模式 + 教程单局覆写 | ✅ | 共享配置经 `ConfigRegistry.deepFreeze` 冻结，状态变化经命令与事件输出 |
| Economy | `core/GameSession.ts` + `core/Economy.ts` + `core/RunLedger.ts` + `core/AdRewardCoordinator.ts`（单次消费票据 `ticketId`） | ✅ | 防重放、防取整丢倍率、防迟到回调串局、防重复领奖 |
| Save | `platform/Save.ts`（v2 校验和 + 备份槽 + 字段范围清洗 + 高版本写锁 + 损坏隔离 + 异常捕获） | ✅ | 禁止静默丢弃高版本或正常进度 |
| Platform | `platform/AdService.ts`（mock/wx）、`platform/ErrorHooks.ts` | ✅ | 🅿️ 真机流量主联调 |
| UI | `render/Hud2D.ts`（HUD/面板/弹字，按钮命中唯一持有） | ✅ | 只读核心与会话状态，动作经回调交由 `GameSession` |
| Audio | `audio/AudioMgr.ts`（BGM/环境音/8 实例 SFX 池 + 静音持久化 + 完整销毁） | ✅ | 21 个程序化原创音频 |
| Assets | `config/ConfigRegistry.ts`（跨配置校验+冻结）+ `render/RenderContracts.ts`（FBX/glTF 角色与模块化地块替换契约 + `ResourceTracker`） | ✅ | 商业级 3D 资产可零侵入接入，不改动核心玩法层 |

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
