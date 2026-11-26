# 阶段进度

## P0 — 可玩原型（2D Graphics 单文件）✅

- 单组件 `Game.ts`（~740 行）实现完整玩法闭环：标题/奔跑/死亡/复活、三车道、跳跃/俯冲、三类障碍、阳炎拾取、里程碑弹字、慢动作死亡、模拟复活广告、静音开关、速度线/红闪/暗角等表现层。
- 状态：可玩。**未做独立验收记录**（先于 Git 与文档存在）；其视觉与手感作为 P1 Renderer2D 移植的基准。

## P1 — 模块化 + 配置 + 测试 + 真3D 渲染管线 ✅（代码完成，视觉验收待人工）

- [x] Git 仓库初始化 + 现状基线提交（d3cbef0）
- [x] docs/ 八项文档脚手架
- [x] 配置层：`assets/resources/game-config.json` + 纯 TS schema 校验 + cc 加载器（非法配置抛错拒绝启动）
- [x] 核心逻辑层：`core/GameCore`（零 cc 依赖，机制与 P0 逐行为等价）
- [x] 单元测试 53/53 全绿（vitest：机制 33 + 配置 15 + 广告 5）
- [x] 输入层（手势/点按/键盘 → 意图）+ 平台层（AdService mock/wx）
- [x] Renderer2D 移植回退 + `Game.ts` 740 行单体瘦身至 ~170 行纯装配
- [x] Renderer3D 真3D 默认渲染（运行时构建，详见 ARCHITECTURE.md）
- [x] Creator CLI 构建微信包成功：Missing class 警告清零、用户脚本入 main bundle、game-config.json 入 resources 包
- [x] 场景修复：main.scene 中指向已删除脚本的失效组件（orphan uuid）替换为当前 Game.ts
- [x] 全量类型检查通过（tsc --noEmit，含 cc 3.8.8 声明）

### 期间发现并修复的问题

1. `scripts/build-wechat.sh` CLI 参数错误：3.x 用 `platform`（单数）而非 `platforms`，此前构建实际跑的是 web-desktop。
2. main.scene 的 Game 节点挂载了已删除脚本的失效 uuid（首建即报 Missing class）——游戏此前**根本不会启动**。已按 Creator compressHex-5 规则重算为当前 Game.ts 的 uuid。
3. extensions/cocos-mcp-server 缺 node_modules 导致编辑器插件加载报错（已安装其依赖；该扩展不进游戏包）。
4. P0 遗留 bug：操作提示 `firstShot` 从未置真（提示永远闪烁）。P1 已改为首次输入后消失（有意的行为修正）。

## P2 — 无限地图与程序化生成 ✅

- [x] 分段路径 SegmentPath / MapGenerator / 90° 转弯 / 对象池 / WorldShift 长距离精度
- [x] 测试与构建回归通过；详见 PHASE2_REPORT.md

## P3 — 障碍、道具与动态难度 ✅

- [x] 22 种障碍目录 + 可达性验证器 + 5 种道具 + 动态难度封顶
- [x] 修复占道陈旧、冲刺倍率缺失、计时器浮点残差、兜底绕过验证、spawnWave 提前返回等真实缺陷
- [x] 测试与构建回归通过；详见 PHASE3_REPORT.md

## P4 — 夸父逐日特色玩法 ✅

- [x] 逐日系统 / 高温饮水 / 7 项神通 / 双模式 / 四主题
- [x] 修复 MapGenerator `sinceSpecialD` 不重置导致生成链退化的缺陷
- [x] 测试与构建回归通过；详见 PHASE4_REPORT.md

## P5 — 3D 美术、动画与音频 ✅

- [x] 美术规范 + 程序化原创资产（几何体角色/材质 tint/几何配件）+ 8 套皮肤 + 42 地块模板 + 21 个合成音频
- [x] 授权边界记录于 ASSET_LICENSES.md；测试与构建回归通过；详见 PHASE5_REPORT.md

## P6 — 完整游戏与成长系统 ✅

- [x] 完整 UI / 经济事务 / 32 任务模板 / 60 成就 / 5 系强化 / 存档 v2 / 新手教程
- [x] 测试 170/170、lint、type-check、微信构建通过；详见 PHASE6_REPORT.md

