# Phase 7 报告 —— 微信小游戏适配与 IAA 广告变现

> 日期：2026-11-27。目标：平台抽象、官方广告接入、合规隔离与可测试商业化体系。

## 逐项交付

### 1. 平台抽象层（platform/IPlatform.ts + 双实现）

统一接口覆盖：**存储 / 生命周期 / 音频恢复 / 屏幕信息（安全区+胶囊位置） / 分享 / 广告**。

- `BrowserPlatform`：浏览器/编辑器实现；分享、广告明确返回 `supported=false + reason`，**不伪造成功**；隐私模式 localStorage 失败降级内存存储
- `WxPlatform`：微信官方 API（`getStorageSync/onHide/onShow/getWindowInfo/getMenuButtonBoundingClientRect/shareAppMessage/createRewardedVideoAd/createInterstitialAd/resumeBackgroundAudio`）；API 缺失或 ID 为空一律明确不可用
- `PlatformFactory` 按 `globalThis.wx` 选择；Game 装配生命周期（onHide 暂停，onShow 音频恢复）

### 2. 微信构建

沿用 Creator 3.8.8 CLI 构建链（含 library 冷启动 warmup）；构建实际验证：初始场景错误 0、Game 类注册正确、main bundle 347KB 含全部平台/广告代码。主包仍远低于 4MB。后台切换/来电中断：生命周期钩子 + 自动暂停已实现（真机验证为人工项，见 KNOWN_ISSUES）。

### 3. 激励视频（5 场景）

死亡复活 / 结算金币翻倍 / 每日奖励翻倍 / 限时神通 / 皮肤试用——统一 `AdService.requestReward(scene, onReward)`。

状态机：`idle→loading→showing→rewarded/failed`，含加载失败、无填充、展示失败、用户取消、**超时守护**、**重复回调幂等**、事务防重放（`settled` 集合）——**每次广告事务最多结算一次**。

**硬约束**：仅官方 `res.isEnded === true` 才发奖（WxPlatform 严格判断 `res?.isEnded === true`）。

### 4. 插屏广告

仅自然结算节点（`settleRun`）尝试；总开关 / 首局保护 / 冷却时间 / 每日上限四重控制；加载/展示失败静默不阻断；**奔跑过程中绝不调用**（结构上杜绝打断操作）。

### 5. 异常处理与隔离

- 广告位 ID 独立配置（`game-config.json` 的 `ad.adUnitIds` / `ad.interstitialUnitId`），**全部留空**——代码中无任何正式/测试广告位常量
- 微信环境 `mode='mock'` → AdService 强制 unsupported，**不展示、不发奖**（正式包无法通过测试广告发奖）
- 模拟适配器物理隔离于 `platform/mock/`，仅在浏览器测试路径显式注入
- 无填充/加载失败/网络异常/取消/未开通流量主 → 明确失败状态 + 玩家继续游戏（HUD 轻提示，不阻断）

### 6. 商业化统计（core/AdStats.ts）

本地事件日志（开局/结束/复活/广告请求/展示/完整观看/奖励/失败原因）+ 累计计数；写入存档 v2 的 `ads` 段（校验和覆盖）；**不上传、不收集个人信息**。

### 7. 平台合规（COMPLIANCE.md 已更新 Phase 7 复核）

官方文档页动态渲染不可机器提取，**不编造新结论**；Phase 0 条目保留并标注待后台验证；明确"未取得合法广告位不提交含广告审核版本"的发布红线。

## 测试（170 → 180 全部通过）

| 任务书要求 | 结果 |
|-----------|------|
| 广告成功 | ✅ isEnded=true 发奖一次，事务与回调都仅一次 |
| 取消 | ✅ isEnded=false 不发奖、明确 notEnded |
| 加载/展示失败 | ✅ noFill/showFailed/loadFailed 明确原因，不阻断 |
| 超时 | ✅ 守护计时器 → timeout 不发奖 |
| 重复回调 | ✅ 仅结算一次，duplicate 记录 |
| 平台降级 | ✅ 浏览器分享/广告 supported=false；空 ID 明确 noAdUnit |
| 正式隔离 | ✅ 微信 mock 模式不发奖 |
| 插屏频控 | ✅ 总开关/首局保护/冷却/每日上限 |
| 配置迁移 | ✅ 旧 adUnitId 测试更新为新语义（空 ID 合法，禁止编造） |

回归：lint 0；type-check 0；微信构建成功（初始场景错误 0，Phase 7 代码全部入包）。

## 验收标准对照

| 标准 | 状态 |
|------|------|
| 微信构建产物可正常启动、平台服务可用 | ✅ 构建实测；平台能力状态明确（真机运行为人工项） |
| 模拟广告覆盖成功/取消/失败/超时/重复回调 | ✅ 5 分支全测 |
| 真实广告取得合法广告位后实际验证 | ⏳ **阻塞**：广告位 ID 全部未配置（禁止编造），需用户从 mp 后台获取后填入配置并真机验证 |
| 模拟与正式隔离，正式版不得通过测试广告发奖 | ✅ 微信环境 mock 强制 unsupported |
| Git 提交及平台接入报告 | ✅ 本报告 + 原子提交 |

## 阻塞项与后续

1. **真实广告验证阻塞**：需用户在微信公众平台开通流量主、创建激励视频/插屏广告位，把 ID 填入 `game-config.json` 的 `ad.adUnitIds` 与 `ad.interstitialUnitId`，设置 `ad.mode='wx'`，再在真机验证（完整观看/取消/无填充/重复回调）。
2. 微信开发者工具服务端口未开启（历史阻塞）——真机联调需人工开启。
3. 官方数据/合规结论需以 mp 后台实际显示为准（COMPLIANCE.md 已列 ⏳）。
