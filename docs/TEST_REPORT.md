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

### 待人工验证（无法自动化）

- 微信开发者工具打开 `build/wechatgame`：CLI 依赖「服务端口」开启（当前未开启，报 `.cli` 缺失）与扫码登录
- 编辑器浏览器预览（3D/2D 双模式视觉与手感）
- 真机（P3）