## P7 — 微信适配与 IAA 广告 ✅（代码完成，真实广告待广告位）

- [x] 平台抽象层 IPlatform + Browser/Wx 双实现（存储/生命周期/音频/屏幕/分享/广告，不支持明确状态）
- [x] AdService v2：5 场景激励视频状态机（isEnded 才发奖/事务幂等/超时/重复回调）
- [x] 插屏：仅自然结算节点 + 总开关/首局保护/冷却/每日上限
- [x] 正式/测试隔离：微信环境 mock 模式不发奖；模拟适配器隔离于 platform/mock/
- [x] AdStats 本地事务日志 + Save v2 ads 段（不上传、不收集个人信息）
- [x] 广告位 ID 独立配置且全部留空（禁止编造正式广告位）
- [x] 测试 170→180（成功/取消/失败/超时/重复回调/频控/降级/隔离）
- [x] 微信构建实测：初始场景错误 0，main bundle 含全部平台/广告代码
- 报告：PHASE7_REPORT.md；阻塞：真实广告需合法广告位 ID + 真机（后台操作）

## P8 — 独立质量审查、自动化测试、压力与性能优化 ✅

- [x] 四路独立审查（代码正确性/历史验收/广告存档安全/测试覆盖），修复 9 项发布阻塞与 20+ 重要问题
- [x] 测试 180→217：跨局事务/存档二次损坏/异步回调守卫/WxPlatform 判据/UI 命中/压力/平衡/画质
- [x] 压力：1000 局×600 帧、600s 长跑、1000 次重开与暂停恢复，对象有界
- [x] 平衡：100 局×6 画像模拟；无广告可推进，广告只影响金币
- [x] 性能：低/中/高画质档位 + Draw Call/包体/帧时间实测
- [x] 浏览器 web-desktop 构建加载实测（无异常）；真机未验证项单独列于 PHASE8_REPORT.md
- 报告：PHASE8_REPORT.md
- 测试期配置（用户指令）：`ad.enabled=false` 隐藏全部广告入口；默认静音且随存档持久化（KNOWN_ISSUES #20/#25，发布前需恢复）

## P8.1 — 核心引擎正确性审查与修复 ✅（代码与构建完成，等待独立审查验收）

- [x] 固定时间步长（60Hz 累加器 + `MAX_FRAME_DT`/`MAX_SUB_STEPS` + `renderAlpha` 插值 + 后台恢复）
- [x] 统一地图坐标语义（`toAbsD`/`toRelZ` + `SegmentPath.isSafeSpawnRange` 完整区间校验，修复 `maxDz` 相对坐标误传）
- [x] `Reachability` 与 `GameCore` 规则对齐（同距离合并、`laneReady`/`actionReady` 分离、可执行 `plan` 输出、抵达预期速度校验），通过 **1000 种子零无敌真实核心重放（0 死亡）**
- [x] 连续扫描碰撞与运动模型（`[currZ,prevZ]` 防穿透、角色宽度、跳跃/滑铲高度、连续滚石 `visLane`）
- [x] 状态机与复活修复（禁止 `crash` 后同帧推进、清理旧路口防阻塞与复活再死、复活后增量结算）
- [x] 单局主种子派生 4 条独立随机流（map/obstacle/drop/decor）与完整运行态重置（含 `runTime` 与 `mapGen.difficulty`）
- [x] 经济/成长/任务/皮肤/成就集成修复（累计取整金币倍率、征途失败结算、跨局 `itemUses` 同步、皮肤目录索引与所有权校验、`coolRuns`/`totalFrags`/`journeys` 精确判定）
- [x] 广告奖励事务协调器 `AdRewardCoordinator`（绑定 `runId` 与快照、单局金币翻倍幂等、`timedPower` 跨开局注入、`skinTrial` 单局归还、防迟到回调串局）
- [x] 教程单局模式参数覆写 `RunModeOverrides`/`MapRunOverrides`（不修改共享配置且与 `MapGenerator` 一致）
- [x] 存档安全加固（全字段范围清洗、高版本写锁防静默覆盖、双档损坏隔离、存储异常安全降级）
- [x] 验证：type-check 0 错、lint 0 错、246/246 单测与全层级（Tier 0/1/2 + 移动障碍）1000 种子零无敌重放全绿、独立对抗审查复验通过、Cocos 3.8.8 微信构建 0 Missing class
- 报告：`docs/PHASE8_1_REPORT.md`（已独立审查验收并通过）

