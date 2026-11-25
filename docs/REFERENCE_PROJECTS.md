# 参考项目分析报告（Phase 0 开源调研）

> 调研方式：2026-11-25 通过 GitHub API / 网页逐仓实际拉取元数据与关键源码，非转述。
> 结论先行：**6 个目标仓库全部存在，但仅 1 个（thegreatidea/3D-Endless-Runner-Unity）代码可合法商用复用（MIT）**；其余无许可证（默认保留所有权利）或按平台 EULA 管理，只可参考设计思路，不可复制代码/资产。
> 本项目代码全部自主实现（已完成的 P1 架构即自主实现），第三方仓库仅作为**设计参考**。

## 逐仓分析

### 1. Unity-Technologies/EndlessRunnerSampleGame（Trash Dash）

| 项 | 实测值 |
|----|--------|
| 状态 | ✅ 存在，501 stars，最近推送 2026-09-22，未归档，Unity 2019.3（master） |
| 许可证 | **仓库无 LICENSE**；`Assets/EndlessRunner_Third-PartyNotice.txt` 明示 "This asset is governed by the Asset Store EULA"（仅 Luckiest Guy 字体为 Apache 2.0） |
| 可复用性 | **❌ 代码/资产不可商用复用**（Asset Store EULA）；设计思路可参考 |

架构要点（来自 INSTRUCTIONS.txt 与仓库结构，实测）：
- **状态机 + 栈**：`Scripts/GameManager` 驱动 Loadout/Game/GameOver，支持状态压栈（GameOver 叠加于 Game 之上再弹出）——比本项目当前线性状态机更灵活，P2 引入「暂停/商店」类浮层时可借鉴。
- **Addressables 主题/角色**：主题与角色走 AssetBundle/Addressables，新增角色只需 prefab 标记 "character" label——对应本项目的 Assets 模块规划（P2 资产管线）。
- **广告点位**：reviveVideo（复活）、missionVideo（第三任务位）——与本项目 AdService 的复活点位一致，P4 可扩展多点位。
- **弯曲世界 shader**：自定义 shader 让世界向下弯曲暗示距离并遮挡远处对象"弹出"——低成本的视觉纵深技巧，P2 视觉优化候选（当前用 Z_SCALE 线性透视 + 色带天空达成类似效果）。
- 本地存档为简化实现，官方明示真实产品需加校验——印证本项目 Save 模块规划需防篡改设计（IAA 产品风险低，可后置）。

### 2. cocos/example-projects（官方 2.x 范例）

| 项 | 实测值 |
|----|--------|
| 状态 | ✅ 存在，1320 stars，最近推送 **2023-01-17（停更）** |
| 许可证 | **无 LICENSE**（API license: null，页面无授权声明） |
| 覆盖 | **仅 Cocos Creator 2.x**（Sprite/Widget/Button/动作/音频等基础范例），无 3.x 内容 |
| 可复用性 | ❌ 无授权 + 版本过旧，**对本项目无实际价值** |

替代调研：`cocos/example-3d` 已重定向至 `cocos/cocos-example-projects`（588 stars，最后推送 2023-09，同样无许可证声明）。**结论：官方示例仓库均无明确开源许可证，引擎本身（cocos-engine）为 MIT，但示例代码不可假定可复用**；本项目仅参考引擎官方 API 文档与类型声明（随编辑器分发）。

### 3. cocos-creator/cocos-parkour-character-control（物理角色控制）

| 项 | 实测值 |
|----|--------|
| 状态 | ✅ 存在，3 stars，最近推送 **2023-01-10（停更）**，Creator **3.2.0**（package.json 实测） |
| 许可证 | **无 LICENSE** |
| 内容 | 8 个 TS 脚本：rigidCharacter / rigidCharacterController / followCamera / TriggerArea / VerticalRaycast / ContactPointHelper / wall / wire-frame |
| 可复用性 | ❌ 代码不可复制；**刚体角色控制模式可参考** |

代码质量评估（rigidCharacterController.ts 逐行实测）：
- 亮点：控制器/角色分离（Controller 只产意图，Character 执行物理）；复用 scratch Vec3 避免每帧分配；以 `PhysicsSystem.fixedTimeStep` 步进保证物理确定性。
- 瑕疵：类名拼写错误（RigidCharactorController）、未用导入 5 处、注释与实现不符、仅触摸输入无键盘。
- 对本项目启示：当前 P1 采用运动学控制（无物理引擎）——正确选择：无尽跑酷不需要刚体，确定性更好、微信端性能更优。若 P2+ 需要真实物理交互（击飞、斜坡），再引入 rigidbody 模式，参考其 Controller/Character 分离与 fixedTimeStep 步进。

### 4. thegreatidea/3D-Endless-Runner-Unity

| 项 | 实测值 |
|----|--------|
| 状态 | ✅ 存在，2 stars，最近推送 2025-09-21 |
| 许可证 | **代码 MIT**（根目录 LICENSE 实测）；**但 Assets 内含第三方资产：BOXOPHOBIC（地形/植被资产包）、Lana Studio、TextMesh Pro、CurvedShader——MIT 不覆盖这些**；另有 AI 生成图片（版权状态不明） |
| 可复用性 | ⚠️ **仅 Scripts 下 10 个 C# 文件可按 MIT 复用（需保留版权声明）**；资产一律不可带入 |

