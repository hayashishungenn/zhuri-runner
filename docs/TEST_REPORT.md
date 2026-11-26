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

### 待人工验证（无法自动化）

- 微信开发者工具打开 `build/wechatgame`：CLI 依赖「服务端口」开启（当前未开启，报 `.cli` 缺失）与扫码登录
- 编辑器浏览器预览（3D/2D 双模式视觉与手感）
- 真机（P3）
