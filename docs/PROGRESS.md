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

## 人工验证项（待用户）

- [ ] 微信开发者工具：首次使用需在「设置 → 安全设置」开启**服务端口**并扫码登录，之后 CLI/自动化才能工作（本次 CLI 已验证报 `.cli` 缺失，即此状态）
- [ ] 编辑器浏览器预览：3D 视觉/手感确认（相机高度、车道宽度、跳跃高度均为首版参数，预览后调优）
- [ ] `renderMode: "2d"` 回退回归确认（应与 P0 视觉一致）
- [ ] 真机试玩（P3）
- [ ] P7 真实广告：后台开通流量主 → 创建激励视频/插屏广告位 → 填入 `game-config.json` 的 `ad.adUnitIds` / `ad.interstitialUnitId`、设 `ad.mode='wx'` → 真机验证完整观看/取消/无填充/重复回调（未取得合法 ID 前广告明确不可用）
