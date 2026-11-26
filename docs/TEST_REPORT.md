# 测试记录

## P0（原型期）

无正式测试记录（先于本仓库流程存在）。以人工编辑器预览为主。

## P1（2026-11-25）

### 单元测试（vitest，Node 22）

命令：`npm test` → **53/53 通过**（含 P1 过程中修正的 6 处测试假设错误，见下）。

| 套件 | 数量 | 覆盖 |
|------|------|------|
| config.spec | 15 | 随包 JSON 通过校验；DEFAULT_CONFIG 自洽；缺字段/枚举/取值域/整数/非有限数/跳窗/跨字段/文案占位符/parseConfig 抛错；formatUi |
| core.spec | 33 | 状态机；输入无效期；速度曲线与封顶；里程与里程碑；车道 clamp/缓动；跳跃生命周期；俯冲斩断；碰撞全矩阵（rock/log/wall × 跳/冲/变道/无敌/窗口外）；无敌击碎；passed 去重；dying 冻结与结算；复活规则（清障/无敌/一次性/重置）；阳炎拾取窗口；生成不变式（行 ≤2、车道不重复、类型域、阳炎避障车道）；种子确定性；despawn；timeScale 恢复 |
| ad.spec | 5 | Mock 倒计时 3→2→1→✓→发奖时序（与 P0 逐帧一致）；dt 累计；回调一次；重复 show 忽略；可重新 show |

### 测试修正记录（测试错误，非实现错误）

1. 速度断言：实现在帧首以当前 dist 计速度，测试误用帧后 dist 比对。
2. 里程碑：帧内距离推进使 li 在断言前已跨越，测试预留量不足。
3. dying 冻结：撞击帧 dist 已累计一次，测试误断言 dist==0。
4. despawn：单帧位移不足，需 12 帧。
5. timeScale 恢复：指数恢复速率下 60 帧不够，150 帧达标。
6. 生成采样：未躲障的模拟玩家数秒内死亡（机制正确运行所致）——改用无敌跑全程。

### 类型检查

命令：`npm run type-check`（tsc --noEmit，继承 Creator tsconfig + cc 3.8.8 声明）→ **0 错误**。
修正的 API 误用（均为对着 cc.d.ts 逐个核实）：

- `Camera.Projection.PERSPECTIVE` → `Camera.ProjectionType.PERSPECTIVE`（3.8.8 无前者）
- `primitives.sphere/cylinder/cone` 的参数签名（3.8.8：radius + options 对象；sphere 选项为 `segments`）
- `Graphics.lineCap` 需 LineCap 枚举；`ellipse` 仅 4 参（P0 的第 5 参旋转在运行时本就被忽略，删除后行为不变）；`arc` 需显式 counterclockwise

### 构建验证（Creator 3.8.8 CLI）

| 时间序 | 结果 |
|--------|------|
| 第 1 次 | 平台参数错（`platforms` → 实际构建 web-desktop）；暴露场景失效脚本 uuid（Missing class） |
| 第 2 次 | wechatgame 包产出；Missing class 仍指向旧 uuid |
| 第 3~4 次 | 场景 uuid 换算算法首次不对（保留 2 hex），仍 Missing |
| 第 5 次（最终） | **通过**：Missing class = 0；`assets/main/index.js` 注册 `Game`（6e5541woGtN34SlcOjfphkZ）与场景引用一致；game-config.json 在 resources bundle；包结构完整（game.js/game.json/project.config.json 等） |

构建脚本修正：`platforms=wechatgame` → `platform=wechatgame`（Creator 3.x CLI 单数）。
构建 uuid 规则记录：Creator 压缩 uuid = 前 5 个 hex 字符原样保留 + 其余 27 个 nibble 每 3 个编码为 2 个 base64 字符（compressHex-5），已用 packer-driver 注册表交叉验证。

### Phase 1（任务书：3D 核心系统，2026-11-25）

`npm test` → **77/77 通过**（53 → 77）：

- 受击分级矩阵 6 项（踉跄触发/豁免窗/再撞死亡/墙恒即死/回退开关/减速恢复 + applySlowdown 参数校验）
- 暂停 4 项（冻结完整性/状态门控/输入拒绝/重开解除）
- 动作冲突 5 项（jump-land 成对/禁二段跳/起跳取消滑铲/滑铲事件单发/连续切道 clamp）
- 帧率一致性 3 项：**实测 60fps vs 32fps 60s 里程偏差 0.01%**；抖动帧表 <0.5%；事件计数差 ≤15%（根因量化：spawnAcc/propAcc 阈值跨越帧差 → RNG 交错翻转，离散事件固有，不反馈运动）
- **10 分钟压测**：600s×36000 帧，随机输入+死亡自动重开；实体池上界断言（16/42/30）通过——无实体泄漏；gTime 精确 600s
- TrackPath 2 项 + Phase 1 配置校验 3 项

