# 技术架构

> 原则（源自开发规范）：模块化、数据驱动；核心逻辑与渲染、输入、平台接口解耦；参数可校验，杜绝散落魔法数字。

## 分层

```
assets/scripts/
├── Game.ts                 # 引导：加载配置→装配→主循环（不写玩法）
├── config/
│   └── GameConfig.ts       # 配置类型 + JSON 加载 + 运行时校验（非法即抛错）
├── core/                   # ★ 零 cc 依赖，可在 Node 中单测
│   ├── types.ts            # 实体/状态/意图/事件类型
│   ├── rng.ts              # 可播种随机源接口（测试确定性）
│   └── GameCore.ts         # 状态机 + 全部玩法机制（唯一的规则真源）
├── input/
│   └── InputController.ts  # 触摸/键盘 → 归一化意图（gesture/tap），不含玩法
├── render/
│   ├── IRenderer.ts        # 渲染器接口：attach/update(dt)/setMuted...
│   ├── Hud2D.ts            # 2D UI 层（HUD/面板/红闪/暗角），双渲染器共用
│   ├── Renderer2D.ts       # Graphics 伪3D（P0 视觉，回退用）
│   └── Renderer3D.ts       # 真3D：透视相机 + 运行时构建场景（默认）
└── platform/
    └── AdService.ts        # 激励视频接口：MockAdService / WxAdService
```

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
