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

## 人工验证项（待用户）

- [ ] 微信开发者工具：首次使用需在「设置 → 安全设置」开启**服务端口**并扫码登录，之后 CLI/自动化才能工作（本次 CLI 已验证报 `.cli` 缺失，即此状态）
- [ ] 编辑器浏览器预览：3D 视觉/手感确认（相机高度、车道宽度、跳跃高度均为首版参数，预览后调优）
- [ ] `renderMode: "2d"` 回退回归确认（应与 P0 视觉一致）
- [ ] 真机试玩（P3）