回归：lint 0 错误；type-check 0 错误；微信构建成功（Missing class=0，ProceduralKuafu/StraightPath/stumbleTimer 入包验证）。

### Phase 2（任务书：无限地图，2026-11-26）

`npm test` → **92/92 通过**（77 → 92）：

- **10 万次地块连接**（seed=777）：出口==入口连续性（9 位精度）、航向 90° 倍数（1e-9）、坡度 y 衔接、弧长一致、转弯间隔 ≥70、特殊地块禁障碍、存活路径远端采样有限性。**期间发现真实缺陷 1 个**：主题切换可把已选定的弧线段替换为过渡地块（kind 与 length/radius 不一致 → 采样不连续），已修复并加注释约束。
- 转弯机制 5 项：窗口开启方向一致 / 正确转向通过 / 转错撞墙 / 错过撞墙（无敌不豁免）/ 窗口关闭后手势恢复切道语义
- 生成避让 1 项：90s 混合操作后所有现存障碍/碎片的生成点均在安全区（dist+o.z 不变式）
- WorldShift 3 项：阈值触发/有界、相对位移不变（平移坐标系）、连续多次重定位
- **30 分钟自动奔跑**：1800s × 108,000 帧，90% 成功率自动驾驶含故意转错死亡重开；活跃地块上限 16、障碍 16、碎片 42、装饰 30（无泄漏）；>800 次采样有限性/重定位边界校验
- 配置校验 2 项

回归：lint 0；type-check 0；微信构建成功（Missing class=0，SegmentPath/MapGenerator/WorldShift 入包）。

### Phase 3（任务书：障碍/道具/动态难度，2026-11-26）

`npm test` → **114/114 通过**（92 → 114）：

- 障碍目录校验 2 项（≥20 断言/四类通行覆盖/非法引用拒绝）
- Reachability 验证器 5 项（三道封死/高速跳距不足/可行链/滑铲接跳/反应距离约束）
- 道具 6 项（磁吸吸附/冲刺无敌+到期/倍率翻倍+恢复/护盾抵挡+消耗/饮水解除/重开清空）
- 难度边界 3 项（D 封顶/间隔下限=反应守卫/转弯频率联动）
- 高速无漏判 1 项（极速 29 下 40 连跳逐个判定）
- **自动化跑酷模拟器**：1000 种子 × 60s 完美玩家 + **逐波重放可达验证**（每波发射含与上一波合并全部可达）；极端难度 30 种子死亡 ≤1（驱动器启发式局限，非可达性缺陷）
- 生成安全区 1 项 + waveStats 1 项

**调试期间由测试发现并修复的核心缺陷**（详见 PHASE3_REPORT）：
1. timing 障碍占道仅在判定帧更新（陈旧车道）→ 逐帧更新
2. 冲刺无速度倍率实现 → effectiveSpeed 接入
3. 计时器浮点残差（0.05−3dt≠0 → 永久生效）→ epsilon 归零
4. 兜底单体路径绕过可达性验证 → 合并验证
5. 安全区拦截丢波导致生成稀疏 → 保留间隔语义（拦截即跳过该波）
6. spawnWave 提前 return 跳过碎片/道具分支 → 移除

回归：lint 0；type-check 0；微信构建成功（Missing class=0，目录/验证器入包，obstacle-catalog 入 resources bundle）。

### Phase 4（任务书：特色玩法，2026-11-26）

`npm test` → **132/132 通过**（114 → 132）：

- 高温 5 项（升温封顶/热满减速不致死/甘霖降温/溪流清凉/荒漠倍率）+ 保底 1 项
- 神通 4 项（杖破切道类消耗与不适用边界/上限 6/跃时长 ×1.35/四神通并发无冲突）
- 逐日 2 项（无尽 sunProgress=skyP/征途=里程÷目标）
- 征途 3 项（阶段事件/最终目标 ended+journeyDone/ended 冻结）
- 模式隔离 1 项（无尽永不 ended）+ 存档 3 项（纪录覆盖/通关标记/键名稳定）
- 配置校验 2 项（Phase 4 段/7 神通目录）

**构建链新问题与修复**：library 删除后首次 CLI 构建会在导入完成前校验场景（"初始场景不存在"假失败）——build 脚本新增 warmup（打开项目等导入稳定再构建），实测恢复。

回归：lint 0；type-check 0；微信构建成功（Game/存档/神杖/征途代码全部入包）。

