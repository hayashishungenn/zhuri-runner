# Phase 8.1 — 核心引擎正确性审查与修复报告

> 日期：2026-11-26  
> 范围：底层游戏逻辑独立审查、缺陷复现、根因修复与架构加固（不增加游戏内容、不做美术制作、不更换引擎）。

## 一、缺陷清单与修复证据（10 项全量审查）

| 编号 | 严重程度 | 审查项 | 源码位置（修复前） | 触发条件 | 实际影响 | 修复方法 | 测试证据 | 剩余风险 |
|------|----------|--------|--------------------|----------|----------|----------|----------|----------|
| **P8.1-01** | High | 1. 固定时间步长 | `core/GameCore.ts:307-320` | 20 FPS (`dt=0.05s`) 或帧率波动下运行 | `dt=Math.min(dtRaw,0.033)` 导致 20 FPS 丢失 34% 模拟时间（10s 仅推进 6.6s）；`spawnAcc=0` 丢弃余数导致跨帧率相位漂移 | 建立 `FIXED_DT=1/60` 累加器循环、`MAX_FRAME_DT=0.25`、`MAX_SUB_STEPS=8`、`onBackgroundResume()` 清空累加器、`renderAlpha` 与 `interp*` 插值快照、`onBeforeStep` 逻辑帧输入钩子；`spawnAcc/propAcc` 改为减法保留余数 | `phase8-1-repro.spec.ts` BUG-01（修复前 6.6s vs 10s，修复后通过）；`phase8-1-engine.spec.ts` 20/30/60/120 FPS 与不规则帧时间位等价 | 渲染层 3D 节点暂未开启子帧插值，当前仍按逻辑帧对齐摆放以防相对滑动 |
| **P8.1-02** | Critical | 2. 地图坐标语义 | `core/GameCore.ts:602-606`、`core/track.ts:163-167` | `dist > 60` 且生成跨度 10–18 单位的多步模板靠近弯道/桥/洞/过渡地块 | `maxDz` 为相对坐标（~64）却直接传入 `isSafeSpawnZone(maxDz,4)`，导致模板后段障碍落入非安全地块；`usedLanes` 仅登记锚点车道导致多车道障碍与碎片/道具重叠；`isSafeSpawnZone` 仅检 3 点可能漏检短特殊段 | 统一 `toAbsD`/`toRelZ` 显式转换；`SegmentPath.isSafeSpawnRange(startD,endD,margin,kind)` 逐段遍历检查完整区间；`spawnWave` 对模板全跨度、碎片带、道具及 `spawnProp` 全部使用绝对坐标区间校验；`usedLanes` 登记完整占道并集 | `phase8-1-repro.spec.ts` BUG-02（修复前 7 次非法落入非安全地块，修复后 0 次）；`phase2.spec.ts` 安全区不变式全绿 | 无已知逻辑风险 |
| **P8.1-03** | Critical | 3. 可达性与真实重放 | `core/Reachability.ts:52-118`、`core/GameCore.ts:587-621` | 同距离多障碍（如 `fireCorridor`）、高增速段跨波、空中变道后接后续波 | `validateReachability` 未合并同距离事件导致合法组合误判；硬编码起点 `{lane:0,ready:0}`；`spawnWave` 用当前速度而非抵达波位时的预期速度；无可执行操作序列输出 | `Reachability` 实现同距离 `mergeSlots` 合并、分离 `laneReady`/`actionReady`（与核心空中允许变道规则对齐）、支持跨空槽连续变道、输出可执行 `plan: PlanAction[]`；`GameCore.spawnWave` 使用抵达最远步进的预期速度（含 12% 余量）及玩家实际车道校验 | `phase8-1-repro.spec.ts` BUG-03；`phase8-1-engine.spec.ts` **1000 随机种子 × 20s 零无敌真实核心重放（全 22 种障碍+转弯）：`deaths=0, turns=3075, plansExecuted=710305`** | 极长局突发拾取 `dash` 瞬间增速 1.5x 时，旧波已生成且由 `dash` 期间无敌保护，无必死风险 |
| **P8.1-04** | High | 4. 连续运动与碰撞 | `core/GameCore.ts:391-481` | 冲刺（速度 ~43.5）下帧长较大或变道中点擦边 | 拾取窗宽 1.4，单帧位移 >1.4 直接穿透漏拾；`Math.round(playerLaneF)` 离散跳变未计角色宽度与滚石连续 `visLane` | 障碍与拾取均采用 `[currZ, prevZ]` 连续扫描区间相交 + 穿越时刻 `t` 插值；引入 `PLAYER_HALF_WIDTH=0.22`、`OBS_HALF_WIDTH=0.30`、`PICKUP_HALF_WIDTH=0.55`、`playerY`/`playerHeight` 连续几何模型，滚石按 `visLane` 连续判撞 | `phase8-1-repro.spec.ts` BUG-04（修复前 0 拾取，修复后命中）；`phase8-1-engine.spec.ts` 角色宽度/相邻道安全/滚石/滑铲 4 项全绿 | 2D/3D 视觉碰撞箱尺度仍需真机/编辑器视觉手感调优 |
| **P8.1-05** | Critical | 5. 状态机与复活转换 | `core/GameCore.ts:218-250,332,489-523`、`Game.ts:203-216` | 错过转弯同帧达征途终点；转错/错过转弯后复活 | `updateTurnWindow` 触发 `crash()` 后未中止当帧 `updateRun`，可同帧推进距离并触发 `journeyDone`；失败路口未标记 `passed` 且 `turnWindow` 未清，复活后要么立刻再死、要么永久阻塞后续全部路口；复活后二次死亡被 `claimSettlement` 拦截导致统计遗漏 | `crash()` 加状态守卫并清空 `turnWindow`；`updateTurnWindow()` 后立即检查 `state !== 'run'` 返回；失败/转错路口标记 `passed=true`；`revive()` 清理复活保护区内路口并重置动作计时器；`RunLedger.noteRevive()` 支持复活后二次增量结算 | `phase8-1-repro.spec.ts` BUG-05a/05b（修复前同帧 `ended` 与复活即死，修复后全绿）；`phase8-1-engine.spec.ts` 复活二次增量结算全绿 | 无已知逻辑风险 |
| **P8.1-06** | High | 6. 随机流与重置完整性 | `core/rng.ts`、`core/GameCore.ts:85-100,252-276`、`core/MapGenerator.ts:88-100` | 同实例多次 `startRun()` 或装饰频率调整 | `reset()` 未重置 RNG、未重置 `mapGen.difficulty`、未清 `events`/`waveStats`/`spawnDebug`；`timing` 障碍依赖全局 `gTime`；障碍/掉落/装饰共用同一 RNG 流 | `deriveSeed` 按主种子 `runSeed` 派生 `MAP/OBSTACLE/DROP/DECOR` 4 条独立 `SeededRng` 流；引入单局逻辑时钟 `runTime` 驱动 `timing` 障碍；`reset()` 与 `MapGenerator.reset()` 完整重置所有运行态与难度 | `phase8-1-repro.spec.ts` BUG-06；`phase8-1-engine.spec.ts` 装饰频率隔离与同种子完全复现 | 无已知逻辑风险 |
| **P8.1-07** | High | 7. 经济/成长/任务/皮肤/成就 | `core/RunLedger.ts:77-82`、`core/PlayerStats.ts:21-55`、`core/Achievements.ts:65-66`、`Game.ts:97,190-216,303-310,429,535-552` | 购买金币倍率强化后逐枚拾取；征途模式死亡；跨局开启新局；标题页切皮肤；过热通关 | ① 逐枚 `Math.round(1*1.3)=1` 吞掉全部倍率加成；② 征途死亡不结算；③ `sync.itemUses={}` 导致每局重放历史全部道具次数进每日任务；④ `skinIdx` 混用 `skinsOwned` 下标与目录索引，`cycleSkin`/`use:` 绕过所有权；⑤ `coolRuns` 未检 `maxHeat<80`、`totalFrags` 漏计双倍碎片、`journeys` 成就错误绑定 `themeVisited` | ① `RunLedger.fragmentGrant` 改为累计目标做差；② `died` 统一结算无尽与征途；③ `sync.itemUses` 从 `stats.itemUses` 快照初始化并补齐任务事件喂数；④ 统一 `resolveCatalogSkinIdx` 且 `cycleSkin`/`use:` 严格校验 `skinsOwned`；⑤ `fragment` 事件携带 `amount`、`isCoolRun` 由 `core.maxHeat < warnAt` 判定、`themeVisited` 归一化 `0..3`、`journeys` 直读 `itemUses.journey` | `phase8-1-repro.spec.ts` BUG-07/07b；`phase8-1-engine.spec.ts` 全链路集成测试全绿 | `Game.ts` UI 绑定层因依赖 `cc` 由类型检查+构建验证，核心逻辑均在零 `cc` 单测覆盖 |
| **P8.1-08** | Critical | 8. 广告奖励事务 | `Game.ts:343-393`（重构抽出 `core/AdRewardCoordinator.ts`） | 同局多次点击金币翻倍；标题页领限时神通后开局；试用皮肤跨局；跨局迟到回调 | ① `doubleCoins` 用 `Date.now()` 做 txId 可无限重复翻倍；② `timedPower` 直接写 `core.magnetT/dashT` 在 `startRun()` 被 `reset()` 清零；③ `skinTrial` 永不过期；④ 迟到回调作用于新局 | 新增纯 TS `AdRewardCoordinator`：请求前生成绑定 `(scene, runId, snapshot)` 的票据；`doubleCoins` 经 `RunLedger.claimDoubleCoins(runId)` 单局幂等 + 快照金额；`timedPower` 存入 `pendingBuffs` 由 `startRun({startBuffs})` 注入；`skinTrial` 绑定单局生命周期并自动归还；迟到回调校验 `runId`/日期不匹配即拒 | `phase8-1-engine.spec.ts` 广告 5 场景全链路事务测试全绿 | 真实微信激励视频需合法广告位 ID 与真机验证（阻塞项见 KNOWN_ISSUES #20） |
| **P8.1-09** | Critical | 9. 教程配置覆盖隔离 | `core/RunLedger.ts:42-74`、`core/GameCore.ts:95-98`、`core/MapGenerator.ts:70` | 开启新手教程 | `RunLedger` 直接改写共享 `cfg.spawn`/`cfg.map` 污染配置，且 `MapGenerator` 持有浅拷贝导致 `turnGapMin/Max` 覆写从未生效 | 废除配置直接改写；新增 `RunModeOverrides` / `MapRunOverrides`，`RunLedger.beginRun(tutorial)` 返回不可变覆写对象，`GameCore.startRun({overrides})` 与 `MapGenerator.setOverrides` 同步生效，结束教程/重开自动还原 | `phase8-1-repro.spec.ts` BUG-09；`phase8.spec.ts` 教程覆写一致性测试全绿 | 无已知逻辑风险 |
| **P8.1-10** | High | 10. 存档安全与恢复 | `platform/Save.ts:101-167` | 存档字段越界/类型损坏；高版本存档 (`v:3`)；存储空间满或隐私模式抛异常 | `parseSave` 未清洗负值/越界等级/缺失默认皮肤；高版本存档被 `load()` 静默覆盖为 v2 空档；存储异常致构造函数崩溃 | 新增 `sanitizeSaveData` 全字段类型与范围清洗；`inspectSaveVersion` 识别 `v > 2` 时启用 `writeLocked=true` 禁止静默覆盖；双档损坏时保留原串于 `zhuri.save.corrupt` 并暴露 `loadStatus`；所有存储读写 try/catch 捕获并返回 `flush(): boolean` | `phase8-1-repro.spec.ts` BUG-10；`phase8-1-engine.spec.ts` 存档恢复全路径测试全绿 | 云存档（微信云开发）仍未接入（KNOWN_ISSUES #19） |