## P8.2 — 核心架构重构与工程质量提升 ✅（代码、测试与构建完成，等待独立审查验收）

- [x] 全量架构审计：识别并修复 `Game.ts` 业务膨胀、`ProceduralKuafu` 覆盖 Z/斜坡 Y、`Renderer3D.destroy()` 材质与对象池节点泄漏、`AudioMgr` 冗余组件与未重置状态、`AdRewardCoordinator` 票据单次消费锁缺失
- [x] 单局生命周期与成长协调器：`core/GameSession.ts`（零 `cc` 依赖，统一管理 `title → running ⇄ paused → dying → awaitRevive → settled | journeyCleared` 状态机及经济/任务/成就/皮肤/强化/广告/存档事务）
- [x] 核心职责务实拆分：`core/SimulationClock.ts`、`core/CollisionSystem.ts`，并补齐 `CoreCommand`、`ReadonlyCoreView`、`CoreResourceStats` 与带 `runId`/`tick` 的 `CoreEvent`
- [x] 确定性回放与最小复现导出：`core/Replay.ts`（`ReplayRecorder`、`replayRun`、`exportMinimalRepro`）
- [x] 统一配置校验与只读冻结：`config/ConfigRegistry.ts`（`validateAllConfigs` + `deepFreeze`）+ `SkinCatalog.SKIN_COSTS` 单一数据源
- [x] 商业级 3D 美术资产替换契约与资源监控：`render/RenderContracts.ts`（`CharacterAssetProvider`、`SceneAssetBinder`、`RenderResourceStats`、`ResourceTracker`）+ `Renderer3D.getResourceStats()`
- [x] 验证：type-check 0 错、lint 0 错、**263/263 单测全绿**（18 个测试文件，新增 `tests/phase8-2-arch.spec.ts` 17 项）、Cocos 3.8.8 微信构建成功（exit=36，0 Missing class，`main/index.js` 442KB）
- 报告：`docs/PHASE8_2_REPORT.md`；**本阶段已停止，等待独立审查验收后再进入后续美术生产阶段**

## P8.3 — 无真机最终测试与冻结验收 ✅（模拟器待验）

- [x] 当前工作区重跑 268/268、lint 0、type-check 0；保留修复前基线证据
- [x] 修复触控坐标换算（横竖屏）、默认静音后无 BGM、教程 HUD 步骤不刷新
- [x] 浏览器冷启动/教程/四向输入/暂停恢复/10 次结算重开/存档往返/广告关闭
- [x] 微信候选包重新构建，产物完整性/配置/尺寸/凭据检查通过
- [ ] 微信模拟器因 AppID 无效阻塞；Android/iOS 真机待验
- 报告：PHASE8_3_REPORT.md

## 人工验证项（待用户）

- [ ] 微信开发者工具：首次使用需在「设置 → 安全设置」开启**服务端口**并扫码登录，之后 CLI/自动化才能工作（本次 CLI 已验证报 `.cli` 缺失，即此状态）
- [ ] 编辑器浏览器预览：3D 视觉/手感确认（相机高度、车道宽度、跳跃高度均为首版参数，预览后调优）
- [ ] `renderMode: "2d"` 回退回归确认（应与 P0 视觉一致）
- [ ] 真机试玩（P3）
- [ ] P8 真机：Android 低/中/高 + iOS 触控/性能/发热/音频/生命周期/广告/存档（当前无设备，未验证）
- [ ] P8 包体：微信开发者工具确认主包/分包体积（构建目录 10.4MB，引擎 7.2MB）
- [ ] P7 真实广告：后台开通流量主 → 创建激励视频/插屏广告位 → 填入 `game-config.json` 的 `ad.adUnitIds` / `ad.interstitialUnitId`、设 `ad.mode='wx'` → 真机验证完整观看/取消/无填充/重复回调（未取得合法 ID 前广告明确不可用）