### Phase 6（任务书：完整游戏与成长系统，2026-11-27）

`npm test` → **170/170 通过**（144 → 170）：

- 任务 4 项：≥30 模板/同日稳定跨日刷新/回拨防刷/进度累计与幂等领取/单局峰值
- 成就 2 项：恰好 60/解锁判定+幂等领取
- 经济 2 项：事务幂等/原子消费
- 强化 4 项：5 系上限 2/花费曲线/热适应速率/等级 clamp（含"无速度类强化"公平断言）
- 教程 3 项：六步顺序/步骤齐全（切道/跳跃/滑铲/转弯/饮水/神通）/跳过后冻结
- 存档 v2 5 项：往返+校验和/主档损坏读备份/全损坏落默认/v1 迁移/篡改检测
- 新用户端到端 1 项：60s 奔跑→金币→领奖→强化→存档重进往返
- 重复开局 1 项 + 皮肤/模板目录回归 2 项

回归：lint 0；type-check 0；微信构建成功（初始场景 0 错，main bundle 315KB，Save v2/Economy/Quests/Achievements/Upgrades/Tutorial 全部入包）。

### Phase 7（任务书：微信适配与 IAA，2026-11-27）

`npm test` → **180/180 通过**（170 → 180）：

- 激励视频 6 项：成功/取消/加载展示失败/超时/重复回调/并发 duplicate
- 场景与隔离 3 项：空广告位明确 noAdUnit、微信 mock 不发奖、5 场景 ID 独立
- 插屏频控 1 项：总开关/首局保护/冷却/每日上限
- 浏览器平台 4 项：分享明确不支持/广告不支持/存储可用/屏幕兜底
- 配置语义 1 项：广告位空 ID 合法（禁止编造）

回归：lint 0；type-check 0；微信构建成功（初始场景错误 0，main bundle 347KB，AdService/IPlatform/MockAdAdapter 全部入包）。

真实广告验证**未执行**（阻塞：无合法广告位 ID，政策禁止编造；需后台开通后真机验证）。

### Phase 8（独立审查修复 + 压力/平衡/性能，2026-11-26）

`npm test` → **217/217 通过**（180 → 217，新增 37 项）：

- 回归 19 项：跨局事务/教程还原/复活守卫/存档二次损坏/单帧多里程碑/五系强化/广告超时迟到回调/切后台冻结/WxPlatform 严格判据
- UI 流程 6 项：cc 桩下 HUD 命中、7+1 导航页、页面 action、教程跳过、换肤、每帧更新
- 压力 4 项：1000 局×600 帧（600,000 帧）、600s 长跑、1000 次重开、1000 次暂停恢复
- 平衡 4 项：100 局×6 画像；无广告可推进，广告金币不影响距离/死亡/转弯
- 性能 3 项 + 配置画质枚举 1 项：画质档位单调、Draw Call 估算、构建体积实测

实测数据：压力 600s 帧时间 p99=0.0047ms（Node 逻辑层）；1000 局对象上限 12/35/5/20；平衡首个强化 7–8 局；main bundle 358.5KB；构建目录 10.4MB。
回归：lint 0；type-check 0；微信构建成功（exit=36，初始场景错误 0）；web-desktop headless Chrome 启动无异常。
真机/触控/真实广告/FPS 未验证，见 PHASE8_REPORT.md 第 6、7 节。

### Phase 8.1（核心引擎正确性审查与修复，2026-11-26）

`npm test` → **246/246 通过**（17 个测试文件，新增 `phase8-1-repro.spec.ts` 11 项最小复现回归 + `phase8-1-engine.spec.ts` 14 项深度验证）：

- 缺陷最小复现与回归 11 项（修复前 11/11 全部复现失败，修复后 11/11 全绿）：20 FPS 时间丢失、`maxDz` 坐标误传、同距离可达性未合并、高速冲刺拾取穿透、错过转弯同帧继续推进、复活后旧路口阻塞/再死、同种子重置不完整、金币倍率逐枚取整丢失、`coolRuns` 误判、教程覆写污染共享配置、存档越界/高版本覆盖/存储异常。
- 跨帧率确定性 3 项：**20 / 30 / 60 / 120 FPS** 固定逻辑帧脚本状态**完全位等价**；不规则帧时间（8ms~67ms 抖动）与 60 FPS 位等价；5s 后台卡顿与 `onBackgroundResume()` 保护。

### Phase 8.2（核心架构重构与工程质量提升，2026-11-26）

`npm test` → **263/263 通过**（18 个测试文件，新增 `tests/phase8-2-arch.spec.ts` 17 项架构与工程质量回归）：