代码质量评估（TileManager.cs 逐行实测）：
- 结构：经典 tile 段生成——Queue 池 + activeTiles 列表 + zSpawn 游标，玩家推进越过后回收最旧 tile、出池新 tile，活跃数量恒定。池预热 `numberOfTilesOnScreen + 2`。
- 瑕疵：冗余条件判断（`tileToRecycle == activeTiles[0] && ...` 恒真）、遗留开发注释（"// Add this line"）、可见性不一致、均匀随机无重复保护、UIManager.cs 为 0 字节空文件。
- **对本项目启示**：本项目当前为"实体 z 推进 + despawn"模式，功能等价且无 tile 段概念。P2 若引入**分段主题**（黄昏→黑夜按段切换），其 tile 段 + 池化结构值得借鉴；池化思想本项目渲染层已采用。

### 5. jiang4wqy/temple-run（Three.js 神庙逃亡 Lite）

| 项 | 实测值 |
|----|--------|
| 状态 | ✅ 存在，0 stars，最近推送 2026-06-30，43 commits |
| 许可证 | **无 LICENSE** |
| 内容 | Three.js + ESM：player/track/camera/effects/input/hud/game/util + tests/ 单测 + docs 设计稿 |
| 可复用性 | ❌ 代码不可复制；**设计参考价值为 6 仓中最高** |

设计亮点（README 实测）：
- **真路口转弯**：90° 路口 + 转向输入缓冲（提前按有效）+ 错过撞墙死亡——这是《神庙逃亡》的核心机制，**本项目 P1 尚未实现（直线跑道）**，P2 扩展方向的直接参考。
- 纯函数层（util：轨道坐标/朝向变换/AABB/段生成）+ 单测——与本项目 core 层零依赖设计不谋而合，验证了该架构在跑酷品类的适用性。
- 副步进碰撞（sub-step collision）防高速穿透——本项目逻辑帧 z 步进较小暂无穿透问题，若 P2 提速至 29+ 单位/帧率抖动场景可借鉴。
- 道具三件套（护盾/磁铁/双倍）+ HUD 倒计时——P2 道具模块的功能清单参考。
- 代码体积小、无 star，工程化程度反而高（tests + 设计文档），但无许可证一切不可复制。

### 6. yanghuiloong/More-people-runner（人群跑酷）

| 项 | 实测值 |
|----|--------|
| 状态 | ✅ 存在，0 stars，最近推送 2026-02-24，Creator 3.x 项目（.creator/settings/tsconfig 结构实测） |
| 许可证 | **无 LICENSE** |
| 内容 | 17 个 TS 脚本（CrowdManager/GateController/TrackManager/CityGenerator/ObstacleManager 等）+ FBX/音频/字体资产 |
| 可复用性 | ❌ 代码与资产均不可复制 |

参考价值：人群跑酷（crowd runner）+ **算术门**（×÷+−，ImpactGate_Multiply/Add/Sub/Div.ogg 可见门类型）——IAA 休闲品类验证有效的机制。对本项目不适用（夸父单人跑酷），仅记录该机制为品类趋势。资产无授权声明（FBX/MP3/TTF 来源不明），再次印证"不得假设 README 覆盖资源授权"。

## 汇总结论

| 仓库 | 存在 | 许可证 | 代码可商用复用 | 主要参考点 |
|------|------|--------|----------------|------------|
| Unity Trash Dash | ✅ | Asset Store EULA | ❌ | 状态机栈、广告点位、弯曲世界、Addressables 资产管线 |
| cocos/example-projects | ✅ | 无 | ❌ | 无（2.x 且停更） |
| cocos-parkour-character-control | ✅ | 无 | ❌ | Controller/Character 分离、fixedTimeStep 物理步进 |
| thegreatidea/3D-Endless-Runner | ✅ | MIT（仅代码） | ✅ 仅 Scripts | tile 段池化结构 |
| jiang4wqy/temple-run | ✅ | 无 | ❌ | 路口转弯+输入缓冲、纯函数层、道具清单、副步进碰撞 |
| yanghuiloong/More-people-runner | ✅ | 无 | ❌ | 算术门机制（品类趋势记录） |

**决策**：本项目继续**全自主实现**（P1 已完成），不 Fork 任何仓库。P2+ 借鉴清单（设计层，非代码）：
1. 路口转弯 + 输入缓冲（jiang4wqy 设计）——P2 评测是否纳入（改变跑道拓扑，工程量大，需与"夸父直道逐日"的题材叙事权衡）
2. 道具三件套（护盾/磁铁/双倍）+ HUD 倒计时——P2 道具模块
3. 状态机栈——P2 浮层（暂停/设置/商店 UI）
4. tile 分段主题池化——P2 主题分段
5. 广告多点位（revive + mission）——P4
6. 弯曲世界视觉——P2/P3 视觉优化候选

**授权红线**（写入 ASSET_LICENSES 并遵守）：第三方仓库的代码与资产未经许可证验证一律不入库；MIT 代码复用须保留版权与许可声明；BOXOPHOBIC 等"MIT 仓库内嵌第三方资产"同样禁止引入。