## 二、独立对抗审查复验与二次加固

在首轮提交后，独立上下文审查子代理（`Independent Phase 8.1 Reviewer`）提出 2 项 High、4 项 Medium 与 6 项 Low 改进建议，已全部核实并完成二次修复：

1. **1000 种子重放覆盖全难度层级与移动障碍**（High）：将 `phase8-1-engine.spec.ts` 1000 种子零无敌重放扩展至 `dist = 0 / 700 / 1500` 三档起步（覆盖 Tier 0/1/2 + 满速），实测 `tiers=[0,1,2]`、`moving=[moverGuard,roller,swingLog]`、`multiLane=397657`、`turns=3898`、`plans=574658`、**`deaths=0`**。
2. **`spawnWave` 在途动作窗与 `reachInit` 对齐**（High）：过滤正在穿越中的近身动作障碍并传入 `actionReady`，消除在途跳跃/滑铲时的假阴性 `fullRejects`。
3. **`Reachability` 跨槽变道守卫**（Medium）：`transitionSafeAcrossSlot` 增加 `st.laneReady <= slot.d` 前置校验并补齐单测。
4. **`skinTrial` 复活保留**（Medium）：`Game.settleRun()` 仅在不可再复活或已通关时归还试用皮肤，复活后继续保留本局试用皮肤。
5. **渲染插值接线**（Medium）：`Renderer3D.placeKuafu` 与 `Renderer2D.drawKuafu` 接入 `core.interpDist`/`core.interpPlayerLaneF`/`core.interpJumpT`。
6. **恢复 `phase8-balance.spec.ts` 原断言**（Medium）：修复 `spawnWave` 假拒绝后 `skilled:noad` 达成 `upgrades=10, skins=1`，已恢复原始 `skins >= 1` 断言。
7. **细节加固**（Low）：无敌期不误耗 `staffCharges`；`revive()` 剪除 `lastWaveEvents` 并同步插值快照；`spawnWave`/`spawnProp` 移至实体推进后消除 1-tick `absD` 偏移；补齐 `CCGame.EVENT_SHOW` 监听；跨日刷新后立即同步 `save.data.quests`。

## 三、验证结论

- `npm run type-check`：0 错误
- `npm run lint`：0 错误，0 警告
- `npm test`：**17/17 测试文件、246/246 用例全绿**（含 1000 种子覆盖 Tier 0/1/2 + 全部移动障碍零无敌真实核心重放 `deaths=0`、20/30/60/120 FPS 与不规则帧时间位等价、1000 局压力测试、存档/经济/广告全链路集成）
- Cocos Creator 3.8.8 微信构建（`./scripts/build-wechat.sh`）：成功（exit=36，Missing class = 0）
- 人工真机与平台权限阻塞项（微信开发者工具服务端口、真实广告位 ID、Android/iOS 真机实测、包体分包确认）仍单独记录于 `KNOWN_ISSUES.md` 与 `PROGRESS.md`。