- `SimulationClock` 3 项：60Hz 累加与 `renderAlpha`、大帧间隔 `MAX_SUB_STEPS` 限流与 `onBackgroundResume()`、暂停冻结与恢复清零。
- `CollisionSystem` 4 项：高速连续 Z 扫掠、跳跃/滑铲高度净空、横向角色宽度与连续滚石 `continuousLane`、连续拾取扫掠。
- `GameSession` 3 项：完整单局生命周期状态机（含暂停/死亡演出/广告复活/二次死亡幂等结算/返回标题）、广告票据防迟到回调与防重复消费（并在测试中捕获修复 `AdRewardCoordinator` `timedPower`/`skinTrial` 单次消费锁缺陷）、皮肤购买装备切换与强化原子落盘。
- 命令与事件契约 1 项：`CoreCommand` 固定逻辑帧消费、`CoreEvent` `runId`/`tick` 单调性、`ReadonlyCoreView` 只读投影。
- `Replay` 1 项：同种子与命令流确定性重放位等价、`exportMinimalRepro` JSON 往返复现。
- `ConfigRegistry` 3 项：项目真实 4 份 JSON 全量通过跨配置校验、非法配置精确报错、`deepFreeze` 运行期写保护。
- `RenderContracts` 与资源有界性 2 项：无核心改动替换 mock glTF `CharacterAssetProvider` 与 `SceneAssetBinder` + `ResourceTracker` 销毁归零断言；连续 50 次重复开局核心实体/路径/命令/事件队列严格有界。

回归：`npm run type-check` 0 错误；`npm run lint` 0 错误；Cocos Creator 3.8.8 微信构建成功（exit=36，耗时 4s，`Missing class = 0`，`build/wechatgame/assets/main/index.js` 442KB，全部 Phase 8.2 运行时模块入包验证通过）。
- 独立随机流 1 项：装饰 `propInterval` 变更对障碍/掉落流零扰动。
- 连续运动、碰撞与可达边界 6 项：角色宽度中点擦边、相邻车道安全、连续滚石 `visLane`、滑铲身高净空、无敌期不误耗桃木神杖、`Reachability` 跨槽变道 `laneReady <= slot.d` 守卫。
- **1000 种子真实可达性重放**（零无敌、开启碰撞、分段覆盖 Tier 0/1/2 + 满速 + 全 22 种障碍 + 90° 转弯）：`deaths=0 / 1000 seeds`，`tiers=[0,1,2]`，`moving=[moverGuard,roller,swingLog]`，`multiLane=397657`，`turns=3898`，`plans=574658`。
- 独立无敌压力测试保留于 `phase8-stress.spec.ts`，明确限定仅用于生成、资源回收与稳定性验证。
- 全链路集成 3 项：复活后二次增量结算、广告 5 场景事务（`AdRewardCoordinator` 防重复翻倍/防迟到回调串局/`timedPower` 跨开局/`skinTrial` 单局归还/`dailyDouble` 跨日拒领）、存档恢复全路径（v1 迁移/备份恢复/双档损坏隔离/v3 写锁保护/存储异常捕获）。

回归：`npm run type-check` 0 错；`npm run lint` 0 错；Cocos Creator 3.8.8 微信构建（`./scripts/build-wechat.sh`）成功（exit=36，Missing class = 0，`main/index.js` 403KB，`AdRewardCoordinator`/`FIXED_DT`/`isSafeSpawnRange`/`sanitizeSaveData` 全部入包）。详见 `docs/PHASE8_1_REPORT.md`。

### Phase 8.3（无真机最终验收，2026-11-26）

当前工作区重跑：`npm test` **19 文件 / 268 项通过**（4.50s）；`npm run type-check` 0；`npm run lint` 0。Phase 8.2 的 263 项为历史基线，新增 5 项：触控坐标换算 3、静音后 BGM 恢复 1、教程步骤推进 1。

默认 `npm test` 已包含 1000 种子零无敌重放、1000 种子逐波重放、1000 局/600s/1800s/100000 地块压力与长跑；本轮未另开独立入口。
浏览器：冷启动/教程/四向输入/暂停恢复/10 次结算重开/存档往返/广告关闭均执行；Android/iOS 与微信模拟器（AppID 无效）未验证。详见 PHASE8_3_REPORT.md。

### 待人工验证（无法自动化）

- Phase 8 真机兼容矩阵（Android 低/中/高 + iOS）与微信开发者工具主包/分包体积
- 微信开发者工具打开 `build/wechatgame`：CLI 依赖「服务端口」开启（当前未开启，报 `.cli` 缺失）与扫码登录
- 编辑器浏览器预览（3D/2D 双模式视觉与手感）
- 真机（P3）
